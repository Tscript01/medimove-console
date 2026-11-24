import type { RequestHandler } from 'express'
import { prisma } from '../utils/prisma'
import { parseOrThrow } from '../middleware/validate'
import { calculateHaversineKm } from '../utils/geo'
import { geocodingService } from '../services/geocodingService'
import { computeFareForBooking } from '../services/pricingService'
import { fleetQuerySchema } from '../validation/location.schemas'
import { EKITI_HOSPITALS } from '../data/hospitals'

// GET /api/ambulances?lat=&lng=
export const getAmbulances: RequestHandler = async (req, res) => {
  // Coordinates are required and validated: there is deliberately no default
  // location. If GPS is unavailable the client must send a map pin instead.
  const { lat: userLat, lng: userLng } = parseOrThrow(fleetQuerySchema, req.query, 'query')

  const resolvedPickupAddress =
    (await geocodingService.reverse(userLat, userLng))?.address ?? `Location (${userLat.toFixed(4)}, ${userLng.toFixed(4)})`

  const rankedHospitals = EKITI_HOSPITALS.map((hosp) => {
    const distanceKm = calculateHaversineKm(userLat, userLng, hosp.lat, hosp.lng) || 1.0
    return { ...hosp, distanceKm, isRecommended: false }
  }).sort((a, b) => a.distanceKm - b.distanceKm)

  if (rankedHospitals.length > 0) {
    rankedHospitals[0].isRecommended = true
  }

  const selectedHospital = rankedHospitals[0]
  const tripDistanceKm = selectedHospital.distanceKm

  const providers = await prisma.ambulanceProvider.findMany()

  const calculatedProviders = await Promise.all(
    providers.map(async (p: { id: string; latitude: number; longitude: number; stateId: string | null; baseFareKobo: number; ratePerKmKobo: number }) => {
      const providerProximityKm = calculateHaversineKm(userLat, userLng, p.latitude, p.longitude)

      // Fares go through the same server-authoritative pricing service as real
      // bookings: configurable rules first, the provider's own rate otherwise.
      const { estimatedFareKobo } = await computeFareForBooking(
        p,
        { stateId: p.stateId ?? null, serviceAreaId: null, vehicleCategory: null },
        tripDistanceKm
      )

      return {
        ...p,
        proximityKm: providerProximityKm,
        tripDistanceKm,
        initialFareKobo: estimatedFareKobo,
        initialFareNGN: estimatedFareKobo / 100,
        isRecommended: false
      }
    })
  )

  calculatedProviders.sort(
    (a: { availableStatus: any; proximityKm: number }, b: { availableStatus: any; proximityKm: number }) => {
      if (a.availableStatus === b.availableStatus) return a.proximityKm - b.proximityKm
      return a.availableStatus ? -1 : 1
    }
  )

  if (calculatedProviders.length > 0 && calculatedProviders[0].availableStatus) {
    calculatedProviders[0].isRecommended = true
  }

  res.json({
    success: true,
    userLocation: {
      lat: userLat,
      lng: userLng,
      pickupAddress: resolvedPickupAddress,
      destAddress: `${selectedHospital.name}, ${selectedHospital.city}`,
      distanceKm: tripDistanceKm
    },
    hospitals: rankedHospitals,
    data: calculatedProviders
  })
}
