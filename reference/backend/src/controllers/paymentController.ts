import type { RequestHandler } from 'express'
import { AppError } from '../errors/AppError'
import { currentUser, maybeUser } from '../auth/context'
import { prisma } from '../utils/prisma'
import { recordAudit } from '../services/auditService'
import { requestMeta } from '../utils/requestMeta'
import { toPayment, toPaymentEvent } from '../utils/serializers'
import { assertPaymentAccess } from '../utils/access'
import { paginationMeta, parsePagination } from '../utils/pagination'
import {
  collectCashPayment,
  failPayment,
  generateTransactionRef,
  handleProviderWebhook,
  initializePayment,
  issueReceipt,
  listPaymentEvents,
  loadPaymentForUser,
  payBookingWithWallet,
  refundPayment,
  verifyAndSettle
} from '../services/paymentService'
import type {
  CashPaymentInput,
  InitializePaymentInput,
  RefundPaymentInput,
  VerifyPaymentInput
} from '../validation/payment.schemas'
import { env } from '../config/env'

/**
 * Payment HTTP handlers. All money movement lives in `services/paymentService`;
 * these handlers only translate HTTP and never trust a client for success.
 */

// POST /api/payments/initialize (Authenticated)
export const initializePaymentController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const input = req.body as InitializePaymentInput
  const { payment, checkout } = await initializePayment(actor, input)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'payment.initialize',
    resourceType: 'Payment',
    resourceId: payment.id,
    metadata: { type: payment.type, method: payment.method, amountKobo: payment.amountKobo },
    ...requestMeta(req)
  })

  res.json({ success: true, payment: toPayment(payment), interswitchPayload: checkout })
}

// POST /api/payments/cancel — called by the Interswitch checkout flow
export const cancelPayment: RequestHandler = async (req, res) => {
  const { txnRef } = req.body as { txnRef?: string }
  if (!txnRef) throw new AppError(400, 'Transaction reference required.', { code: 'VALIDATION_ERROR' })

  const payment = await prisma.payment.findUnique({ where: { transactionRef: txnRef } })
  if (!payment) throw new AppError(404, 'Payment record not found.', { code: 'PAYMENT_NOT_FOUND' })

  const updated = await failPayment(payment.id, {
    responseCode: 'Z6',
    responseDescription: 'Cancelled by user at Interswitch checkout',
    source: 'CLIENT',
    type: 'CANCELLED'
  })

  // A cancelled payment never changes the booking lifecycle.
  res.json({ success: true, status: 'FAILED', message: 'Transaction cancelled.', payment: toPayment(updated) })
}

// POST /api/payments/pay-with-wallet (Authenticated)
export const payWithWallet: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const { bookingId } = req.body as { bookingId?: string }
  if (!bookingId) throw new AppError(400, 'Booking ID is required.', { code: 'VALIDATION_ERROR' })

  const { payment, booking, walletBalanceKobo } = await payBookingWithWallet(actor, bookingId)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'payment.wallet',
    resourceType: 'Payment',
    resourceId: payment.id,
    metadata: { bookingId: booking.id, amountKobo: payment.amountKobo },
    ...requestMeta(req)
  })

  res.json({
    success: true,
    message: 'Payment debited from wallet and booking settled.',
    walletBalanceNGN: walletBalanceKobo / 100,
    payment: toPayment(payment),
    booking
  })
}

// POST /api/payments/verify — verify with the provider and settle (auth optional)
export const verifyPayment: RequestHandler = async (req, res) => {
  const input = req.body as VerifyPaymentInput
  if (!input.txnRef) throw new AppError(400, 'Transaction reference required.', { code: 'VALIDATION_ERROR' })

  const payment = await prisma.payment.findUnique({ where: { transactionRef: input.txnRef } })
  if (!payment) throw new AppError(404, 'Payment record not found.', { code: 'PAYMENT_NOT_FOUND' })

  // When the caller is signed in, enforce ownership. The `userId` in the body is
  // deliberately ignored: the payer is always the stored `payment.userId`.
  const actor = maybeUser(req)
  if (actor) assertPaymentAccess(actor, payment)

  const result = await verifyAndSettle(payment.id, {
    source: 'CLIENT',
    actorId: actor?.userId ?? null,
    isCancelled: input.isCancelled === true
  })

  const settled = result.payment.status === 'SUCCESSFUL'
  res.json({
    success: settled,
    status: result.payment.status,
    alreadySettled: result.alreadySettled,
    message: settled ? 'Payment verified.' : 'Payment unverified or declined.',
    payment: toPayment(result.payment)
  })
}

// POST /api/payments/webhook — server-to-server provider callback
export const paymentWebhook: RequestHandler = async (req, res) => {
  const signature =
    (req.headers['x-interswitch-signature'] as string | undefined) ??
    (req.headers['x-webhook-signature'] as string | undefined)
  const rawBody = (req as { rawBody?: Buffer }).rawBody?.toString('utf8')

  const result = await handleProviderWebhook({
    payload: (req.body ?? {}) as Record<string, any>,
    rawBody,
    signature
  })

  // Providers expect a 2xx so they stop retrying; idempotency is enforced by us.
  res.json({ success: true, received: true, duplicate: result.duplicate, status: result.status })
}

// GET /api/payments/callback — browser redirect target from Interswitch checkout
export const paymentCallback: RequestHandler = async (req, res) => {
  // The redirect is an untrusted hint: it never settles anything. We simply
  // acknowledge and let the client (or the webhook) trigger verification.
  const txnRef = String(req.query.txnRef ?? req.query.transactionreference ?? '')
  res.json({ success: true, received: true, txnRef: txnRef || null })
}

// GET /api/payments/:id (Authenticated, own)
export const getPayment: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const payment = await loadPaymentForUser(actor, String(req.params.id))
  const events = await listPaymentEvents(payment.id)
  res.json({ success: true, payment: toPayment(payment), events: events.map(toPaymentEvent) })
}

// GET /api/payments/:id/receipt (Authenticated, own)
export const getPaymentReceipt: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const payment = await loadPaymentForUser(actor, String(req.params.id))
  const receipt = await issueReceipt(payment.id, actor.userId)
  res.json({ success: true, payment: toPayment(receipt) })
}

// GET /api/payments/history (Authenticated) — own payments, paginated
export const paymentHistory: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const window = parsePagination(req.query as Record<string, unknown>)
  const where = { userId: actor.userId }

  const [total, payments] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: window.skip,
      take: window.take
    })
  ])

  res.json({
    success: true,
    payments: payments.map(toPayment),
    pagination: paginationMeta(total, window)
  })
}

// GET /api/admin/payments (state/admin) — paginated oversight
export const listPayments: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const { status, type, method, userId, bookingId } = req.query as Record<string, string | undefined>
  const window = parsePagination(req.query as Record<string, unknown>)

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (type) where.type = type
  if (method) where.method = method
  if (userId) where.userId = userId
  if (bookingId) where.bookingId = bookingId

  // A state administrator only sees payments for bookings in their own state.
  // The scope is resolved through the state's bookings rather than a nested
  // relation filter so it behaves identically on the real and mock clients.
  if (actor.role === 'STATE_ADMIN') {
    if (!actor.stateId) {
      res.json({ success: true, payments: [], pagination: paginationMeta(0, window) })
      return
    }
    const bookings = await prisma.booking.findMany({ where: { stateId: actor.stateId }, select: { id: true } })
    const ids = bookings.map((b: { id: string }) => b.id)
    where.bookingId = { in: ids.length ? ids : ['__none__'] }
  }

  const [total, payments] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: window.skip, take: window.take })
  ])

  res.json({
    success: true,
    payments: payments.map(toPayment),
    pagination: paginationMeta(total, window)
  })
}

// POST /api/payments/retry (Authenticated)
export const retryPayment: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const { paymentId } = req.body as { paymentId?: string }
  if (!paymentId) throw new AppError(400, 'Payment ID is required.', { code: 'VALIDATION_ERROR' })

  const existing = await prisma.payment.findUnique({ where: { id: paymentId } })
  if (!existing) throw new AppError(404, 'Payment record not found.', { code: 'PAYMENT_NOT_FOUND' })
  assertPaymentAccess(actor, existing)

  if (existing.status === 'SUCCESSFUL') {
    throw new AppError(400, 'Transaction is already settled.', { code: 'PAYMENT_ALREADY_SETTLED' })
  }

  const newTxnRef = generateTransactionRef('ISW_MM_RETRY')
  const updated = await prisma.payment.update({
    where: { id: paymentId },
    data: {
      transactionRef: newTxnRef,
      status: 'PENDING',
      responseCode: null,
      responseDescription: null
    }
  })

  const user = await prisma.user.findUnique({ where: { id: actor.userId } })

  res.json({
    success: true,
    payment: toPayment(updated),
    interswitchPayload: {
      merchantCode: env.INTERSWITCH_MERCHANT_CODE,
      payItemId: env.INTERSWITCH_PAY_ITEM_ID,
      amount: updated.amountKobo,
      txnRef: newTxnRef,
      currency: 566,
      customerEmail: user?.email ?? 'patient@medimove.ng',
      mode: env.INTERSWITCH_MODE,
      redirectUrl: env.INTERSWITCH_REDIRECT_URL ?? `${env.APP_BASE_URL}/api/payments/callback`,
      method: updated.method
    }
  })
}

// POST /api/payments/cash (crew/provider admin) — record cash collected in person
export const collectCash: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const input = req.body as CashPaymentInput
  const payment = await collectCashPayment(actor, input)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'payment.cash',
    resourceType: 'Payment',
    resourceId: payment.id,
    metadata: { bookingId: payment.bookingId, amountKobo: payment.amountKobo },
    ...requestMeta(req)
  })

  res.status(201).json({ success: true, payment: toPayment(payment) })
}

// POST /api/payments/:id/refund (state/platform admin)
export const refundPaymentController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const input = req.body as RefundPaymentInput
  const { payment, status, amountKobo } = await refundPayment(actor, String(req.params.id), input)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'payment.refund',
    resourceType: 'Payment',
    resourceId: payment.id,
    metadata: { amountKobo, refundStatus: status, reason: input.reason ?? null },
    ...requestMeta(req)
  })

  res.json({ success: true, refundStatus: status, amountKobo, payment: toPayment(payment) })
}
