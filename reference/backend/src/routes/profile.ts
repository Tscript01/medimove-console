import { Router } from 'express'
import { authenticateToken } from '../middleware/auth'
import { requirePermission } from '../middleware/authorize'
import { PERMISSIONS } from '../auth/permissions'
import { validateBody } from '../middleware/validate'
import { otpRequestLimiter } from '../middleware/rateLimit'
import {
  getProfileController,
  requestPhoneVerificationController,
  updateProfileController,
  verifyPhoneController
} from '../controllers/profileController'
import {
  createEmergencyContactController,
  deleteEmergencyContactController,
  listEmergencyContactsController,
  setPrimaryEmergencyContactController,
  updateEmergencyContactController
} from '../controllers/emergencyContactController'
import { grantConsentController, listConsentsController, withdrawConsentController } from '../controllers/consentController'
import {
  deleteMedicalInfoController,
  getMedicalInfoController,
  upsertMedicalInfoController
} from '../controllers/medicalController'
import {
  createEmergencyContactSchema,
  grantConsentSchema,
  medicalInfoSchema,
  updateEmergencyContactSchema,
  updateProfileSchema,
  verifyPhoneSchema
} from '../validation/profile.schemas'

const router = Router()

// --- Profile ---------------------------------------------------------------
router.get('/profile', authenticateToken, requirePermission(PERMISSIONS.PROFILE_READ_OWN), getProfileController)
router.patch(
  '/profile',
  authenticateToken,
  requirePermission(PERMISSIONS.PROFILE_UPDATE_OWN),
  validateBody(updateProfileSchema),
  updateProfileController
)

// --- Phone verification ----------------------------------------------------
router.post(
  '/profile/phone/request-verification',
  authenticateToken,
  otpRequestLimiter,
  requirePermission(PERMISSIONS.PHONE_VERIFY),
  requestPhoneVerificationController
)
router.post(
  '/profile/phone/verify',
  authenticateToken,
  requirePermission(PERMISSIONS.PHONE_VERIFY),
  validateBody(verifyPhoneSchema),
  verifyPhoneController
)

// --- Emergency contacts ----------------------------------------------------
router.get(
  '/profile/emergency-contacts',
  authenticateToken,
  requirePermission(PERMISSIONS.EMERGENCY_CONTACT_MANAGE),
  listEmergencyContactsController
)
router.post(
  '/profile/emergency-contacts',
  authenticateToken,
  requirePermission(PERMISSIONS.EMERGENCY_CONTACT_MANAGE),
  validateBody(createEmergencyContactSchema),
  createEmergencyContactController
)
router.patch(
  '/profile/emergency-contacts/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.EMERGENCY_CONTACT_MANAGE),
  validateBody(updateEmergencyContactSchema),
  updateEmergencyContactController
)
router.delete(
  '/profile/emergency-contacts/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.EMERGENCY_CONTACT_MANAGE),
  deleteEmergencyContactController
)
router.post(
  '/profile/emergency-contacts/:id/primary',
  authenticateToken,
  requirePermission(PERMISSIONS.EMERGENCY_CONTACT_MANAGE),
  setPrimaryEmergencyContactController
)

// --- Consent ---------------------------------------------------------------
router.get('/profile/consents', authenticateToken, requirePermission(PERMISSIONS.CONSENT_MANAGE), listConsentsController)
router.post(
  '/profile/consents',
  authenticateToken,
  requirePermission(PERMISSIONS.CONSENT_MANAGE),
  validateBody(grantConsentSchema),
  grantConsentController
)
router.post(
  '/profile/consents/:type/withdraw',
  authenticateToken,
  requirePermission(PERMISSIONS.CONSENT_MANAGE),
  withdrawConsentController
)

// --- Medical information (consent-gated, owner-only) -----------------------
router.get('/profile/medical', authenticateToken, requirePermission(PERMISSIONS.MEDICAL_READ_OWN), getMedicalInfoController)
router.put(
  '/profile/medical',
  authenticateToken,
  requirePermission(PERMISSIONS.MEDICAL_WRITE_OWN),
  validateBody(medicalInfoSchema),
  upsertMedicalInfoController
)
router.delete(
  '/profile/medical',
  authenticateToken,
  requirePermission(PERMISSIONS.MEDICAL_WRITE_OWN),
  deleteMedicalInfoController
)

export default router
