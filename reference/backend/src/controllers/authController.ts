import type { Request, RequestHandler } from 'express'
import { AppError } from '../errors/AppError'
import { toPublicUser } from '../utils/serializers'
import type { SessionMeta } from '../services/tokenService'
import {
  changePassword,
  forgotPassword,
  getProfile,
  listSessions,
  login,
  logout,
  logoutAll,
  refresh,
  register,
  resendVerification,
  resetPassword,
  revokeSession,
  verifyEmail
} from '../services/authService'

function sessionMeta(req: Request): SessionMeta {
  return {
    userAgent: req.headers['user-agent'] ?? null,
    ipAddress: req.ip ?? req.socket?.remoteAddress ?? null
  }
}

function tokenResponse(user: any, tokens: any) {
  return {
    success: true,
    user: toPublicUser(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenType: 'Bearer',
    expiresIn: tokens.accessTokenExpiresIn,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt
  }
}

export const registerController: RequestHandler = async (req, res) => {
  await register(req.body, sessionMeta(req))
  res.status(201).json({
    success: true,
    message: 'If the details are valid, a verification code has been sent to your email.'
  })
}

export const verifyEmailController: RequestHandler = async (req, res) => {
  const { user, tokens } = await verifyEmail(req.body, sessionMeta(req))
  res.json(tokenResponse(user, tokens))
}

export const resendVerificationController: RequestHandler = async (req, res) => {
  await resendVerification(req.body)
  res.json({
    success: true,
    message: 'If the details are valid, a verification code has been sent to your email.'
  })
}

export const loginController: RequestHandler = async (req, res) => {
  const { user, tokens } = await login(req.body, sessionMeta(req))
  res.json(tokenResponse(user, tokens))
}

export const refreshController: RequestHandler = async (req, res) => {
  const tokens = await refresh(req.body.refreshToken, sessionMeta(req))
  res.json({
    success: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenType: 'Bearer',
    expiresIn: tokens.accessTokenExpiresIn,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt
  })
}

export const logoutController: RequestHandler = async (req, res) => {
  const bodyToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined
  const sessionId = (req as any).user?.sessionId
  await logout({ refreshToken: bodyToken, sessionId })
  res.json({ success: true, message: 'Signed out.' })
}

export const logoutAllController: RequestHandler = async (req, res) => {
  await logoutAll((req as any).user.userId)
  res.json({ success: true, message: 'Signed out of all devices.' })
}

export const meController: RequestHandler = async (req, res) => {
  const user = await getProfile((req as any).user.userId)
  res.json({ success: true, user: toPublicUser(user) })
}

export const listSessionsController: RequestHandler = async (req, res) => {
  const sessions = await listSessions((req as any).user.userId, (req as any).user.sessionId)
  res.json({ success: true, sessions })
}

export const revokeSessionController: RequestHandler = async (req, res) => {
  const id = String(req.params.id ?? '')
  if (!id) throw new AppError(400, 'Session id is required.', { code: 'VALIDATION_ERROR' })
  await revokeSession((req as any).user.userId, id)
  res.json({ success: true, message: 'Session revoked.' })
}

export const changePasswordController: RequestHandler = async (req, res) => {
  await changePassword((req as any).user.userId, (req as any).user.sessionId, req.body)
  res.json({ success: true, message: 'Password changed. Other devices have been signed out.' })
}

export const forgotPasswordController: RequestHandler = async (req, res) => {
  await forgotPassword(req.body.email)
  res.json({
    success: true,
    message: 'If an account exists for that email, a reset code has been sent.'
  })
}

export const resetPasswordController: RequestHandler = async (req, res) => {
  await resetPassword(req.body)
  res.json({ success: true, message: 'Password has been reset. Please sign in.' })
}
