import { env } from '../config/env'
import { AppError } from '../errors/AppError'
import { logger } from '../utils/logger'
import { mailer } from './mailService'
import { smsSender } from './smsService'
import type { NotificationChannel } from '../generated/prisma/enums'

/**
 * Replaceable channel adapters.
 *
 * The notification service never talks to a provider directly; it resolves an
 * adapter by channel from a registry. Swapping a provider (a real SMS gateway,
 * an FCM/APNs push gateway, a WhatsApp Business provider) means registering a new
 * adapter — no caller or template changes. Tests register fakes the same way.
 */

export interface OutboundMessage {
  /** Opaque destination: an email address, phone number or push token. */
  to: string
  subject: string
  text: string
  html?: string
  metadata?: Record<string, unknown>
}

export interface DeliveryResult {
  provider: string
  providerMessageId?: string | null
}

export interface NotificationAdapter {
  readonly channel: NotificationChannel
  readonly provider: string
  send(message: OutboundMessage): Promise<DeliveryResult>
}

/** Email via the configured SMTP transport. */
export const emailAdapter: NotificationAdapter = {
  channel: 'EMAIL',
  provider: 'smtp',
  async send(message) {
    await mailer.sendMessage({
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html
    })
    return { provider: 'smtp', providerMessageId: null }
  }
}

/** SMS via the configured gateway (none wired yet — fails closed in prod). */
export const smsAdapter: NotificationAdapter = {
  channel: 'SMS',
  provider: env.SMS_PROVIDER ?? 'sms',
  async send(message) {
    await smsSender.sendMessage({ to: message.to, text: message.text })
    return { provider: env.SMS_PROVIDER ?? 'sms', providerMessageId: null }
  }
}

/**
 * Push via a mobile gateway. No SDK is wired in yet: in development the message
 * is logged; in production an unconfigured push channel fails closed so a
 * misconfigured deployment can never silently drop a dispatch offer.
 */
export const pushAdapter: NotificationAdapter = {
  channel: 'PUSH',
  provider: env.PUSH_PROVIDER ?? 'push',
  async send(message) {
    if (!env.PUSH_PROVIDER) {
      if (env.NODE_ENV === 'production') {
        throw new AppError(503, 'Push delivery is not configured.')
      }
      logger.info({ to: message.to, subject: message.subject, text: message.text }, '🔔 Push (development only — not sent)')
      return { provider: 'push', providerMessageId: null }
    }
    // A real push gateway integration belongs here.
    throw new AppError(503, 'Push delivery is not configured.')
  }
}

/**
 * WhatsApp via a Business provider. Same fail-closed rules as push: no provider
 * is wired in yet, so development logs and production rejects.
 */
export const whatsappAdapter: NotificationAdapter = {
  channel: 'WHATSAPP',
  provider: env.WHATSAPP_PROVIDER ?? 'whatsapp',
  async send(message) {
    if (!env.WHATSAPP_PROVIDER) {
      if (env.NODE_ENV === 'production') {
        throw new AppError(503, 'WhatsApp delivery is not configured.')
      }
      logger.info({ to: message.to, text: message.text }, '💬 WhatsApp (development only — not sent)')
      return { provider: 'whatsapp', providerMessageId: null }
    }
    // A real WhatsApp Business integration belongs here.
    throw new AppError(503, 'WhatsApp delivery is not configured.')
  }
}

const registry = new Map<NotificationChannel, NotificationAdapter>()

/** Registers (or replaces) the adapter for a channel. */
export function registerAdapter(adapter: NotificationAdapter): void {
  registry.set(adapter.channel, adapter)
}

/** Resolves the adapter for a channel, failing closed when none is registered. */
export function getAdapter(channel: NotificationChannel): NotificationAdapter {
  const adapter = registry.get(channel)
  if (!adapter) {
    throw new AppError(503, `No notification adapter is registered for channel ${channel}.`, {
      code: 'NO_NOTIFICATION_ADAPTER'
    })
  }
  return adapter
}

/** Restores the default adapter set (used at boot and by tests). */
export function resetAdapters(): void {
  registry.clear()
  registerAdapter(emailAdapter)
  registerAdapter(smsAdapter)
  registerAdapter(pushAdapter)
  registerAdapter(whatsappAdapter)
}

resetAdapters()
