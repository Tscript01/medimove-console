import type { RequestHandler } from 'express'
import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import { currentUser } from '../auth/context'
import { toPayment } from '../utils/serializers'
import { initializePayment } from '../services/paymentService'
import type { PaymentMethodValue } from '../validation/payment.schemas'

// GET /api/wallet/balance (Authenticated)
export const getBalance: RequestHandler = async (req, res) => {
  const userId = (req as any).user.userId || (req as any).user.id

  if (!userId) {
    throw new AppError(401, 'User ID missing from token.')
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, walletBalanceKobo: true }
  })

  if (!user) {
    throw new AppError(404, 'User not found.')
  }

  const balanceKobo = user.walletBalanceKobo || 0

  res.json({
    success: true,
    walletBalanceKobo: balanceKobo,
    walletBalanceNGN: balanceKobo / 100
  })
}

// POST /api/wallet/fund (Authenticated) — initialize wallet funding via Interswitch
export const fundWallet: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const { amountNGN, method } = req.body as { amountNGN?: number; method?: PaymentMethodValue }
  if (!amountNGN || amountNGN <= 0) {
    throw new AppError(400, 'Valid top-up amount required.', { code: 'VALIDATION_ERROR', field: 'amountNGN' })
  }

  const amountKobo = Math.round(amountNGN * 100)
  const { payment, checkout } = await initializePayment(actor, {
    type: 'WALLET_FUNDING',
    amountKobo,
    method: method ?? 'CARD'
  })

  res.json({ success: true, payment: toPayment(payment), interswitchPayload: checkout })
}
