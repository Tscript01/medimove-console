import { z } from 'zod'

/** Shared field schemas. Email is normalised (trimmed + lower-cased). */
const email = z.string().trim().toLowerCase().email('A valid email address is required.')

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password must be at most 128 characters.')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter.')
  .regex(/[0-9]/, 'Password must contain at least one number.')

const otpCode = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.')

const phone = z
  .string()
  .trim()
  .min(7, 'Enter a valid phone number.')
  .max(20, 'Enter a valid phone number.')
  .regex(/^[+0-9()\-\s]+$/, 'Enter a valid phone number.')

export const registerSchema = z.object({
  email,
  password,
  fullName: z.string().trim().min(2, 'Full name is required.').max(120),
  phone
})

export const verifyEmailSchema = z.object({
  email,
  code: otpCode
})

export const resendOtpSchema = z.object({
  email
})

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required.').max(128)
})

export const refreshSchema = z.object({
  refreshToken: z.string().min(20, 'A valid refresh token is required.')
})

export const logoutSchema = z.object({
  refreshToken: z.string().min(20).optional()
})

export const forgotPasswordSchema = z.object({
  email
})

export const resetPasswordSchema = z.object({
  email,
  code: otpCode,
  newPassword: password
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.').max(128),
  newPassword: password
})

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
