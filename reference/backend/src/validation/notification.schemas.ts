import { z } from 'zod'

/**
 * Notification request validation.
 *
 * Notification records are produced by the platform, never by a client, so there
 * is no create schema. Clients may only read their own feed; administrators may
 * filter the whole queue.
 */

export const NOTIFICATION_CHANNEL_VALUES = ['EMAIL', 'SMS', 'PUSH', 'WHATSAPP'] as const
export const NOTIFICATION_STATUS_VALUES = ['PENDING', 'SENT', 'FAILED', 'CANCELLED'] as const
export const NOTIFICATION_EVENT_VALUES = [
  'OTP_DELIVERY',
  'REGISTRATION_VERIFICATION',
  'BOOKING_RECEIVED',
  'DISPATCH_OFFER',
  'CREW_ACCEPTED',
  'AMBULANCE_ARRIVED',
  'TRIP_STATUS_CHANGED',
  'BOOKING_CANCELLED',
  'PAYMENT_CONFIRMED',
  'RECEIPT_AVAILABLE'
] as const

export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNEL_VALUES)
export const notificationStatusSchema = z.enum(NOTIFICATION_STATUS_VALUES)
export const notificationEventSchema = z.enum(NOTIFICATION_EVENT_VALUES)

/** Query string for the caller's own notification feed. */
export const listMyNotificationsQuerySchema = z.object({
  status: notificationStatusSchema.optional(),
  channel: notificationChannelSchema.optional(),
  eventType: notificationEventSchema.optional(),
  limit: z.coerce.number().int().positive().max(200).optional()
})

/** Query string for the administrative queue view (adds a `userId` filter). */
export const listNotificationsQuerySchema = listMyNotificationsQuerySchema.extend({
  userId: z.string().trim().min(1).optional()
})

export type ListMyNotificationsQuery = z.infer<typeof listMyNotificationsQuerySchema>
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>
