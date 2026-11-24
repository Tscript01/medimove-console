import type { RequestHandler } from 'express'
import { prisma } from '../utils/prisma'

// GET /api/savings (Authenticated)
export const listSavings: RequestHandler = async (req, res) => {
  const userId = (req as any).user.userId

  let goals = await prisma.savingsGoal.findMany({
    where: { userId },
    include: { contributions: { orderBy: { createdAt: 'desc' }, include: { payment: true } } }
  })

  if (goals.length === 0) {
    const defaultGoal = await prisma.savingsGoal.create({
      data: {
        userId,
        title: 'Emergency Medical Transport Reserve',
        targetAmountKobo: 500000,
        currentAmountKobo: 100000
      }
    })
    goals = [{ ...defaultGoal, contributions: [] }]
  }

  res.json({ success: true, goals })
}
