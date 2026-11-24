/**
 * API amounts are integer kobo. Convert ONLY at the display boundary; never
 * submit a client-computed price. `null`/`undefined` stays "Unavailable".
 */
export function formatKobo(amountKobo: number | null | undefined, currency = 'NGN'): string {
  if (amountKobo === null || amountKobo === undefined || !Number.isFinite(amountKobo)) return 'Unavailable'
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2
    }).format(amountKobo / 100)
  } catch {
    return `${amountKobo} kobo`
  }
}
