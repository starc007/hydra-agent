import type { Config } from '../config';

export type PoolState = {
  poolId: `0x${string}`;
  tick: number;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  fee: number;
  tickSpacing: number;
  token0: { address: `0x${string}`; symbol: string; decimals: number };
  token1: { address: `0x${string}`; symbol: string; decimals: number };
};

export async function fetchPoolState(cfg: Config): Promise<PoolState> {
  const url = `${cfg.UNISWAP_API_BASE}/v2/pools/${cfg.POOL_ID}?chainId=${cfg.CHAIN_ID}`;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (cfg.UNISWAP_API_KEY) headers['x-api-key'] = cfg.UNISWAP_API_KEY;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Uniswap API ${res.status}: ${await res.text()}`);
  const j = await res.json() as {
    tick: number | string;
    sqrtPriceX96: string;
    liquidity: string;
    fee: number | string;
    tickSpacing: number | string;
    token0: { address: `0x${string}`; symbol: string; decimals: number };
    token1: { address: `0x${string}`; symbol: string; decimals: number };
  };
  return {
    poolId: cfg.poolId,
    tick: Number(j.tick),
    sqrtPriceX96: BigInt(j.sqrtPriceX96),
    liquidity: BigInt(j.liquidity),
    fee: Number(j.fee),
    tickSpacing: Number(j.tickSpacing),
    token0: j.token0,
    token1: j.token1,
  };
}

export function priceFromSqrtX96(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  const ratio = Number(sqrtPriceX96) ** 2 / 2 ** 192;
  return ratio * 10 ** (decimals0 - decimals1);
}
