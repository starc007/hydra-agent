import type { PoolState } from '../chain/pool';

export type FeatureContext = {
  /** Last N price ticks (sqrtPriceX96 as number) */
  priceTicks: number[];
  ilPct: number;
  confidence: number;
  volatility: number;
  timeInRange: number;
  currentTick: number;
  tickLower: number;
  tickUpper: number;
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function linearRegressionSlope(ys: number[]): number {
  if (ys.length < 2) return 0;
  const n = ys.length;
  const xs = ys.map((_, i) => i);
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return den === 0 ? 0 : num / den;
}

/**
 * Build a 6-dim normalized float32 vector:
 * [priceTrend, ilPct, confidence, volatility, timeInRange, tickDistNorm]
 */
export function buildFeatureVector(ctx: FeatureContext): number[] {
  const ticks = ctx.priceTicks.slice(-30);

  // 0: priceTrend — slope of last 30 price ticks, normalized to [0,1]
  const slope = linearRegressionSlope(ticks);
  const maxSlope = ticks.length > 0 ? Math.max(...ticks) * 0.01 : 1;
  const priceTrend = clamp((slope / (maxSlope || 1) + 1) / 2, 0, 1);

  // 1: ilPct — clamped 0..20% → 0..1
  const ilPct = clamp(ctx.ilPct / 20, 0, 1);

  // 2: confidence — already 0..1
  const confidence = clamp(ctx.confidence, 0, 1);

  // 3: volatility — rolling std dev of price ticks, normalized
  let volatility = 0;
  if (ticks.length > 1) {
    const mean = ticks.reduce((a, b) => a + b, 0) / ticks.length;
    const std = Math.sqrt(ticks.reduce((s, v) => s + (v - mean) ** 2, 0) / ticks.length);
    const relStd = mean > 0 ? std / mean : 0;
    volatility = clamp(relStd / 0.05, 0, 1); // 5% relative std = max
  }

  // 4: timeInRange — already 0..1
  const timeInRange = clamp(ctx.timeInRange, 0, 1);

  // 5: tickDistNorm — distance from current tick to range midpoint, normalized
  const midpoint = (ctx.tickLower + ctx.tickUpper) / 2;
  const halfRange = Math.max((ctx.tickUpper - ctx.tickLower) / 2, 1);
  const tickDistNorm = clamp(Math.abs(ctx.currentTick - midpoint) / halfRange, 0, 1);

  // Vectorize requires min 32 dims — pad remaining with zeros.
  const core = [priceTrend, ilPct, confidence, volatility, timeInRange, tickDistNorm];
  return [...core, ...new Array(26).fill(0)];
}

export function buildFeatureContextFromPool(
  pool: PoolState,
  priceTicks: number[],
  ilPct: number,
  confidence: number,
  timeInRange: number,
  tickLower: number,
  tickUpper: number,
): FeatureContext {
  const prices = priceTicks.map(Number);
  const mean = prices.length > 1 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const variance =
    prices.length > 1
      ? prices.reduce((s, v) => s + (v - mean) ** 2, 0) / prices.length
      : 0;

  return {
    priceTicks: prices,
    ilPct,
    confidence,
    volatility: Math.sqrt(variance),
    timeInRange,
    currentTick: pool.tick,
    tickLower,
    tickUpper,
  };
}
