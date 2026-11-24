import { Router } from 'express'
import { checkEligibility } from '../controllers/insuranceController'

const router = Router()

// POST /api/insurance/eligibility
router.post('/insurance/eligibility', checkEligibility)

export default router
