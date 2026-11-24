import { Router } from 'express'
import { authenticateToken, optionalAuthenticateToken } from '../middleware/auth'
import { validateBody } from '../middleware/validate'
import { authLimiter, loginLimiter, otpRequestLimiter } from '../middleware/rateLimit'
import {
  changePasswordController,
  forgotPasswordController,
  listSessionsController,
  loginController,
  logoutAllController,
  logoutController,
  meController,
  refreshController,
  registerController,
  resendVerificationController,
  resetPasswordController,
  revokeSessionController,
  verifyEmailController
} from '../controllers/authController'
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resendOtpSchema,
  resetPasswordSchema,
  verifyEmailSchema
} from '../validation/auth.schemas'

const router = Router()

// Registration + email verification
router.post('/auth/register', otpRequestLimiter, validateBody(registerSchema), registerController)
router.post('/auth/verify-email', authLimiter, validateBody(verifyEmailSchema), verifyEmailController)
router.post('/auth/resend-verification', otpRequestLimiter, validateBody(resendOtpSchema), resendVerificationController)

// Session lifecycle
router.post('/auth/login', loginLimiter, validateBody(loginSchema), loginController)
router.post('/auth/refresh', authLimiter, validateBody(refreshSchema), refreshController)
router.post('/auth/logout', authLimiter, optionalAuthenticateToken, logoutController)
router.post('/auth/logout-all', authenticateToken, logoutAllController)

// Profile + device/session management
router.get('/auth/me', authenticateToken, meController)
router.get('/auth/sessions', authenticateToken, listSessionsController)
router.delete('/auth/sessions/:id', authenticateToken, revokeSessionController)

// Password management
router.post('/auth/password/change', authenticateToken, validateBody(changePasswordSchema), changePasswordController)
router.post('/auth/password/forgot', otpRequestLimiter, validateBody(forgotPasswordSchema), forgotPasswordController)
router.post('/auth/password/reset', authLimiter, validateBody(resetPasswordSchema), resetPasswordController)

export default router
