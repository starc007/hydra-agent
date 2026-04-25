export function computeNewRange(args: { currentTick: number; tickSpacing: number; widthPct: number }) {
  const { currentTick, tickSpacing, widthPct } = args;
  const half = Math.round(Math.log(1 + widthPct) / Math.log(1.0001));
  const lower = Math.floor((currentTick - half) / tickSpacing) * tickSpacing;
  const upper = Math.ceil((currentTick + half) / tickSpacing) * tickSpacing;
  return { tickLower: lower, tickUpper: upper };
}
