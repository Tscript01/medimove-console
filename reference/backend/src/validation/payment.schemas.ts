import { z } from 'zod'

/**
 * Payment request validation.
 *
 * No schema ever accepts card data, a provider "success" flag, or a booking's
 * payable amount for card/bank transfers: the amount is always read from the
 * server-side record (`Booking.estimatedFare`) and settlement only happens after
 * the gateway is independently queried.
 */

export const PAYMENT_METHOD_VALUES = ['CARD', 'BANK_TRANSFER', 'WALLET', 'CASH', 'OTHER'] as const
export const PAYMENT_TYPE_VALUES = ['BOOKING', 'SAVINGS', 'WALLET_FUNDING', 'WALLET_PAYMENT'] as const
export const PAYMENT_STATUS_VALUES = ['PENDING', 'SUCCESSFUL', 'FAILED'] as const

export const paymentMethodSchema = z.enum(PAYMENT_METHOD_VALUES)
export const paymentTypeSchema = z.enum(PAYMENT_TYPE_VALUES)
export const paymentStatusSchema = z.enum(PAYMENT_STATUS_VALUES)

/** Gateway-backed methods are settled only after provider verification. */
export const GATEWAY_METHODS: readonly string[] = ['CARD', 'BANK_TRANSFER', 'OTHER']

const kobo = z.number().int('Amounts are integer kobo.').positive('Amount must be greater than zero.')

export const initializePaymentSchema = z
  .object({
    type: paymentTypeSchema.default('BOOKING'),
    bookingId: z.string().trim().min(1).optional(),
    savingsGoalId: z.string().trim().min(1).optional(),
    /** Only used for SAVINGS, where the payer chooses the contribution. */
    amountKobo: kobo.optional(),
    method: paymentMethodSchema.default('CARD')
  })
  .superRefine((data, ctx) => {
    if (data.type === 'BOOKING' && !data.bookingId) {
      ctx.addIssue({ code: 'custom', path: ['bookingId'], message: 'A booking is required.' })
    }
    if (data.type === 'SAVINGS' && !data.savingsGoalId) {
      ctx.addIssue({ code: 'custom', path: ['savingsGoalId'], message: 'A savings goal is required.' })
    }
  })

export const cancelPaymentSchema = z.object({
  txnRef: z.string().trim().min(1, 'Transaction reference required.')
})

export const retryPaymentSchema = z.object({
  paymentId: z.string().trim().min(1, 'Payment ID is required.'),
  method: paymentMethodSchema.optional()
})

/**
 * Client-triggered verification. `txnRef` identifies the payment; the payer is
 * taken from the session, never from the body. `isCancelled` is a hint only —
 * the gateway is still queried.
 */
export const verifyPaymentSchema = z.object({
  txnRef: z.string().trim().min(1, 'Transaction reference required.'),
  isCancelled: z.boolean().optional()
})

/** A crew member recording cash collected in person. */
export const cashPaymentSchema = z.object({
  bookingId: z.string().trim().min(1, 'A booking is required.'),
  amountKobo: kobo.optional(),
  note: z.string().trim().max(300).optional()
})

export const refundPaymentSchema = z.object({
  amountKobo: kobo.optional(),
  reason: z.string().trim().max(500).optional()
})

export const listPaymentsQuerySchema = z.object({
  status: paymentStatusSchema.optional(),
  type: paymentTypeSchema.optional(),
  method: paymentMethodSchema.optional(),
  userId: z.string().trim().min(1).optional(),
  bookingId: z.string().trim().min(1).optional()
})

export type InitializePaymentInput = z.infer<typeof initializePaymentSchema>
export type CancelPaymentInput = z.infer<typeof cancelPaymentSchema>
export type RetryPaymentInput = z.infer<typeof retryPaymentSchema>
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>
export type CashPaymentInput = z.infer<typeof cashPaymentSchema>
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>
export type PaymentMethodValue = (typeof PAYMENT_METHOD_VALUES)[number]
export type PaymentTypeValue = (typeof PAYMENT_TYPE_VALUES)[number]
