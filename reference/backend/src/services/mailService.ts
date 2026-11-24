import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '../config/env'
import { AppError } from '../errors/AppError'
import { logger } from '../utils/logger'

/**
 * Email delivery. All nodemailer usage lives here so that authentication logic
 * stays completely independent of the transport.
 *
 * In production a real SMTP transport is mandatory (enforced in config/env.ts).
 * In development, when SMTP is not configured, OTP codes are written to the
 * development log ONLY — never in production.
 */

export type MailPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'ACCOUNT_CHANGE'

export interface OtpEmailParams {
  to: string
  code: string
  purpose: MailPurpose
  expiresInMinutes: number
}

/** A free-form transactional email (no OTP code embedded by this module). */
export interface OutboundEmail {
  to: string
  subject: string
  text: string
  html?: string
  replyTo?: string
}

export interface Mailer {
  sendOtpEmail(params: OtpEmailParams): Promise<void>
  sendPasswordChangedEmail(to: string): Promise<void>
  sendAccountExistsEmail(to: string): Promise<void>
  /** Generic transactional send used by the notification service adapters. */
  sendMessage(params: OutboundEmail): Promise<void>
}

let transporter: Transporter | null = null
let initialized = false

function getTransporter(): Transporter | null {
  if (initialized) return transporter
  initialized = true

  if (!env.SMTP_HOST) return null

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
  })

  return transporter
}

const PURPOSE_SUBJECT: Record<MailPurpose, string> = {
  EMAIL_VERIFICATION: 'Verify your MediMove account',
  PASSWORD_RESET: 'Reset your MediMove password',
  ACCOUNT_CHANGE: 'Confirm your MediMove security change'
}

const PURPOSE_INTRO: Record<MailPurpose, string> = {
  EMAIL_VERIFICATION: 'Use the code below to verify your email address and activate your account.',
  PASSWORD_RESET: 'Use the code below to reset your MediMove password.',
  ACCOUNT_CHANGE: 'Use the code below to confirm this security-sensitive change.'
}

async function deliver(to: string, subject: string, text: string, html: string): Promise<void> {
  const transport = getTransporter()

  if (!transport) {
    if (env.NODE_ENV === 'production') {
      // Should be unreachable: production requires SMTP_HOST at startup.
      throw new AppError(503, 'Email delivery is not configured.')
    }
    logger.info({ to, subject, body: text }, '📧 Email (development only — not sent)')
    return
  }

  await transport.sendMail({
    from: env.SMTP_FROM,
    to,
    replyTo: env.SMTP_REPLY_TO,
    subject,
    text,
    html
  })
}

export const mailer: Mailer = {
  async sendOtpEmail({ to, code, purpose, expiresInMinutes }) {
    const subject = PURPOSE_SUBJECT[purpose]
    const text =
      `${PURPOSE_INTRO[purpose]}\n\n` +
      `Your verification code is: ${code}\n\n` +
      `This code expires in ${expiresInMinutes} minutes. ` +
      `If you did not request it, you can safely ignore this email.\n\n` +
      `— MediMove`

    const html =
      `<p>${PURPOSE_INTRO[purpose]}</p>` +
      `<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>` +
      `<p>This code expires in ${expiresInMinutes} minutes. If you did not request it, you can safely ignore this email.</p>` +
      `<p>— MediMove</p>`

    await deliver(to, subject, text, html)
  },

  async sendPasswordChangedEmail(to) {
    const subject = 'Your MediMove password was changed'
    const text =
      'Your MediMove password was changed and all other sessions were signed out.\n\n' +
      'If this was not you, reset your password immediately.\n\n— MediMove'
    await deliver(to, subject, text, `<p>${text.replace(/\n/g, '<br/>')}</p>`)
  },

  async sendAccountExistsEmail(to) {
    const subject = 'A MediMove account already exists for this email'
    const text =
      'Someone tried to create a MediMove account with this email address, but one already exists.\n\n' +
      'If this was you, sign in or reset your password. Otherwise you can ignore this message.\n\n— MediMove'
    await deliver(to, subject, text, `<p>${text.replace(/\n/g, '<br/>')}</p>`)
  },

  async sendMessage({ to, subject, text, html, replyTo }) {
    const transport = getTransporter()

    if (!transport) {
      if (env.NODE_ENV === 'production') {
        throw new AppError(503, 'Email delivery is not configured.')
      }
      logger.info({ to, subject, body: text }, '📧 Email (development only — not sent)')
      return
    }

    await transport.sendMail({
      from: env.SMTP_FROM,
      to,
      replyTo: replyTo ?? env.SMTP_REPLY_TO,
      subject,
      text,
      html: html ?? `<p>${text.replace(/\n/g, '<br/>')}</p>`
    })
  }
}
