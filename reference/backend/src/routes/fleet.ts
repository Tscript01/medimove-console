import { Router } from 'express'
import { getAmbulances } from '../controllers/fleetController'

const router = Router()

// GET /api/ambulances
router.get('/ambulances', getAmbulances)

export default router
