import { logger } from '../utils/logger'
import { notifyDispatchOffer } from './notificationService'

/**
 * Crew notification hook for dispatch offers.
 *
 * The offer is enqueued through the reusable notification service (push + SMS
 * where the crew has a phone), which delivers it out-of-band with retries. This
 * is deliberately best-effort and only ever receives *identifiers* — never
 * patient data — so a failed or noisy notification can neither break dispatch
 * nor leak PHI. Swapping in a real transport means implementing an adapter in
 * `notificationAdapters`; no caller changes are required.
 */

export interface DispatchOfferNotification {
  offerId: string
  bookingId: string
  bookingReference: string
  providerId: string
  ambulanceId: string
  crewProfileId: string
  expiresAt: Date
}

export interface DispatchNotifier {
  notifyOffer(notification: DispatchOfferNotification): Promise<void>
}

export const dispatchNotifier: DispatchNotifier = {
  async notifyOffer(notification) {
    // Identifiers only — never the patient's name, phone, notes or location.
    await notifyDispatchOffer({
      offerId: notification.offerId,
      bookingId: notification.bookingId,
      bookingReference: notification.bookingReference,
      crewProfileId: notification.crewProfileId,
      expiresAt: notification.expiresAt
    })
    logger.debug({ offerId: notification.offerId }, 'Dispatch offer queued for crew notification')
  }
}
