import type { RequestHandler } from 'express'

const SUPPORTED_INSURERS = ['Hygeia HMO', 'Reliance Health', 'AXA Mansard', 'Leadway Health', 'Reliance']

// POST /api/insurance/eligibility
export const checkEligibility: RequestHandler = (req, res) => {
  const { insurerName } = req.body
  const isSupported = SUPPORTED_INSURERS.some(
    (s) => s.toLowerCase() === (insurerName || '').toLowerCase().trim()
  )

  res.json({
    success: true,
    isSupported,
    coveragePercentage: isSupported ? 80 : 0,
    statusLabel: isSupported ? 'Eligible for Direct Co-Pay' : 'Provider Not Integrated',
    message: isSupported
      ? 'Verified! 80% covered by HMO plan co-pay.'
      : 'Provider not directly integrated. Self-payment required.'
  })
}
