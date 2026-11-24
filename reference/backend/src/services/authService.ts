import bcrypt from 'bcryptjs'
import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import { issueOtp, verifyOtp } from './otpService'
import { mailer } from './mailService'
import { deliverOtp } from './notificationService'
import {
  createSession,
  revokeAllUserSessions,
  revokeSessionById,
  revokeSessionByToken,
  rotateRefreshToken,
  listActiveSessions,
  findSessionById,
  type SessionMeta,
  type TokenPair
} from './tokenService'
import { logger } from '../utils/logger'

const BCRYPT_ROUNDS = 10

/** A fixed hash used to equalise timing when the account does not exist. */
const DUMMY_HASH = bcrypt.hashSync('medimove-timing-equaliser', BCRYPT_ROUNDS)

function invalidCredentials(): AppError {
  return new AppError(401, 'Invalid email or password.', { code: 'INVALID_CREDENTIALS' })
}

export interface AuthResult {
  user: Record<string, unknown>
  tokens: TokenPair
}

/**
 * Registration. Never reveals whether an email is already registered:
 * - verified account  -> generic response (+ informational email)
 * - unverified account -> resend verification code
 * - new account        -> create (unverified) and send verification code
 */
export async function register(
  input: { email: string; password: string; fullName: string; phone: string },
  _meta: SessionMeta
): Promise<void> {
  const { email, password, fullName, phone } = input

  const existing = await prisma.user.findUnique({ where: { email } })

  if (existing?.emailVerified) {
    await mailer.sendAccountExistsEmail(email).catch((err) => {
      logger.warn({ err }, 'Failed to send account-exists email')
    })
    return
  }

  let user = existing
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        fullName,
        phone,
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        emailVerified: false,
        // Role is always assigned server-side. Registration can never grant a
        // privileged role, regardless of what the client sends.
        role: 'PATIENT'
      }
    })
  }

  try {
    const otp = await issueOtp({ userId: user.id, email, purpose: 'EMAIL_VERIFICATION' })
    await deliverOtp({
      userId: user.id,
      channel: 'EMAIL',
      to: email,
      code: otp.code,
      purpose: 'EMAIL_VERIFICATION',
      expiresInMinutes: otp.expiresInMinutes
    })
  } catch (err) {
    // Resend cooldown (or mail failure) must not leak account state.
    if (err instanceof AppError && err.status === 429) return
    throw err
  }
}

/** Confirms an email-verification code and signs the user in. */
export async function verifyEmail(
  input: { email: string; code: string },
  meta: SessionMeta
): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } })
  if (!user) {
    throw new AppError(400, 'Invalid or expired verification code.', { code: 'OTP_INVALID' })
  }
  // A suspended account cannot complete verification or start a session. The
  // check is explicit (`=== false`) so records that predate the flag stay active.
  if ((user as { isActive?: boolean | null }).isActive === false) {
    throw new AppError(403, 'This account has been suspended.', { code: 'ACCOUNT_SUSPENDED' })
  }

  await verifyOtp({ userId: user.id, purpose: 'EMAIL_VERIFICATION', code: input.code })

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, emailVerifiedAt: new Date() }
  })

  const tokens = await createSession({ id: updated.id, email: updated.email }, meta)
  return { user: updated, tokens }
}

/** Resends a verification code. Always responds generically. */
export async function resendVerification(input: { email: string }): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: input.email } })
  if (!user || user.emailVerified) return

  const otp = await issueOtp({ userId: user.id, email: user.email, purpose: 'EMAIL_VERIFICATION' })
  await deliverOtp({
    userId: user.id,
    channel: 'EMAIL',
    to: user.email,
    code: otp.code,
    purpose: 'EMAIL_VERIFICATION',
    expiresInMinutes: otp.expiresInMinutes
  })
}

/** Email + password login. Requires a verified email address. */
export async function login(
  input: { email: string; password: string },
  meta: SessionMeta
): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } })

  if (!user || !user.passwordHash) {
    // Compare against a dummy hash to reduce user-enumeration via timing.
    await bcrypt.compare(input.password, DUMMY_HASH)
    throw invalidCredentials()
  }

  const passwordOk = await bcrypt.compare(input.password, user.passwordHash)
  if (!passwordOk) throw invalidCredentials()

  // A suspended account cannot start a new session, even with correct
  // credentials. The check is explicit (`=== false`) so records that predate the
  // flag remain active.
  if ((user as { isActive?: boolean | null }).isActive === false) {
    throw new AppError(403, 'This account has been suspended.', { code: 'ACCOUNT_SUSPENDED' })
  }

  if (!user.emailVerified) {
    try {
      const otp = await issueOtp({ userId: user.id, email: user.email, purpose: 'EMAIL_VERIFICATION' })
      await deliverOtp({
        userId: user.id,
        channel: 'EMAIL',
        to: user.email,
        code: otp.code,
        purpose: 'EMAIL_VERIFICATION',
        expiresInMinutes: otp.expiresInMinutes
      })
    } catch {
      // Cooldown or delivery failure — the verification error still applies.
    }
    throw new AppError(403, 'Your email address is not verified. A new verification code has been sent.', {
      code: 'EMAIL_NOT_VERIFIED'
    })
  }

  const tokens = await createSession({ id: user.id, email: user.email }, meta)
  return { user, tokens }
}

export async function refresh(rawToken: string, meta: SessionMeta): Promise<TokenPair> {
  return rotateRefreshToken(rawToken, meta)
}

export async function logout(params: { userId?: string; sessionId?: string; refreshToken?: string }): Promise<void> {
  if (params.refreshToken) {
    await revokeSessionByToken(params.refreshToken, 'LOGOUT')
    return
  }
  if (params.sessionId) {
    await revokeSessionById(params.sessionId, 'LOGOUT')
  }
}

export async function logoutAll(userId: string): Promise<void> {
  await revokeAllUserSessions(userId, 'LOGOUT_ALL')
}

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new AppError(404, 'User not found.', { code: 'USER_NOT_FOUND' })
  return user
}

export async function listSessions(userId: string, currentSessionId?: string) {
  const sessions = await listActiveSessions(userId)
  return sessions.map((s: any) => ({
    id: s.id,
    deviceLabel: s.deviceLabel,
    userAgent: s.userAgent,
    ipAddress: s.ipAddress,
    createdAt: s.createdAt,
    lastUsedAt: s.lastUsedAt,
    expiresAt: s.expiresAt,
    isCurrent: s.id === currentSessionId
  }))
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const session = await findSessionById(sessionId)
  if (!session || session.userId !== userId) {
    throw new AppError(404, 'Session not found.', { code: 'SESSION_NOT_FOUND' })
  }
  await revokeSessionById(sessionId, 'REVOKED_BY_USER')
}

export async function changePassword(
  userId: string,
  currentSessionId: string | undefined,
  input: { currentPassword: string; newPassword: string }
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new AppError(404, 'User not found.', { code: 'USER_NOT_FOUND' })

  if (!user.passwordHash || !(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    throw new AppError(401, 'Current password is incorrect.', { code: 'INVALID_CURRENT_PASSWORD' })
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS),
      passwordChangedAt: new Date()
    }
  })

  // Sign out every other device; keep the current session active.
  await revokeAllUserSessions(userId, 'PASSWORD_CHANGED', currentSessionId)
  await mailer.sendPasswordChangedEmail(user.email).catch((err) => {
    logger.warn({ err }, 'Failed to send password-changed email')
  })
}

/** Starts a password reset. Always responds generically. */
export async function forgotPassword(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) return

  try {
    const otp = await issueOtp({ userId: user.id, email: user.email, purpose: 'PASSWORD_RESET' })
    await deliverOtp({
      userId: user.id,
      channel: 'EMAIL',
      to: user.email,
      code: otp.code,
      purpose: 'PASSWORD_RESET',
      expiresInMinutes: otp.expiresInMinutes
    })
  } catch (err) {
    if (err instanceof AppError && err.status === 429) return
    throw err
  }
}

/** Completes a password reset and revokes all existing sessions. */
export async function resetPassword(input: {
  email: string
  code: string
  newPassword: string
}): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: input.email } })
  if (!user) {
    throw new AppError(400, 'Invalid or expired reset code.', { code: 'OTP_INVALID' })
  }

  await verifyOtp({ userId: user.id, purpose: 'PASSWORD_RESET', code: input.code })

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS),
      passwordChangedAt: new Date(),
      // A successful reset also proves control of the mailbox.
      emailVerified: true,
      emailVerifiedAt: user.emailVerifiedAt ?? new Date()
    }
  })

  await revokeAllUserSessions(user.id, 'PASSWORD_RESET')
  await mailer.sendPasswordChangedEmail(user.email).catch((err) => {
    logger.warn({ err }, 'Failed to send password-changed email')
  })
}
