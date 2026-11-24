import type { NotificationEventType } from '../generated/prisma/enums'

/**
 * Notification templates.
 *
 * Rendering is a pure function of the event type and a small, non-sensitive
 * payload (a booking reference, a status, an amount). Patient names, medical
 * notes and OTP codes are deliberately never part of a persisted payload, so a
 * rendered message can never leak PHI from the queue.
 */

export interface RenderedNotification {
  subject: string
  /** Full text body (email/SMS/WhatsApp). */
  text: string
  html: string
  /** One-line body suitable for a push notification. */
  short: string
}

type Payload = Record<string, any>

function naira(kobo: unknown): string {
  const value = Number(kobo ?? 0) / 100
  return `₦${value.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'received',
  OFFERED: 'being assigned',
  ACCEPTED: 'accepted by a crew',
  EN_ROUTE: 'on the way',
  ARRIVED: 'arrived at the pickup point',
  PATIENT_ON_BOARD: 'patient on board',
  AT_HOSPITAL: 'at the hospital',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  FAILED: 'unable to complete'
}

const COMPLAINT_STATUS_LABEL: Record<string, string> = {
  OPEN: 'received',
  IN_REVIEW: 'under review',
  RESOLVED: 'resolved',
  REJECTED: 'rejected',
  CLOSED: 'closed'
}

function wrap(subject: string, body: string): RenderedNotification {
  const text = `${body}\n\n— MediMove`
  return {
    subject,
    text,
    html: `<p>${body.replace(/\n/g, '<br/>')}</p><p>— MediMove</p>`,
    short: body.split('\n')[0]
  }
}

/** Renders the message for a notification. Unknown events fall back to a safe generic. */
export function renderNotification(eventType: NotificationEventType, payload: Payload = {}): RenderedNotification {
  const reference = str(payload.bookingReference ?? payload.reference, 'your request')

  switch (eventType) {
    case 'REGISTRATION_VERIFICATION':
      return wrap(
        'Verify your MediMove account',
        'Use the verification code we just sent to activate your MediMove account.'
      )

    case 'OTP_DELIVERY':
      return wrap('Your MediMove verification code', 'Use the verification code we just sent to continue.')

    case 'BOOKING_RECEIVED':
      return wrap(
        `Emergency request ${reference} received`,
        `We have received your emergency request (${reference}) and are finding the nearest available ambulance.`
      )

    case 'DISPATCH_OFFER':
      return wrap(
        'New ambulance job offer',
        `A new emergency job (${reference}) is available. Open MediMove to accept or decline it before it expires.`
      )

    case 'CREW_ACCEPTED':
      return wrap(
        `Ambulance assigned to ${reference}`,
        `A crew has accepted your emergency request (${reference}) and is preparing to respond.`
      )

    case 'AMBULANCE_ARRIVED':
      return wrap(
        `Ambulance arrived for ${reference}`,
        `The ambulance for your request (${reference}) has arrived at the pickup point.`
      )

    case 'TRIP_STATUS_CHANGED': {
      const label = STATUS_LABEL[str(payload.status)] ?? 'updated'
      return wrap(`Trip ${reference} ${label}`, `Your emergency request (${reference}) is now ${label}.`)
    }

    case 'BOOKING_CANCELLED':
      return wrap(
        `Request ${reference} cancelled`,
        `Your emergency request (${reference}) has been cancelled. If this is unexpected, please contact support.`
      )

    case 'PAYMENT_CONFIRMED':
      return wrap(
        'Payment confirmed',
        `We have confirmed your payment of ${naira(payload.amountKobo)} for request ${reference}. Thank you.`
      )

    case 'RECEIPT_AVAILABLE':
      return wrap(
        'Your MediMove receipt is ready',
        `Your receipt ${str(payload.receiptNumber, '')} for request ${reference} is now available in the app.`.replace('  ', ' ')
      )

    case 'HOSPITAL_INCOMING_PATIENT': {
      const eta = payload.etaMinutes != null ? ` Estimated arrival in about ${payload.etaMinutes} minutes.` : ''
      const category = str(payload.emergencyCategory)
      const categoryText = category ? ` (${category.toLowerCase()})` : ''
      return wrap(
        `Incoming patient for ${reference}`,
        `An ambulance is inbound to your hospital for request ${reference}${categoryText}.${eta}`.replace('..', '.')
      )
    }

    case 'DISPATCHER_CONTACT':
      return wrap(
        `Update on request ${reference}`,
        `A MediMove dispatcher has sent you an update regarding request ${reference}. Please open the app for details.`
      )

    case 'COMPLAINT_UPDATE': {
      const label = COMPLAINT_STATUS_LABEL[str(payload.status)] ?? 'updated'
      return wrap(
        `Your complaint ${reference} is ${label}`,
        `Your complaint (${reference}) is now ${label}. Open the app to see the details.`
      )
    }

    default:
      return wrap('MediMove update', 'You have a new update on MediMove.')
  }
}
