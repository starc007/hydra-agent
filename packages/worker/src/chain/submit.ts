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

/**
 * Demo execution path: every non-HOLD action lands a small ETH self-transfer on
 * Unichain Sepolia, producing a real tx hash the dashboard can show.
 *
 * For production, replace `selfTransfer()` with a `PositionManager.modifyLiquidities`
 * call assembled per action — see FEEDBACK.md for our notes on the v4 SDK encoding
 * ergonomics that motivated this temporary path.
 */
export function makeSubmit(deps: SubmitDeps) {
  async function submit(action: StrategyAction): Promise<{ hash: `0x${string}` }> {
    if (action === 'HOLD') throw new Error('refusing to submit HOLD');
    if (action === 'REBALANCE') {
      const tick = await deps.currentTick();
      const range = computeNewRange({ currentTick: tick, tickSpacing: deps.poolKey.tickSpacing, widthPct: 0.05 });
      console.log(`[submit] REBALANCE — target range ${range.tickLower}..${range.tickUpper} (demo path: self-transfer)`);
      return selfTransfer(deps);
    }
    if (action === 'HARVEST') {
      console.log('[submit] HARVEST (demo path: self-transfer)');
      return selfTransfer(deps);
    }
    if (action === 'EXIT') {
      console.log('[submit] EXIT (demo path: self-transfer)');
      return selfTransfer(deps);
    }
    throw new Error(`unknown action ${action}`);
  }

  async function wait(hash: `0x${string}`) {
    const r = await deps.publicClient.waitForTransactionReceipt({ hash });
    return { gasUsed: r.gasUsed.toString(), blockNumber: Number(r.blockNumber) };
  }

  return { submit, wait };
}

async function selfTransfer(deps: SubmitDeps): Promise<{ hash: `0x${string}` }> {
  const account = deps.walletClient.account;
  if (!account) throw new Error('wallet client missing account');
  const hash = await deps.walletClient.sendTransaction({
    account,
    chain: null,
    to: account.address,
    value: 1n, // 1 wei — minimal demonstrable on-chain transition
  });
  return { hash };
}
