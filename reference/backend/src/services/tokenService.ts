import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { prisma } from '../utils/prisma'
import { env, accessTokenSecret } from '../config/env'
import { AppError } from '../errors/AppError'
import { generateRefreshToken, hashToken } from '../utils/crypto'
import { describeDevice } from '../utils/device'
import { logger } from '../utils/logger'

export interface SessionMeta {
  userAgent?: string | null
  ipAddress?: string | null
}

export interface TokenUser {
  id: string
  email: string
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  accessTokenExpiresIn: string
  refreshTokenExpiresAt: Date
  sessionId: string
}

export interface AccessClaims {
  userId: string
  email: string
  sessionId: string
}

function refreshTtlMs(): number {
  return env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
}

/** Signs a short-lived access token bound to a specific session. */
export function signAccessToken(user: TokenUser, sessionId: string): string {
  return jwt.sign(
    { sub: user.id, userId: user.id, email: user.email, sid: sessionId, type: 'access' },
    accessTokenSecret,
    { expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'] }
  )
}

/** Verifies an access token and returns its claims, or throws a 401 AppError. */
export function verifyAccessToken(token: string): AccessClaims {
  let decoded: jwt.JwtPayload | string
  try {
    decoded = jwt.verify(token, accessTokenSecret)
  } catch {
    throw new AppError(401, 'Invalid or expired access token.', { code: 'TOKEN_INVALID' })
  }

  if (typeof decoded === 'string' || decoded.type !== 'access' || !decoded.sub || !decoded.sid) {
    throw new AppError(401, 'Invalid access token.', { code: 'TOKEN_INVALID' })
  }

  return { userId: String(decoded.sub), email: String(decoded.email ?? ''), sessionId: String(decoded.sid) }
}

/** Creates a brand-new session (login / email verification). */
export async function createSession(user: TokenUser, meta: SessionMeta = {}): Promise<TokenPair> {
  const refreshToken = generateRefreshToken()
  const familyId = randomUUID()
  const now = Date.now()
  const expiresAt = new Date(now + refreshTtlMs())

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      familyId,
      refreshTokenHash: hashToken(refreshToken),
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
      deviceLabel: describeDevice(meta.userAgent),
      expiresAt,
      absoluteExpiresAt: expiresAt,
      lastUsedAt: new Date()
    }
  })

  return {
    accessToken: signAccessToken(user, session.id),
    refreshToken,
    accessTokenExpiresIn: env.ACCESS_TOKEN_TTL,
    refreshTokenExpiresAt: expiresAt,
    sessionId: session.id
  }
}

/**
 * Rotates a refresh token. Detects reuse: if an already-revoked token is
 * presented, the entire session family is revoked (a stolen token cannot be
 * used alongside the legitimate one).
 */
export async function rotateRefreshToken(rawToken: string, meta: SessionMeta = {}): Promise<TokenPair> {
  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: hashToken(rawToken) }
  })

  if (!session) {
    throw new AppError(401, 'Invalid refresh token.', { code: 'REFRESH_INVALID' })
  }

  if (session.revokedAt) {
    await prisma.session.updateMany({
      where: { familyId: session.familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' }
    })
    logger.warn(
      { userId: session.userId, familyId: session.familyId },
      'Refresh token reuse detected — revoked the entire session family'
    )
    throw new AppError(401, 'Refresh token has already been used. Please sign in again.', {
      code: 'REFRESH_REUSE'
    })
  }

  const now = Date.now()
  if (new Date(session.expiresAt).getTime() < now || new Date(session.absoluteExpiresAt).getTime() < now) {
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), revokedReason: 'EXPIRED' }
    })
    throw new AppError(401, 'Refresh token expired. Please sign in again.', { code: 'REFRESH_EXPIRED' })
  }

  const newRefreshToken = generateRefreshToken()
  const expiresAt = new Date(now + refreshTtlMs())

  const user = await prisma.user.findUnique({ where: { id: session.userId } })
  if (!user) {
    throw new AppError(401, 'Account no longer exists.', { code: 'REFRESH_INVALID' })
  }
  // A suspended account cannot mint new sessions either.
  if ((user as { isActive?: boolean | null }).isActive === false) {
    throw new AppError(401, 'This account has been suspended.', { code: 'ACCOUNT_SUSPENDED' })
  }

  const newSession = await prisma.session.create({
    data: {
      userId: session.userId,
      familyId: session.familyId,
      refreshTokenHash: hashToken(newRefreshToken),
      userAgent: meta.userAgent ?? session.userAgent,
      ipAddress: meta.ipAddress ?? session.ipAddress,
      deviceLabel: session.deviceLabel,
      expiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      lastUsedAt: new Date()
    }
  })

  await prisma.session.update({
    where: { id: session.id },
    data: {
      revokedAt: new Date(),
      revokedReason: 'ROTATED',
      replacedBySessionId: newSession.id,
      lastUsedAt: new Date()
    }
  })

  return {
    accessToken: signAccessToken({ id: session.userId, email: user.email }, newSession.id),
    refreshToken: newRefreshToken,
    accessTokenExpiresIn: env.ACCESS_TOKEN_TTL,
    refreshTokenExpiresAt: expiresAt,
    sessionId: newSession.id
  }
}

/**
 * Returns the session when it exists, is not revoked and has not expired;
 * otherwise `null`. This is the single source of truth for session validity so
 * logout and revocation take effect on the very next request.
 */
export async function findActiveSession(sessionId: string) {
  const session = await prisma.session.findUnique({ where: { id: sessionId } })
  if (!session) return null
  if (session.revokedAt) return null
  if (new Date(session.expiresAt).getTime() <= Date.now()) return null
  return session
}

/** True when the session exists, is not revoked and has not expired. */
export async function isSessionActive(sessionId: string): Promise<boolean> {
  return (await findActiveSession(sessionId)) !== null
}

export async function revokeSessionById(sessionId: string, reason = 'LOGOUT'): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason }
  })
}

export async function revokeSessionByToken(rawToken: string, reason = 'LOGOUT'): Promise<void> {
  const session = await prisma.session.findUnique({ where: { refreshTokenHash: hashToken(rawToken) } })
  if (session) {
    await revokeSessionById(session.id, reason)
  }
}

/** Revokes every active session for a user, optionally sparing one (current). */
export async function revokeAllUserSessions(
  userId: string,
  reason = 'LOGOUT_ALL',
  exceptSessionId?: string
): Promise<void> {
  await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {})
    },
    data: { revokedAt: new Date(), revokedReason: reason }
  })
}

export async function listActiveSessions(userId: string) {
  return prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: 'desc' }
  })
}

export async function findSessionById(sessionId: string) {
  return prisma.session.findUnique({ where: { id: sessionId } })
}
