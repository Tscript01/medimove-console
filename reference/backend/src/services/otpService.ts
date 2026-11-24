import { prisma } from '../utils/prisma'
import { env } from '../config/env'
import { AppError } from '../errors/AppError'
import { generateNumericOtp, hashOtp, safeEqual } from '../utils/crypto'
import { logger } from '../utils/logger'

export type OtpPurpose =
  | 'EMAIL_VERIFICATION'
  | 'PASSWORD_RESET'
  | 'ACCOUNT_CHANGE'
  | 'PHONE_VERIFICATION'

export interface IssuedOtp {
  code: string
  expiresAt: Date
  expiresInMinutes: number
}

function cooldownMs(): number {
  return env.OTP_RESEND_COOLDOWN_SECONDS * 1000
}

function ttlMs(): number {
  return env.OTP_TTL_MINUTES * 60 * 1000
}

/**
 * Creates (and returns) a fresh OTP challenge. Enforces the resend cooldown and
 * invalidates any previous active challenge for the same user + purpose.
 *
 * The returned plaintext code is the ONLY place it exists; callers are
 * responsible for delivering it (via the mailer) and must never persist or log
 * it in production.
 */
export async function issueOtp(params: {
  userId: string
  purpose: OtpPurpose
  /** Destination for email flows. */
  email?: string
  /** Destination for phone-verification flows. */
  phone?: string
}): Promise<IssuedOtp> {
  const { userId, purpose } = params
  const email = params.email ?? null
  const phone = params.phone ?? null

  const latest = await prisma.emailOtp.findFirst({
    where: { userId, purpose },
    orderBy: { createdAt: 'desc' }
  })

  if (latest) {
    const elapsed = Date.now() - new Date(latest.createdAt).getTime()
    if (elapsed < cooldownMs()) {
      const retryAfterSeconds = Math.max(1, Math.ceil((cooldownMs() - elapsed) / 1000))
      throw new AppError(
        429,
        `Please wait ${retryAfterSeconds} second(s) before requesting another code.`,
        { code: 'OTP_COOLDOWN', retryAfterSeconds }
      )
    }
  }

  // Invalidate previous active challenges so only the newest code is valid.
  await prisma.emailOtp.updateMany({
    where: { userId, purpose, consumedAt: null },
    data: { consumedAt: new Date() }
  })

  const code = generateNumericOtp(6)
  const expiresAt = new Date(Date.now() + ttlMs())

  await prisma.emailOtp.create({
    data: {
      userId,
      email,
      phone,
      purpose,
      codeHash: hashOtp(code),
      expiresAt,
      maxAttempts: env.OTP_MAX_ATTEMPTS
    }
  })

  return { code, expiresAt, expiresInMinutes: env.OTP_TTL_MINUTES }
}

/**
 * Verifies an OTP against the newest active challenge. Enforces expiry and the
 * maximum-attempts limit. Consumes the challenge on success (single use).
 */
export async function verifyOtp(params: {
  userId: string
  purpose: OtpPurpose
  code: string
  /**
   * For phone flows: the code is only valid for the exact destination it was
   * issued to. If the user changed their phone after requesting a code, the old
   * code must not verify the new number.
   */
  expectedPhone?: string
}): Promise<void> {
  const { userId, purpose, code } = params

  const challenge = await prisma.emailOtp.findFirst({
    where: { userId, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' }
  })

  if (!challenge) {
    throw new AppError(400, 'No active verification code. Please request a new one.', {
      code: 'OTP_NOT_FOUND'
    })
  }

  if (params.expectedPhone !== undefined && challenge.phone !== params.expectedPhone) {
    throw new AppError(400, 'This code is no longer valid. Please request a new one.', {
      code: 'OTP_STALE'
    })
  }

  if (new Date(challenge.expiresAt).getTime() < Date.now()) {
    await prisma.emailOtp.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } })
    throw new AppError(400, 'Verification code has expired. Please request a new one.', {
      code: 'OTP_EXPIRED'
    })
  }

  if (challenge.attempts >= challenge.maxAttempts) {
    await prisma.emailOtp.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } })
    throw new AppError(429, 'Too many incorrect attempts. Please request a new code.', {
      code: 'OTP_MAX_ATTEMPTS'
    })
  }

  if (!safeEqual(challenge.codeHash, hashOtp(code))) {
    const updated = await prisma.emailOtp.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } }
    })
    const remaining = Math.max(0, challenge.maxAttempts - updated.attempts)
    if (remaining <= 0) {
      await prisma.emailOtp.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } })
      throw new AppError(429, 'Too many incorrect attempts. Please request a new code.', {
        code: 'OTP_MAX_ATTEMPTS'
      })
    }
    throw new AppError(400, `Incorrect verification code. ${remaining} attempt(s) remaining.`, {
      code: 'OTP_INVALID',
      attemptsRemaining: remaining
    })
  }

  await prisma.emailOtp.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } })
  logger.debug({ userId, purpose }, 'OTP challenge verified')
}
