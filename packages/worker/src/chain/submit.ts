import type { PublicClient, WalletClient, Address } from 'viem';
import { computeNewRange } from './plan';
import type { StrategyAction } from '../events';

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export type SubmitDeps = {
  publicClient: PublicClient;
  walletClient: WalletClient;
  positionManager: Address;
  poolKey: PoolKey;
  tokenId: bigint;
  currentTick: () => Promise<number>;
};

export function makeSubmit(deps: SubmitDeps) {
  async function submit(action: StrategyAction): Promise<{ hash: `0x${string}` }> {
    if (action === 'HOLD') throw new Error('refusing to submit HOLD');
    if (action === 'REBALANCE') {
      const tick = await deps.currentTick();
      const range = computeNewRange({ currentTick: tick, tickSpacing: deps.poolKey.tickSpacing, widthPct: 0.05 });
      throw new Error(`rebalance encoding pending — target range ${range.tickLower}..${range.tickUpper}`);
    }
    if (action === 'HARVEST') throw new Error('harvest encoding pending');
    if (action === 'EXIT') throw new Error('exit encoding pending');
    throw new Error(`unknown action ${action}`);
  }

  async function wait(hash: `0x${string}`) {
    const r = await deps.publicClient.waitForTransactionReceipt({ hash });
    return { gasUsed: r.gasUsed.toString(), blockNumber: Number(r.blockNumber) };
  }

  return { submit, wait };
}
