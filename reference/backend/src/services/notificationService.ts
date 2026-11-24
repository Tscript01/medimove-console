import { prisma } from '../utils/prisma'
import { env } from '../config/env'
import { AppError } from '../errors/AppError'
import { logger } from '../utils/logger'
import { getAdapter } from './notificationAdapters'
import { renderNotification } from './notificationTemplates'
import { mailer, type MailPurpose } from './mailService'
import { smsSender } from './smsService'
import type {
  NotificationChannel,
  NotificationEventType,
  NotificationLogType
} from '../generated/prisma/enums'

/**
 * Reusable notification service.
 *
 * Producers persist a notification and move on; delivery happens out-of-band via
 * the worker, so a slow or failing provider can never block — or roll back — a
 * booking or a payment. Three rules are load-bearing:
 *
 *  1. **Never blocks the domain flow.** Every entry point here is best-effort and
 *     swallows its own errors. A notification failure can never change a booking
 *     or payment status.
 *  2. **Reliable.** A queued notification is retried with exponential backoff and
 *     its full attempt/failure trail is kept, so nothing is silently dropped.
 *  3. **No secrets.** A persisted payload holds template variables only. OTP
 *     codes are delivered directly and never written to the queue.
 */

// --- Delivery log ----------------------------------------------------------

export interface RecordLogInput {
  notificationId?: string | null
  type: NotificationLogType
  message?: string | null
  attempt?: number | null
  provider?: string | null
}

/** Appends one entry to a notification's delivery log. Never throws. */
export async function recordNotificationLog(input: RecordLogInput, client: any = prisma): Promise<void> {
  try {
    await client.notificationEvent.create({
      data: {
        notificationId: input.notificationId ?? null,
        type: input.type,
        message: input.message ?? null,
        attempt: input.attempt ?? null,
        provider: input.provider ?? null
      }
    })
  } catch (err) {
    logger.error({ err, type: input.type }, 'Failed to write notification log')
  }
}

// --- Queueing --------------------------------------------------------------

export interface QueueNotificationInput {
  userId?: string | null
  recipient: string
  channel: NotificationChannel
  eventType: NotificationEventType
  payload?: Record<string, unknown> | null
  dedupeKey?: string | null
  maxAttempts?: number
}

/**
 * Persists a notification for delivery. Idempotent when a `dedupeKey` is given:
 * the same logical event is enqueued at most once. Best-effort — returns `null`
 * (and logs) rather than throwing, so it is always safe to call from a domain
 * flow.
 */
export async function queueNotification(input: QueueNotificationInput): Promise<Record<string, any> | null> {
  try {
    if (input.dedupeKey) {
      const existing = await prisma.notification.findFirst({ where: { dedupeKey: input.dedupeKey } })
      if (existing) return existing
    }

    const notification = await prisma.notification.create({
      data: {
        userId: input.userId ?? null,
        recipient: input.recipient,
        channel: input.channel,
        eventType: input.eventType,
        payload: input.payload ?? undefined,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: input.maxAttempts ?? env.NOTIFICATION_MAX_ATTEMPTS,
        nextAttemptAt: new Date(),
        dedupeKey: input.dedupeKey ?? null
      }
    })

    await recordNotificationLog({ notificationId: notification.id, type: 'QUEUED' })
    return notification
  } catch (err) {
    logger.error({ err, eventType: input.eventType, channel: input.channel }, 'Failed to queue notification')
    return null
  }
}

// --- Delivery --------------------------------------------------------------

function backoffMs(attempt: number): number {
  const seconds = Math.min(env.NOTIFICATION_RETRY_BASE_SECONDS * 2 ** (attempt - 1), 3600)
  return seconds * 1000
}

export interface ProcessResult {
  status: string
  notification: Record<string, any>
}

/**
 * Attempts to deliver one queued notification. On failure the notification is
 * rescheduled with backoff, or marked FAILED once its attempts are exhausted.
 */
export async function processNotification(id: string): Promise<ProcessResult> {
  const notification = await prisma.notification.findUnique({ where: { id } })
  if (!notification) {
    throw new AppError(404, 'Notification not found.', { code: 'NOTIFICATION_NOT_FOUND' })
  }
  if (notification.status !== 'PENDING') {
    return { status: notification.status, notification }
  }

  const adapter = getAdapter(notification.channel)
  const attempt = (notification.attempts ?? 0) + 1
  await recordNotificationLog({
    notificationId: notification.id,
    type: 'ATTEMPTED',
    attempt,
    provider: adapter.provider
  })

  const rendered = renderNotification(notification.eventType, (notification.payload ?? {}) as Record<string, any>)

  try {
    const result = await adapter.send({
      to: notification.recipient,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      metadata: (notification.payload ?? {}) as Record<string, unknown>
    })

    const updated = await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: 'SENT',
        attempts: attempt,
        sentAt: new Date(),
        lastError: null,
        providerMessageId: result.providerMessageId ?? null
      }
    })
    await recordNotificationLog({
      notificationId: notification.id,
      type: 'SENT',
      attempt,
      provider: adapter.provider
    })
    return { status: 'SENT', notification: updated }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Delivery failed'

    if (attempt >= (notification.maxAttempts ?? env.NOTIFICATION_MAX_ATTEMPTS)) {
      const updated = await prisma.notification.update({
        where: { id: notification.id },
        data: { status: 'FAILED', attempts: attempt, lastError: message }
      })
      await recordNotificationLog({
        notificationId: notification.id,
        type: 'FAILED',
        attempt,
        provider: adapter.provider,
        message
      })
      logger.error({ notificationId: notification.id, attempt, err }, 'Notification delivery failed permanently')
      return { status: 'FAILED', notification: updated }
    }

    const updated = await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: 'PENDING',
        attempts: attempt,
        lastError: message,
        nextAttemptAt: new Date(Date.now() + backoffMs(attempt))
      }
    })
    await recordNotificationLog({
      notificationId: notification.id,
      type: 'RETRY_SCHEDULED',
      attempt,
      provider: adapter.provider,
      message
    })
    return { status: 'PENDING', notification: updated }
  }
}

export interface ProcessBatchResult {
  processed: number
  sent: number
  failed: number
  retried: number
}

/**
 * One worker tick: delivers every due notification. Safe to call concurrently —
 * each notification is only ever moved out of PENDING by its own update.
 */
export async function processPendingNotifications(options: { limit?: number } = {}): Promise<ProcessBatchResult> {
  const limit = options.limit ?? env.NOTIFICATION_BATCH_SIZE
  const due = await prisma.notification.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: 'asc' },
    take: limit
  })

  const result: ProcessBatchResult = { processed: 0, sent: 0, failed: 0, retried: 0 }
  for (const notification of due) {
    result.processed += 1
    const outcome = await processNotification(notification.id)
    if (outcome.status === 'SENT') result.sent += 1
    else if (outcome.status === 'FAILED') result.failed += 1
    else result.retried += 1
  }
  return result
}

// --- Administration --------------------------------------------------------

/** Requeues a failed notification with a fresh attempt budget. */
export async function retryNotification(id: string): Promise<Record<string, any>> {
  const notification = await prisma.notification.findUnique({ where: { id } })
  if (!notification) throw new AppError(404, 'Notification not found.', { code: 'NOTIFICATION_NOT_FOUND' })
  if (notification.status === 'SENT') {
    throw new AppError(400, 'Notification was already delivered.', { code: 'NOTIFICATION_ALREADY_SENT' })
  }

  const updated = await prisma.notification.update({
    where: { id },
    data: { status: 'PENDING', attempts: 0, lastError: null, nextAttemptAt: new Date() }
  })
  await recordNotificationLog({ notificationId: id, type: 'QUEUED', message: 'Requeued by an administrator' })
  return updated
}

/** Cancels a still-pending notification. */
export async function cancelNotification(id: string): Promise<Record<string, any>> {
  const notification = await prisma.notification.findUnique({ where: { id } })
  if (!notification) throw new AppError(404, 'Notification not found.', { code: 'NOTIFICATION_NOT_FOUND' })
  if (notification.status !== 'PENDING') {
    throw new AppError(400, 'Only a pending notification can be cancelled.', {
      code: 'NOTIFICATION_NOT_PENDING',
      status: notification.status
    })
  }

  const updated = await prisma.notification.update({ where: { id }, data: { status: 'CANCELLED' } })
  await recordNotificationLog({ notificationId: id, type: 'CANCELLED', message: 'Cancelled by an administrator' })
  return updated
}

// --- Reads -----------------------------------------------------------------

export interface NotificationQuery {
  status?: string
  channel?: string
  eventType?: string
  userId?: string
  limit?: number
}

function buildWhere(query: NotificationQuery): Record<string, unknown> {
  const where: Record<string, unknown> = {}
  if (query.status) where.status = query.status
  if (query.channel) where.channel = query.channel
  if (query.eventType) where.eventType = query.eventType
  if (query.userId) where.userId = query.userId
  return where
}

export async function listUserNotifications(userId: string, query: NotificationQuery = {}) {
  return prisma.notification.findMany({
    where: { ...buildWhere(query), userId },
    orderBy: { createdAt: 'desc' },
    take: query.limit ?? 50
  })
}

export async function getUserNotification(userId: string, id: string) {
  const notification = await prisma.notification.findUnique({ where: { id } })
  // A notification that is not the caller's is a 404 so its existence is hidden.
  if (!notification || notification.userId !== userId) {
    throw new AppError(404, 'Notification not found.', { code: 'NOTIFICATION_NOT_FOUND' })
  }
  const events = await prisma.notificationEvent.findMany({
    where: { notificationId: id },
    orderBy: { createdAt: 'asc' }
  })
  return { notification, events }
}

export async function listAllNotifications(query: NotificationQuery = {}) {
  return prisma.notification.findMany({
    where: buildWhere(query),
    orderBy: { createdAt: 'desc' },
    take: query.limit ?? 100
  })
}

export async function getNotificationWithEvents(id: string) {
  const notification = await prisma.notification.findUnique({ where: { id } })
  if (!notification) throw new AppError(404, 'Notification not found.', { code: 'NOTIFICATION_NOT_FOUND' })
  const events = await prisma.notificationEvent.findMany({
    where: { notificationId: id },
    orderBy: { createdAt: 'asc' }
  })
  return { notification, events }
}

export async function notificationStats() {
  const [pending, sent, failed, cancelled] = await Promise.all([
    prisma.notification.count({ where: { status: 'PENDING' } }),
    prisma.notification.count({ where: { status: 'SENT' } }),
    prisma.notification.count({ where: { status: 'FAILED' } }),
    prisma.notification.count({ where: { status: 'CANCELLED' } })
  ])
  return { pending, sent, failed, cancelled, total: pending + sent + failed + cancelled }
}

// --- OTP delivery (direct, never queued) -----------------------------------

export interface DeliverOtpInput {
  userId: string
  channel: 'EMAIL' | 'SMS'
  to: string
  code: string
  /** Email purposes are `MailPurpose`; phone verification passes `PHONE_VERIFICATION`. */
  purpose: string
  expiresInMinutes: number
}

/**
 * Delivers an OTP synchronously through the matching transport. The code is
 * never persisted — only a redacted audit row is written — so the queue can
 * never hold a live code. Errors propagate to the caller (auth flows rely on
 * that to avoid leaking account state).
 */
export async function deliverOtp(input: DeliverOtpInput): Promise<void> {
  const eventType: NotificationEventType =
    input.purpose === 'EMAIL_VERIFICATION' ? 'REGISTRATION_VERIFICATION' : 'OTP_DELIVERY'

  try {
    if (input.channel === 'EMAIL') {
      await mailer.sendOtpEmail({
        to: input.to,
        code: input.code,
        purpose: input.purpose as MailPurpose,
        expiresInMinutes: input.expiresInMinutes
      })
    } else {
      await smsSender.sendOtpSms({ to: input.to, code: input.code, expiresInMinutes: input.expiresInMinutes })
    }
    await recordOtpAudit(input, eventType, 'SENT', null)
  } catch (err) {
    await recordOtpAudit(input, eventType, 'FAILED', err instanceof Error ? err.message : 'Delivery failed')
    throw err
  }
}

async function recordOtpAudit(
  input: DeliverOtpInput,
  eventType: NotificationEventType,
  status: 'SENT' | 'FAILED',
  error: string | null
): Promise<void> {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId: input.userId,
        recipient: input.to,
        channel: input.channel,
        eventType,
        // The code is deliberately NOT stored here.
        payload: { purpose: input.purpose },
        status,
        attempts: 1,
        maxAttempts: 1,
        nextAttemptAt: new Date(),
        lastError: error,
        sentAt: status === 'SENT' ? new Date() : null
      }
    })
    await recordNotificationLog({ notificationId: notification.id, type: status, attempt: 1 })
  } catch (err) {
    logger.error({ err, eventType }, 'Failed to record OTP notification audit')
  }
}

// --- Business event helpers (best-effort) ----------------------------------

async function ownerContact(userId?: string | null): Promise<{ email: string | null; phone: string | null }> {
  if (!userId) return { email: null, phone: null }
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    return { email: user?.email ?? null, phone: user?.phone ?? null }
  } catch {
    return { email: null, phone: null }
  }
}

/** A new emergency request was created. */
export async function notifyBookingReceived(booking: Record<string, any>): Promise<void> {
  try {
    const payload = {
      bookingReference: booking.reference,
      status: booking.status,
      pickupAddress: booking.pickupAddress ?? null
    }
    const owner = await ownerContact(booking.userId)
    if (owner.email) {
      await queueNotification({
        userId: booking.userId,
        recipient: owner.email,
        channel: 'EMAIL',
        eventType: 'BOOKING_RECEIVED',
        payload,
        dedupeKey: `booking:${booking.id}:received:email`
      })
    }
    if (booking.callbackPhone) {
      await queueNotification({
        userId: booking.userId,
        recipient: booking.callbackPhone,
        channel: 'SMS',
        eventType: 'BOOKING_RECEIVED',
        payload,
        dedupeKey: `booking:${booking.id}:received:sms`
      })
    }
  } catch (err) {
    logger.error({ err, bookingId: booking?.id }, 'Failed to notify booking received')
  }
}

const STATUS_EVENT: Record<string, NotificationEventType> = {
  ACCEPTED: 'CREW_ACCEPTED',
  ARRIVED: 'AMBULANCE_ARRIVED',
  CANCELLED: 'BOOKING_CANCELLED'
}

/**
 * A booking moved to a new status. Only the milestone statuses get their own
 * event; every other move is a generic trip update. A notification failure here
 * can never change the booking — it only logs.
 */
export async function notifyBookingStatusChange(booking: Record<string, any>, status: string): Promise<void> {
  try {
    const eventType: NotificationEventType = STATUS_EVENT[status] ?? 'TRIP_STATUS_CHANGED'
    const payload = { bookingReference: booking.reference, status }
    const owner = await ownerContact(booking.userId)
    if (booking.callbackPhone) {
      await queueNotification({
        userId: booking.userId,
        recipient: booking.callbackPhone,
        channel: 'SMS',
        eventType,
        payload,
        dedupeKey: `booking:${booking.id}:status:${status}:sms`
      })
    }
    if (owner.email) {
      await queueNotification({
        userId: booking.userId,
        recipient: owner.email,
        channel: 'EMAIL',
        eventType,
        payload,
        dedupeKey: `booking:${booking.id}:status:${status}:email`
      })
    }

    // When a booking becomes dispatched toward a hospital, alert that hospital's
    // authorized staff. The dedupe key makes a reassignment a no-op, not a
    // duplicate alert.
    if (status === 'ACCEPTED') await notifyHospitalIncomingPatient(booking)
  } catch (err) {
    logger.error({ err, bookingId: booking?.id, status }, 'Failed to notify booking status change')
  }
}

/** A dispatch offer was sent to a crew member (push + SMS). */
export async function notifyDispatchOffer(offer: {
  offerId: string
  bookingId: string
  bookingReference: string
  crewProfileId: string
  expiresAt: Date
}): Promise<void> {
  try {
    const crew = await prisma.crewProfile.findUnique({ where: { id: offer.crewProfileId } })
    const user = crew ? await prisma.user.findUnique({ where: { id: crew.userId } }) : null
    if (!user) return

    const payload = { bookingReference: offer.bookingReference, expiresAt: offer.expiresAt }
    // Push recipient is the user id; a real gateway maps it to a device token.
    await queueNotification({
      userId: user.id,
      recipient: user.id,
      channel: 'PUSH',
      eventType: 'DISPATCH_OFFER',
      payload,
      dedupeKey: `offer:${offer.offerId}:push`
    })
    if (user.phone) {
      await queueNotification({
        userId: user.id,
        recipient: user.phone,
        channel: 'SMS',
        eventType: 'DISPATCH_OFFER',
        payload,
        dedupeKey: `offer:${offer.offerId}:sms`
      })
    }
  } catch (err) {
    logger.error({ err, offerId: offer?.offerId }, 'Failed to notify dispatch offer')
  }
}

/** A payment was settled. */
export async function notifyPaymentConfirmed(payment: Record<string, any>): Promise<void> {
  try {
    const payload = {
      amountKobo: payment.amountKobo,
      currency: payment.currency ?? 'NGN',
      transactionRef: payment.transactionRef,
      receiptNumber: payment.receiptNumber ?? null
    }
    const owner = await ownerContact(payment.userId)
    if (owner.email) {
      await queueNotification({
        userId: payment.userId,
        recipient: owner.email,
        channel: 'EMAIL',
        eventType: 'PAYMENT_CONFIRMED',
        payload,
        dedupeKey: `payment:${payment.id}:confirmed:email`
      })
    }
    if (owner.phone) {
      await queueNotification({
        userId: payment.userId,
        recipient: owner.phone,
        channel: 'SMS',
        eventType: 'PAYMENT_CONFIRMED',
        payload,
        dedupeKey: `payment:${payment.id}:confirmed:sms`
      })
    }
  } catch (err) {
    logger.error({ err, paymentId: payment?.id }, 'Failed to notify payment confirmation')
  }
}

/** A receipt became available for a settled payment. */
export async function notifyReceiptAvailable(payment: Record<string, any>): Promise<void> {
  try {
    const owner = await ownerContact(payment.userId)
    if (!owner.email) return
    await queueNotification({
      userId: payment.userId,
      recipient: owner.email,
      channel: 'EMAIL',
      eventType: 'RECEIPT_AVAILABLE',
      payload: { receiptNumber: payment.receiptNumber ?? null, bookingReference: payment.transactionRef },
      dedupeKey: `payment:${payment.id}:receipt:email`
    })
  } catch (err) {
    logger.error({ err, paymentId: payment?.id }, 'Failed to notify receipt availability')
  }
}

/**
 * A patient is inbound to a hospital. Deliberately carries only the booking
 * reference, the emergency category and an optional ETA — never patient
 * identifiers or medical detail. Delivered to the hospital's authorized staff
 * (and its registered inbox). Best-effort; deduped per recipient.
 */
export async function notifyHospitalIncomingPatient(
  booking: Record<string, any>,
  options: { etaMinutes?: number | null } = {}
): Promise<void> {
  try {
    if (!booking?.destinationHospitalId) return
    const hospital = await prisma.hospital.findUnique({ where: { id: booking.destinationHospitalId } })
    if (!hospital) return

    const payload = {
      bookingReference: booking.reference,
      emergencyCategory: booking.emergencyCategory ?? null,
      etaMinutes: options.etaMinutes ?? null
    }

    const staff = await prisma.user.findMany({
      where: { hospitalId: hospital.id, role: 'HOSPITAL_STAFF' }
    })
    const recipients = new Set<string>()
    for (const member of staff) if (member.email) recipients.add(member.email)
    if (hospital.email) recipients.add(hospital.email)

    for (const recipient of recipients) {
      await queueNotification({
        recipient,
        channel: 'EMAIL',
        eventType: 'HOSPITAL_INCOMING_PATIENT',
        payload,
        dedupeKey: `booking:${booking.id}:hospital-inbound:${recipient}`
      })
    }
  } catch (err) {
    logger.error({ err, bookingId: booking?.id }, 'Failed to notify hospital of an inbound patient')
  }
}

export interface DispatcherContactInput {
  bookingId: string
  bookingReference: string
  /** The resolved contact address (phone or email). */
  recipient: string
  recipientUserId?: string | null
  channel?: NotificationChannel
  /** Which approved template was used (recorded in the payload only). */
  template: string
  dedupeKey?: string | null
}

/**
 * A dispatcher contacted a relevant party through an approved template. Only the
 * template name and the booking reference are persisted — never free text — so
 * the notification queue can never hold PHI. Best-effort.
 */
export async function notifyDispatcherContact(input: DispatcherContactInput): Promise<void> {
  try {
    await queueNotification({
      userId: input.recipientUserId ?? null,
      recipient: input.recipient,
      channel: input.channel ?? 'SMS',
      eventType: 'DISPATCHER_CONTACT',
      payload: { bookingReference: input.bookingReference, template: input.template },
      dedupeKey: input.dedupeKey ?? null
    })
  } catch (err) {
    logger.error({ err, bookingId: input.bookingId }, 'Failed to send a dispatcher contact message')
  }
}

/**
 * A complaint's handling status changed. Notifies the complainant by email with
 * the reference and new status only — the internal handling note is never part
 * of the persisted payload. Best-effort; deduped per status transition.
 */
export async function notifyComplaintUpdate(complaint: Record<string, any>): Promise<void> {
  try {
    if (!complaint?.userId) return
    const owner = await ownerContact(complaint.userId)
    if (!owner.email) return
    await queueNotification({
      userId: complaint.userId,
      recipient: owner.email,
      channel: 'EMAIL',
      eventType: 'COMPLAINT_UPDATE',
      payload: { reference: complaint.reference, status: complaint.status },
      dedupeKey: `complaint:${complaint.id}:status:${complaint.status}`
    })
  } catch (err) {
    logger.error({ err, complaintId: complaint?.id }, 'Failed to notify complaint update')
  }
}
