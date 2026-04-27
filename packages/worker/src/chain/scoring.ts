import type { PublicClient } from 'viem';
import type { Address } from 'viem';
import { readPositionFees } from './state-view';
import { fetchPoolState, priceFromSqrtX96 } from './pool';
import type { TokenMetadata } from './erc20';
import { ilPercent } from './il';

export type ScoringSnapshot = {
  priceEntry: number;
  feesEarnedUsdAtDecision: number;
  tickLower: number;
  tickUpper: number;
  poolId: `0x${string}`;
  tokenId: bigint;
  stableCurrency?: string;
  token0: TokenMetadata;
  token1: TokenMetadata;
  tickSpacing: number;
  poolKey: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  };
};

export type ScoringResult = {
  feeDeltaUsd: number;
  ilDeltaPct: number;
  rangeAdherence: number;
  netPnlVsHold: number;
  score: number; // -1..1
};

export async function scoreDecision(args: {
  client: PublicClient;
  stateView: Address;
  positionManager: Address;
  snapshot: ScoringSnapshot;
}): Promise<ScoringResult> {
  const { client, stateView, positionManager, snapshot } = args;

  const pool = await fetchPoolState({
    client,
    stateView,
    poolId: snapshot.poolId,
    tickSpacing: snapshot.tickSpacing,
    token0: snapshot.token0,
    token1: snapshot.token1,
  });

  const priceNow = priceFromSqrtX96(pool.sqrtPriceX96, pool.token0.decimals, pool.token1.decimals);

  // Fees earned since snapshot
  let feesNowUsd = 0;
  try {
    const { fees0, fees1 } = await readPositionFees({
      client,
      stateView,
      poolId: snapshot.poolId,
      positionManager,
      tokenId: snapshot.tokenId,
      tickLower: snapshot.tickLower,
      tickUpper: snapshot.tickUpper,
    });
    const fees0Float = Number(fees0) / 10 ** pool.token0.decimals;
    const fees1Float = Number(fees1) / 10 ** pool.token1.decimals;
    const stable = (snapshot.stableCurrency ?? '').toLowerCase();
    const isToken0Stable = stable && pool.token0.address.toLowerCase() === stable;
    const isToken1Stable = stable && pool.token1.address.toLowerCase() === stable;
    if (isToken0Stable) {
      feesNowUsd = fees0Float + fees1Float / priceNow;
    } else if (isToken1Stable || !stable) {
      feesNowUsd = fees0Float * priceNow + fees1Float;
    }
  } catch {
    // leave feesNowUsd = 0
  }

  const feeDeltaUsd = feesNowUsd - snapshot.feesEarnedUsdAtDecision;

  // IL change: positive = got worse
  const ilAtDecision = ilPercent(snapshot.priceEntry, snapshot.priceEntry); // 0 at entry
  const ilNow = ilPercent(snapshot.priceEntry, priceNow);
  const ilDeltaPct = ilNow - ilAtDecision;

  // Range adherence: 1 if in range, 0 if not
  const rangeAdherence = pool.tick >= snapshot.tickLower && pool.tick < snapshot.tickUpper ? 1 : 0;

  // Counterfactual hold P&L: if no rebalance happened, estimate fee loss from being OOR
  // Positive netPnl = rebalance was better than hold
  const netPnlVsHold = rangeAdherence === 1 ? feeDeltaUsd * 0.5 : feeDeltaUsd * -0.5;

  // Composite score weighted sum, mapped to -1..1
  const feeDeltaNorm = clamp01(feeDeltaUsd / 10); // $10 fees = max score
  const ilDeltaNorm = clamp01(-ilDeltaPct / 0.1); // -10% IL = max score
  const pnlNorm = clamp01((netPnlVsHold + 5) / 10);

  const raw =
    0.4 * feeDeltaNorm +
    0.3 * ilDeltaNorm +
    0.2 * rangeAdherence +
    0.1 * pnlNorm;

  const score = raw * 2 - 1; // map 0..1 → -1..1

  return { feeDeltaUsd, ilDeltaPct, rangeAdherence, netPnlVsHold, score };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
