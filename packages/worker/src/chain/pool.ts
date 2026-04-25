import type { Address, Hex, PublicClient } from 'viem';
import type { TokenMetadata } from './erc20';
import { readPoolSlot } from './state-view';

export type PoolState = {
  poolId: Hex;
  tick: number;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  fee: number;          // pool's lpFee from slot0
  tickSpacing: number;  // from PoolKey (cached on boot)
  token0: TokenMetadata;
  token1: TokenMetadata;
};

/**
 * Reads live pool state via the StateView lens contract (no HTTP, no API key).
 * tickSpacing + token metadata are passed in (they are immutable per pool, cached on boot).
 */
export async function fetchPoolState(args: {
  client: PublicClient;
  stateView: Address;
  poolId: Hex;
  tickSpacing: number;
  token0: TokenMetadata;
  token1: TokenMetadata;
}): Promise<PoolState> {
  const { slot0, liquidity } = await readPoolSlot({ client: args.client, stateView: args.stateView, poolId: args.poolId });
  return {
    poolId: args.poolId,
    tick: slot0.tick,
    sqrtPriceX96: slot0.sqrtPriceX96,
    liquidity,
    fee: slot0.lpFee,
    tickSpacing: args.tickSpacing,
    token0: args.token0,
    token1: args.token1,
  };
}

export function priceFromSqrtX96(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  const ratio = Number(sqrtPriceX96) ** 2 / 2 ** 192;
  return ratio * 10 ** (decimals0 - decimals1);
}
