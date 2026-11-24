import { env } from '../config/env'
import { AppError } from '../errors/AppError'
import { logger } from '../utils/logger'

/**
 * SMS delivery for phone verification.
 *
 * No provider SDK is wired in yet. In development (and tests) the code is
 * written to the log so the flow is fully exercisable; in production a missing
 * provider fails closed rather than logging a code. Swapping in a real gateway
 * means implementing `sendOtpSms` here — no caller changes.
 */

export interface OtpSmsParams {
  to: string
  code: string
  expiresInMinutes: number
}

/** A free-form transactional SMS. */
export interface OutboundSms {
  to: string
  text: string
}

export interface SmsSender {
  sendOtpSms(params: OtpSmsParams): Promise<void>
  /** Generic transactional send used by the notification service adapters. */
  sendMessage(params: OutboundSms): Promise<void>
}

function requireConfigured(): void {
  if (!env.SMS_PROVIDER) {
    if (env.NODE_ENV === 'production') {
      throw new AppError(503, 'SMS delivery is not configured.')
    }
    // A real gateway integration belongs here. Until one is selected we fail
    // closed so a misconfigured deployment can never silently drop a message.
    throw new AppError(503, 'SMS delivery is not configured.')
  }
}

export const smsSender: SmsSender = {
  async sendOtpSms({ to, code, expiresInMinutes }) {
    if (!env.SMS_PROVIDER) {
      if (env.NODE_ENV === 'production') {
        throw new AppError(503, 'SMS delivery is not configured.')
      }
      // Development only — never log codes in production.
      logger.info({ to, code, expiresInMinutes }, '📱 SMS (development only — not sent)')
      return
    }

    // A real gateway integration belongs here. Until one is selected we fail
    // closed so a misconfigured deployment can never silently drop a code.
    throw new AppError(503, 'SMS delivery is not configured.')
  },

  async sendMessage({ to, text }) {
    requireConfigured()
    // Development only — a real gateway integration belongs here.
    logger.info({ to, text }, '📱 SMS (development only — not sent)')
  }
}
