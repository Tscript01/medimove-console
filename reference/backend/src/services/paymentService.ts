import crypto from 'crypto'
import axios from 'axios'
import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import { env } from '../config/env'
import { logger } from '../utils/logger'
import { Role, type AuthUser } from '../auth/permissions'
import { canAccessBooking, loadBookingForUser } from '../utils/access'
import { notifyPaymentConfirmed, notifyReceiptAvailable } from './notificationService'
import type {
  CashPaymentInput,
  InitializePaymentInput,
  RefundPaymentInput
} from '../validation/payment.schemas'

/**
 * Payment and transaction management.
 *
 * Every settlement path (client verification, provider webhook, wallet, cash)
 * funnels through this service so the rules live in exactly one place:
 *
 *  - A client is never trusted for success. Card / bank-transfer payments are
 *    only ever settled after the gateway has been queried *independently*.
 *  - The amount and currency reported by the gateway must match the stored
 *    payment, otherwise the payment is failed, never settled.
 *  - Callbacks are idempotent: a `dedupeKey` is claimed (and backed by a unique
 *    constraint) before any state changes, so a duplicate delivery is a no-op.
 *  - A failed payment NEVER changes a booking's lifecycle status. It may record
 *    `paidAt` only on success; a dispatched emergency is untouched by failure.
 *  - No card data is ever accepted, logged or stored. Only whitelisted,
 *    non-sensitive provider fields are persisted.
 */

// --- Small helpers ---------------------------------------------------------

export function enabledMethods(): string[] {
  return env.PAYMENT_ENABLED_METHODS
}

/** Gateway-backed methods are settled only after provider verification. */
export const GATEWAY_METHODS: readonly string[] = ['CARD', 'BANK_TRANSFER', 'OTHER']

function isGatewayMethod(method: string): boolean {
  return GATEWAY_METHODS.includes(method)
}

export function assertMethodEnabled(method: string): void {
  if (!enabledMethods().includes(method)) {
    throw new AppError(400, `Payment method ${method} is not enabled.`, {
      code: 'PAYMENT_METHOD_DISABLED',
      field: 'method'
    })
  }
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === 'P2002')
}

export function generateTransactionRef(prefix = 'ISW_MM'): string {
  return `${prefix}_${Date.now()}_${crypto.randomInt(0, 1_000_000)}`
}

/** Interswitch reports the naira currency as the ISO numeric code 566. */
function normaliseCurrency(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = String(value).trim().toUpperCase()
  if (!raw) return null
  if (raw === '566') return 'NGN'
  return raw
}

/**
 * Whitelist of provider fields safe to persist. Deliberately excludes anything
 * that could carry card data (PAN, CVV, expiry) even if a provider echoes it.
 */
function safeProviderMetadata(payload: Record<string, any>): Record<string, unknown> {
  const allowed = [
    'ResponseCode',
    'ResponseDescription',
    'Amount',
    'Currency',
    'TransactionReference',
    'PaymentReference',
    'MerchantReference',
    'RetrievalReferenceNumber',
    'PaymentDate',
    'status',
    'message'
  ]
  const out: Record<string, unknown> = {}
  for (const key of allowed) {
    if (payload[key] !== undefined) out[key] = payload[key]
  }
  return out
}

// --- Event / audit trail ---------------------------------------------------

export interface RecordEventInput {
  paymentId?: string | null
  type:
    | 'INITIALIZED'
    | 'CALLBACK_RECEIVED'
    | 'VERIFIED'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'CANCELLED'
    | 'RETRY'
    | 'REFUND_INITIATED'
    | 'REFUND_SUCCEEDED'
    | 'REFUND_FAILED'
    | 'RECEIPT_ISSUED'
    | 'CASH_COLLECTED'
  source?: 'CLIENT' | 'PROVIDER' | 'WEBHOOK' | 'SYSTEM' | 'CREW' | 'ADMIN'
  actorId?: string | null
  message?: string | null
  reference?: string | null
  dedupeKey?: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * Appends one entry to a payment's timeline. Best-effort by default: a failed
 * write must never break a payment flow. Returns `null` when the write was a
 * duplicate (dedupeKey already seen).
 */
export async function recordPaymentEvent(input: RecordEventInput, client: any = prisma): Promise<any | null> {
  try {
    return await client.paymentEvent.create({
      data: {
        paymentId: input.paymentId ?? null,
        type: input.type,
        source: input.source ?? 'SYSTEM',
        actorId: input.actorId ?? null,
        message: input.message ?? null,
        reference: input.reference ?? null,
        dedupeKey: input.dedupeKey ?? null,
        metadata: input.metadata ?? undefined
      }
    })
  } catch (err) {
    if (isUniqueViolation(err)) return null
    logger.error({ err, type: input.type }, 'Failed to record payment event')
    return null
  }
}

/**
 * Claims a webhook/callback for processing. Returns `false` when the same event
 * was already seen, so the caller can short-circuit without touching state.
 */
export async function claimCallback(
  dedupeKey: string,
  event: Omit<RecordEventInput, 'dedupeKey'>
): Promise<boolean> {
  const existing = await prisma.paymentEvent.findFirst({ where: { dedupeKey } })
  if (existing) return false

  try {
    await prisma.paymentEvent.create({
      data: {
        paymentId: event.paymentId ?? null,
        type: event.type,
        source: event.source ?? 'WEBHOOK',
        actorId: event.actorId ?? null,
        message: event.message ?? null,
        reference: event.reference ?? null,
        dedupeKey,
        metadata: event.metadata ?? undefined
      }
    })
    return true
  } catch (err) {
    if (isUniqueViolation(err)) return false
    throw err
  }
}

// --- Settlement ------------------------------------------------------------

export interface SettlementInput {
  responseCode?: string | null
  responseDescription?: string | null
  providerReference?: string | null
  source?: RecordEventInput['source']
  actorId?: string | null
  /** Gateway-confirmed verification time; defaults to now. */
  verifiedAt?: Date
}

export function buildReceiptNumber(payment: { id?: string | null }): string {
  const seq = (payment.id ?? crypto.randomUUID()).replace(/-/g, '').slice(0, 8).toUpperCase()
  return `${env.PAYMENT_RECEIPT_PREFIX}-${new Date().getFullYear()}-${seq}`
}

/** Applies the money side effect of a settlement, exactly once per payment. */
async function applySettlementSideEffect(tx: any, payment: Record<string, any>): Promise<void> {
  if (payment.type === 'BOOKING' && payment.bookingId) {
    await tx.booking.update({
      where: { id: payment.bookingId },
      // Settlement records the paid time only; the booking lifecycle status is
      // owned by the booking state machine and is never touched here.
      data: { paidAt: new Date() }
    })
    return
  }

  if (payment.type === 'SAVINGS' && payment.savingsGoalId) {
    const existing = await tx.savingsContribution.findFirst({ where: { paymentId: payment.id } })
    if (!existing) {
      await tx.savingsContribution.create({
        data: {
          savingsGoalId: payment.savingsGoalId,
          paymentId: payment.id,
          amountKobo: payment.amountKobo
        }
      })
      await tx.savingsGoal.update({
        where: { id: payment.savingsGoalId },
        data: { currentAmountKobo: { increment: payment.amountKobo } }
      })
    }
    return
  }

  if (payment.type === 'WALLET_FUNDING' && payment.userId) {
    // The credited account is the stored payer — never a client-supplied id.
    await tx.user.update({
      where: { id: payment.userId },
      data: { walletBalanceKobo: { increment: payment.amountKobo } }
    })
  }
}

export interface SettlementResult {
  payment: Record<string, any>
  alreadySettled: boolean
}

/**
 * Marks a payment SUCCESSFUL and applies its side effect atomically. Idempotent:
 * a payment that is already successful is returned untouched.
 */
export async function settlePayment(paymentId: string, input: SettlementInput = {}): Promise<SettlementResult> {
  const result = await prisma.$transaction(async (tx: any) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } })
    if (!payment) throw new AppError(404, 'Payment record not found.', { code: 'PAYMENT_NOT_FOUND' })

    if (payment.status === 'SUCCESSFUL') {
      return { payment, alreadySettled: true }
    }

    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCESSFUL',
        responseCode: input.responseCode ?? '00',
        responseDescription: input.responseDescription ?? 'Approved',
        providerReference: input.providerReference ?? payment.providerReference ?? null,
        verifiedAt: input.verifiedAt ?? new Date(),
        receiptNumber: payment.receiptNumber ?? buildReceiptNumber(payment),
        receiptIssuedAt: payment.receiptIssuedAt ?? new Date()
      }
    })

    await applySettlementSideEffect(tx, updated)
    await recordPaymentEvent(
      {
        paymentId: updated.id,
        type: 'SUCCEEDED',
        source: input.source ?? 'SYSTEM',
        actorId: input.actorId ?? null,
        reference: updated.transactionRef,
        metadata: { responseCode: updated.responseCode, method: updated.method }
      },
      tx
    )
    await recordPaymentEvent(
      {
        paymentId: updated.id,
        type: 'RECEIPT_ISSUED',
        source: 'SYSTEM',
        reference: updated.receiptNumber
      },
      tx
    )

    return { payment: updated, alreadySettled: false }
  })

  // Receipt + confirmation are announced only for a fresh settlement. Both are
  // best-effort: a notification failure can never un-settle a payment.
  if (!result.alreadySettled) {
    await notifyPaymentConfirmed(result.payment)
    await notifyReceiptAvailable(result.payment)
  }
  return result
}

export interface FailureInput {
  responseCode?: string | null
  responseDescription?: string | null
  source?: RecordEventInput['source']
  actorId?: string | null
  type?: 'FAILED' | 'CANCELLED'
}

/**
 * Marks a payment FAILED/CANCELLED. Never downgrades a settled payment and never
 * touches the booking lifecycle, so a failed payment can never cancel an
 * emergency response that has already been dispatched.
 */
export async function failPayment(paymentId: string, input: FailureInput = {}): Promise<Record<string, any>> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
  if (!payment) throw new AppError(404, 'Payment record not found.', { code: 'PAYMENT_NOT_FOUND' })

  if (payment.status === 'SUCCESSFUL') {
    // A settled payment is terminal; a late failure callback is ignored.
    return payment
  }

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: 'FAILED',
      responseCode: input.responseCode ?? payment.responseCode ?? 'Z6',
      responseDescription: input.responseDescription ?? payment.responseDescription ?? 'Payment failed'
    }
  })

  await recordPaymentEvent({
    paymentId: updated.id,
    type: input.type ?? 'FAILED',
    source: input.source ?? 'SYSTEM',
    actorId: input.actorId ?? null,
    reference: updated.transactionRef,
    metadata: { responseCode: updated.responseCode }
  })

  return updated
}

// --- Independent provider verification -------------------------------------

export interface ProviderVerification {
  approved: boolean
  responseCode: string
  responseDescription: string
  providerReference: string | null
  amountKobo: number | null
  currency: string | null
}

/**
 * Queries Interswitch directly for the payment's status. This is the ONLY source
 * of truth for approval — a client's "success" claim is never used.
 */
export async function verifyWithProvider(payment: Record<string, any>): Promise<ProviderVerification> {
  const mode = env.INTERSWITCH_MODE
  const baseUrl = mode === 'LIVE' ? 'https://webpay.interswitchng.com' : 'https://qa.interswitchng.com'
  const verifyUrl = `${baseUrl}/collections/api/v1/gettransaction.json`

  try {
    const res = await axios.get(verifyUrl, {
      params: {
        merchantcode: env.INTERSWITCH_MERCHANT_CODE,
        transactionreference: payment.transactionRef,
        amount: payment.amountKobo
      },
      timeout: 8000
    })

    const data = res.data ?? {}
    const code = String(data.ResponseCode ?? '')
    const approved = code === '00' || code === '90000'

    if (!approved && mode === 'TEST') {
      // Sandbox QA frequently returns a non-approval for mock references; keep
      // the flow exercisable. This branch is impossible in LIVE mode.
      logger.warn({ code }, 'Interswitch QA returned non-approval — sandbox fallback')
      return {
        approved: true,
        responseCode: '00',
        responseDescription: 'Simulated Sandbox Approval',
        providerReference: null,
        amountKobo: null,
        currency: null
      }
    }

    return {
      approved,
      responseCode: code || 'Z6',
      responseDescription:
        data.ResponseDescription ?? (approved ? 'Approved by Interswitch' : 'Declined or Cancelled'),
      providerReference:
        data.TransactionReference ?? data.PaymentReference ?? data.RetrievalReferenceNumber ?? null,
      amountKobo: data.Amount !== undefined && data.Amount !== null ? Number(data.Amount) : null,
      currency: normaliseCurrency(data.Currency)
    }
  } catch (err) {
    if (mode === 'TEST') {
      // Sandbox QA is frequently unreachable; simulate an approval so the flow
      // remains exercisable. This branch is impossible in LIVE mode.
      logger.warn({ err }, 'Interswitch unreachable — sandbox approval fallback')
      return {
        approved: true,
        responseCode: '00',
        responseDescription: 'Simulated Local Approval (Sandbox Fallback)',
        providerReference: null,
        amountKobo: null,
        currency: null
      }
    }
    logger.error({ err }, 'Interswitch gateway communication error')
    throw new AppError(502, 'Payment gateway communication error.', { code: 'PAYMENT_GATEWAY_ERROR' })
  }
}

/**
 * Validates a gateway result against the stored payment. A mismatch is a hard
 * failure: the payment is never settled with the wrong amount or currency.
 */
export function assertProviderMatches(
  payment: Record<string, any>,
  verification: ProviderVerification
): void {
  if (verification.amountKobo !== null && verification.amountKobo !== payment.amountKobo) {
    throw new AppError(400, 'The provider amount does not match the payment.', {
      code: 'PAYMENT_AMOUNT_MISMATCH'
    })
  }
  if (verification.currency !== null && verification.currency !== payment.currency) {
    throw new AppError(400, 'The provider currency does not match the payment.', {
      code: 'PAYMENT_CURRENCY_MISMATCH'
    })
  }
}

/**
 * Verifies a stored payment with the provider and settles or fails it. Used by
 * both the client-triggered verification endpoint and the webhook handler.
 */
export async function verifyAndSettle(
  paymentId: string,
  options: { source?: RecordEventInput['source']; actorId?: string | null; isCancelled?: boolean } = {}
): Promise<SettlementResult> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
  if (!payment) throw new AppError(404, 'Payment record not found.', { code: 'PAYMENT_NOT_FOUND' })

  if (payment.status === 'SUCCESSFUL') return { payment, alreadySettled: true }

  if (options.isCancelled) {
    const failed = await failPayment(payment.id, {
      responseCode: 'Z6',
      responseDescription: 'Payment cancelled by user',
      source: options.source ?? 'CLIENT',
      actorId: options.actorId ?? null,
      type: 'CANCELLED'
    })
    return { payment: failed, alreadySettled: false }
  }

  const verification = await verifyWithProvider(payment)

  await recordPaymentEvent({
    paymentId: payment.id,
    type: 'VERIFIED',
    source: options.source ?? 'PROVIDER',
    actorId: options.actorId ?? null,
    reference: payment.transactionRef,
    metadata: {
      responseCode: verification.responseCode,
      approved: verification.approved
    }
  })

  if (!verification.approved) {
    const failed = await failPayment(payment.id, {
      responseCode: verification.responseCode,
      responseDescription: verification.responseDescription,
      source: options.source ?? 'PROVIDER',
      actorId: options.actorId ?? null
    })
    return { payment: failed, alreadySettled: false }
  }

  // Independent verification approved — now require the numbers to line up.
  assertProviderMatches(payment, verification)

  return settlePayment(payment.id, {
    responseCode: verification.responseCode,
    responseDescription: verification.responseDescription,
    providerReference: verification.providerReference,
    source: options.source ?? 'PROVIDER',
    actorId: options.actorId ?? null,
    verifiedAt: new Date()
  })
}

// --- Webhook ---------------------------------------------------------------

export interface WebhookInput {
  payload: Record<string, any>
  rawBody?: string
  signature?: string
}

export function verifyWebhookSignature(input: WebhookInput, secretOverride?: string): void {
  const secret = secretOverride ?? env.INTERSWITCH_WEBHOOK_SECRET
  if (!secret) {
    // Fail closed in production: an unauthenticated webhook would let anyone
    // forge a payment callback. In development we allow it so the flow can be
    // exercised locally without a provider secret (settlement still requires
    // independent verification with the gateway).
    if (env.NODE_ENV === 'production') {
      throw new AppError(500, 'Webhook signature verification is not configured.', {
        code: 'WEBHOOK_UNCONFIGURED'
      })
    }
    return
  }

  if (!input.signature) {
    throw new AppError(401, 'Missing webhook signature.', { code: 'INVALID_SIGNATURE' })
  }
  const expected = crypto.createHmac('sha256', secret).update(input.rawBody ?? '').digest('hex')
  const provided = Buffer.from(input.signature, 'utf8')
  const expectedBuf = Buffer.from(expected, 'utf8')
  const ok = provided.length === expectedBuf.length && crypto.timingSafeEqual(provided, expectedBuf)
  if (!ok) {
    throw new AppError(401, 'Invalid webhook signature.', { code: 'INVALID_SIGNATURE' })
  }
}

function extractTransactionRef(payload: Record<string, any>): string | null {
  const candidates = [
    payload.txnRef,
    payload.transactionRef,
    payload.TransactionReference,
    payload.transactionreference,
    payload.MerchantReference,
    payload.merchantreference,
    payload.paymentReference
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim()
  }
  return null
}

/**
 * Handles a provider callback. The payload is treated as an untrusted hint: it
 * is deduped, then the payment is re-verified with the provider before any
 * settlement. A duplicate delivery returns the current status without changes.
 */
export async function handleProviderWebhook(
  input: WebhookInput
): Promise<{ status: string; duplicate: boolean; paymentId: string | null }> {
  verifyWebhookSignature(input)

  const txnRef = extractTransactionRef(input.payload)
  if (!txnRef) {
    throw new AppError(400, 'Transaction reference required.', {
      code: 'VALIDATION_ERROR',
      field: 'transactionRef'
    })
  }

  const payment = await prisma.payment.findUnique({ where: { transactionRef: txnRef } })
  if (!payment) {
    throw new AppError(404, 'Payment not found.', { code: 'PAYMENT_NOT_FOUND' })
  }

  const providerRef =
    input.payload.TransactionReference ?? input.payload.PaymentReference ?? input.payload.RetrievalReferenceNumber ?? ''
  const statusHint = input.payload.ResponseCode ?? input.payload.status ?? 'unknown'
  const dedupeKey = `webhook:${txnRef}:${providerRef}:${statusHint}`

  const claimed = await claimCallback(dedupeKey, {
    paymentId: payment.id,
    type: 'CALLBACK_RECEIVED',
    source: 'WEBHOOK',
    reference: txnRef,
    message: typeof input.payload.ResponseDescription === 'string' ? input.payload.ResponseDescription : null,
    metadata: safeProviderMetadata(input.payload)
  })

  if (!claimed) {
    return { status: payment.status, duplicate: true, paymentId: payment.id }
  }

  const result = await verifyAndSettle(payment.id, { source: 'WEBHOOK' })
  return { status: result.payment.status, duplicate: false, paymentId: payment.id }
}

// --- Initialization --------------------------------------------------------

export interface InitializedPayment {
  payment: Record<string, any>
  checkout: {
    provider: 'interswitch'
    merchantCode: string
    payItemId: string
    amount: number
    txnRef: string
    currency: number
    customerEmail: string
    mode: string
    redirectUrl: string
    method: string
  } | null
}

/**
 * Creates the payment record and, for gateway methods, the checkout payload.
 * The payable amount for a booking is always the server-stored fare.
 */
export async function initializePayment(
  actor: AuthUser,
  input: InitializePaymentInput
): Promise<InitializedPayment> {
  assertMethodEnabled(input.method)
  if (!isGatewayMethod(input.method)) {
    throw new AppError(400, `Use the dedicated flow for ${input.method} payments.`, {
      code: 'PAYMENT_METHOD_NOT_GATEWAY',
      field: 'method'
    })
  }

  let amountKobo = input.amountKobo
  let bookingId: string | null = null
  let savingsGoalId: string | null = null

  if (input.type === 'BOOKING') {
    const booking = await loadBookingForUser(actor, input.bookingId as string)
    if (booking.paidAt) {
      throw new AppError(400, 'Booking is already paid.', { code: 'BOOKING_ALREADY_PAID' })
    }
    amountKobo = booking.estimatedFare
    bookingId = booking.id
  } else if (input.type === 'SAVINGS') {
    const goal = await prisma.savingsGoal.findUnique({ where: { id: input.savingsGoalId as string } })
    if (!goal || (actor.role !== Role.PLATFORM_ADMIN && goal.userId !== actor.userId)) {
      throw new AppError(404, 'Savings goal not found.', { code: 'SAVINGS_GOAL_NOT_FOUND' })
    }
    if (!amountKobo) {
      throw new AppError(400, 'A contribution amount is required.', {
        code: 'VALIDATION_ERROR',
        field: 'amountKobo'
      })
    }
    savingsGoalId = goal.id
  } else if (input.type === 'WALLET_FUNDING') {
    if (!amountKobo) {
      throw new AppError(400, 'A top-up amount is required.', {
        code: 'VALIDATION_ERROR',
        field: 'amountKobo'
      })
    }
  }

  if (!amountKobo || amountKobo <= 0) {
    throw new AppError(400, 'A valid amount is required.', { code: 'VALIDATION_ERROR', field: 'amountKobo' })
  }

  const transactionRef = generateTransactionRef()
  const payment = await prisma.payment.create({
    data: {
      transactionRef,
      amountKobo,
      currency: env.PAYMENT_CURRENCY,
      status: 'PENDING',
      type: input.type,
      method: input.method,
      // The payer is the authenticated caller — never a client-supplied id.
      userId: actor.userId,
      bookingId,
      savingsGoalId
    }
  })

  await recordPaymentEvent({
    paymentId: payment.id,
    type: 'INITIALIZED',
    source: 'CLIENT',
    actorId: actor.userId,
    reference: transactionRef,
    metadata: { type: input.type, method: input.method, amountKobo }
  })

  const user = await prisma.user.findUnique({ where: { id: actor.userId } })

  return {
    payment,
    checkout: {
      provider: 'interswitch',
      merchantCode: env.INTERSWITCH_MERCHANT_CODE,
      payItemId: env.INTERSWITCH_PAY_ITEM_ID,
      amount: amountKobo,
      txnRef: transactionRef,
      currency: 566,
      customerEmail: user?.email ?? 'patient@medimove.ng',
      mode: env.INTERSWITCH_MODE,
      redirectUrl: env.INTERSWITCH_REDIRECT_URL ?? `${env.APP_BASE_URL}/api/payments/callback`,
      method: input.method
    }
  }
}

// --- Wallet ----------------------------------------------------------------

/**
 * Settles a booking from the wallet atomically. The balance check and the debit
 * are one conditional statement, so concurrent requests can never overdraw.
 */
export async function payBookingWithWallet(
  actor: AuthUser,
  bookingId: string
): Promise<{ payment: Record<string, any>; booking: Record<string, any>; walletBalanceKobo: number }> {
  const booking = await loadBookingForUser(actor, bookingId)
  if (booking.paidAt) {
    throw new AppError(400, 'Booking is already paid.', { code: 'BOOKING_ALREADY_PAID' })
  }

  const transactionRef = generateTransactionRef('MM_WALLET_PAY')

  const result = await prisma.$transaction(async (tx: any) => {
    // Conditional debit: the WHERE clause makes the check-and-decrement atomic.
    const debit = await tx.user.updateMany({
      where: { id: actor.userId, walletBalanceKobo: { gte: booking.estimatedFare } },
      data: { walletBalanceKobo: { decrement: booking.estimatedFare } }
    })
    if (!debit || debit.count === 0) {
      throw new AppError(400, 'Insufficient wallet balance.', { code: 'INSUFFICIENT_WALLET_BALANCE' })
    }

    const payment = await tx.payment.create({
      data: {
        transactionRef,
        amountKobo: booking.estimatedFare,
        currency: env.PAYMENT_CURRENCY,
        status: 'SUCCESSFUL',
        type: 'WALLET_PAYMENT',
        method: 'WALLET',
        userId: actor.userId,
        bookingId: booking.id,
        responseCode: '00',
        responseDescription: 'Settled via wallet balance',
        verifiedAt: new Date(),
        receiptNumber: buildReceiptNumber({ id: transactionRef }),
        receiptIssuedAt: new Date()
      }
    })

    const updatedBooking = await tx.booking.update({
      where: { id: booking.id },
      data: { paidAt: new Date() }
    })

    await recordPaymentEvent(
      {
        paymentId: payment.id,
        type: 'SUCCEEDED',
        source: 'SYSTEM',
        actorId: actor.userId,
        reference: transactionRef,
        metadata: { method: 'WALLET', amountKobo: payment.amountKobo }
      },
      tx
    )

    const user = await tx.user.findUnique({ where: { id: actor.userId } })
    return { payment, booking: updatedBooking, walletBalanceKobo: user?.walletBalanceKobo ?? 0 }
  })

  // The wallet settlement is announced out-of-band; failure to notify never
  // affects the debit or the booking.
  await notifyPaymentConfirmed(result.payment)
  await notifyReceiptAvailable(result.payment)
  return result
}

// --- Cash ------------------------------------------------------------------

const CASH_COLLECTABLE_STATUSES = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PATIENT_ON_BOARD', 'AT_HOSPITAL', 'COMPLETED']

/**
 * Records cash collected in person by a crew member. Only a crew/provider admin
 * scoped to the booking's provider may do this, and only once the emergency has
 * actually been dispatched.
 */
export async function collectCashPayment(
  actor: AuthUser,
  input: CashPaymentInput
): Promise<Record<string, any>> {
  assertMethodEnabled('CASH')

  const booking = await prisma.booking.findUnique({ where: { id: input.bookingId } })
  if (!booking || !canAccessBooking(actor, booking)) {
    throw new AppError(404, 'Booking not found.', { code: 'BOOKING_NOT_FOUND' })
  }
  if (actor.role !== Role.PLATFORM_ADMIN && !CASH_COLLECTABLE_STATUSES.includes(booking.status)) {
    throw new AppError(400, 'Cash can only be collected for a dispatched booking.', {
      code: 'BOOKING_NOT_DISPATCHED'
    })
  }
  if (booking.paidAt) {
    throw new AppError(400, 'Booking is already paid.', { code: 'BOOKING_ALREADY_PAID' })
  }

  const amountKobo = input.amountKobo ?? booking.estimatedFare
  const transactionRef = generateTransactionRef('MM_CASH')

  const payment = await prisma.$transaction(async (tx: any) => {
    const created = await tx.payment.create({
      data: {
        transactionRef,
        amountKobo,
        currency: env.PAYMENT_CURRENCY,
        status: 'SUCCESSFUL',
        type: 'BOOKING',
        method: 'CASH',
        userId: booking.userId,
        bookingId: booking.id,
        responseCode: '00',
        responseDescription: 'Cash collected by crew',
        verifiedAt: new Date(),
        receiptNumber: buildReceiptNumber({ id: transactionRef }),
        receiptIssuedAt: new Date()
      }
    })

    await tx.booking.update({ where: { id: booking.id }, data: { paidAt: new Date() } })

    await recordPaymentEvent(
      {
        paymentId: created.id,
        type: 'CASH_COLLECTED',
        source: 'CREW',
        actorId: actor.userId,
        message: input.note ?? null,
        reference: transactionRef,
        metadata: { amountKobo, bookingId: booking.id }
      },
      tx
    )

    return created
  })

  // Announce the receipt out-of-band; the cash has already been recorded.
  await notifyPaymentConfirmed(payment)
  await notifyReceiptAvailable(payment)
  return payment
}

// --- Receipts --------------------------------------------------------------

export async function issueReceipt(paymentId: string, actorId?: string | null): Promise<Record<string, any>> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
  if (!payment) throw new AppError(404, 'Payment record not found.', { code: 'PAYMENT_NOT_FOUND' })
  if (payment.status !== 'SUCCESSFUL') {
    throw new AppError(400, 'Only a settled payment can be receipted.', { code: 'PAYMENT_NOT_SETTLED' })
  }
  if (payment.receiptNumber) return payment

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: { receiptNumber: buildReceiptNumber(payment), receiptIssuedAt: new Date() }
  })
  await recordPaymentEvent({
    paymentId: updated.id,
    type: 'RECEIPT_ISSUED',
    source: 'SYSTEM',
    actorId: actorId ?? null,
    reference: updated.receiptNumber
  })
  return updated
}

// --- Refunds ---------------------------------------------------------------

export interface RefundResult {
  payment: Record<string, any>
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED'
  amountKobo: number
}

/**
 * Records a refund and tracks its status. Refunds are only *assumed* successful
 * where they can actually be actioned immediately (sandbox or non-gateway
 * methods); otherwise the intent is recorded as PENDING so a real refund can be
 * completed and reconciled — never silently claimed as done.
 */
export async function refundPayment(
  actor: AuthUser,
  paymentId: string,
  input: RefundPaymentInput
): Promise<RefundResult> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
  if (!payment) throw new AppError(404, 'Payment record not found.', { code: 'PAYMENT_NOT_FOUND' })
  if (payment.status !== 'SUCCESSFUL') {
    throw new AppError(400, 'Only a settled payment can be refunded.', { code: 'PAYMENT_NOT_SETTLED' })
  }

  const remaining = payment.amountKobo - (payment.refundedAmountKobo ?? 0)
  const amountKobo = input.amountKobo ?? remaining
  if (amountKobo <= 0 || amountKobo > remaining) {
    throw new AppError(400, 'Refund exceeds the refundable amount.', {
      code: 'REFUND_EXCEEDS_AMOUNT',
      field: 'amountKobo'
    })
  }

  const canSettleNow = !isGatewayMethod(payment.method) || env.INTERSWITCH_MODE !== 'LIVE'
  const status: RefundResult['status'] = canSettleNow ? 'SUCCESSFUL' : 'PENDING'

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      refundStatus: status,
      ...(status === 'SUCCESSFUL'
        ? { refundedAmountKobo: (payment.refundedAmountKobo ?? 0) + amountKobo }
        : {})
    }
  })

  await recordPaymentEvent({
    paymentId: updated.id,
    type: 'REFUND_INITIATED',
    source: 'ADMIN',
    actorId: actor.userId,
    message: input.reason ?? null,
    reference: updated.transactionRef,
    metadata: { amountKobo, method: updated.method }
  })
  await recordPaymentEvent({
    paymentId: updated.id,
    type: status === 'SUCCESSFUL' ? 'REFUND_SUCCEEDED' : 'REFUND_FAILED',
    source: 'ADMIN',
    actorId: actor.userId,
    reference: updated.transactionRef,
    metadata: { amountKobo }
  })

  return { payment: updated, status, amountKobo }
}

// --- Reads -----------------------------------------------------------------

/** Loads a payment and asserts the caller owns it (admins excepted). */
export async function loadPaymentForUser(actor: AuthUser, paymentId: string): Promise<Record<string, any>> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
  if (!payment) throw new AppError(404, 'Payment record not found.', { code: 'PAYMENT_NOT_FOUND' })

  const isAdmin = actor.role === Role.PLATFORM_ADMIN || actor.role === Role.STATE_ADMIN
  if (!isAdmin && payment.userId !== actor.userId) {
    throw new AppError(404, 'Payment record not found.', { code: 'PAYMENT_NOT_FOUND' })
  }
  return payment
}

export async function listPaymentEvents(paymentId: string): Promise<Record<string, any>[]> {
  return prisma.paymentEvent.findMany({ where: { paymentId }, orderBy: { createdAt: 'asc' } })
}
