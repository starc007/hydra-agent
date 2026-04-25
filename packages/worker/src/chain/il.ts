/**
 * Classical impermanent loss for a v2-style 50/50 LP relative to holding.
 * IL = 2*sqrt(r) / (1+r) - 1, where r = priceNow/priceEntry. Returned as a fraction.
 */
export function ilPercent(priceEntry: number, priceNow: number): number {
  if (priceEntry <= 0 || priceNow <= 0) return 0;
  const r = priceNow / priceEntry;
  return (2 * Math.sqrt(r)) / (1 + r) - 1;
}
