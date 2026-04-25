import { maxUint128, type Address, type PublicClient, type WalletClient } from 'viem';
import { computeNewRange } from './plan';
import {
  ACTIONS,
  encodeBurnPosition,
  encodeDecreaseLiquidity,
  encodeMintPosition,
  encodeSettlePair,
  encodeTakePair,
  encodeUnlockData,
  type PoolKey,
} from './actions';
import { POSITION_MANAGER_ABI, readPositionLiquidity } from './position';
import type { StrategyAction } from '../events';

export type SubmitDeps = {
  publicClient: PublicClient;
  walletClient: WalletClient;
  positionManager: Address;
  poolKey: PoolKey;
  tokenId: bigint;
  recipient: Address;
  currentTick: () => Promise<number>;
};

const DEADLINE_BUFFER_SEC = 600n; // 10 minutes

function deadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000)) + DEADLINE_BUFFER_SEC;
}

export function makeSubmit(deps: SubmitDeps) {
  async function submit(action: StrategyAction): Promise<{ hash: `0x${string}` }> {
    if (action === 'HOLD') throw new Error('refusing to submit HOLD');

    if (action === 'HARVEST') {
      // Decrease 0 liquidity to settle accumulated fees; collect via TAKE_PAIR.
      const unlockData = encodeUnlockData(
        [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.TAKE_PAIR],
        [
          encodeDecreaseLiquidity({ tokenId: deps.tokenId, liquidity: 0n, amount0Min: 0n, amount1Min: 0n }),
          encodeTakePair(deps.poolKey.currency0, deps.poolKey.currency1, deps.recipient),
        ],
      );
      return writeModify(deps, unlockData);
    }

    if (action === 'EXIT') {
      const liquidity = await readPositionLiquidity(deps.publicClient, deps.positionManager, deps.tokenId);
      const unlockData = encodeUnlockData(
        [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.BURN_POSITION, ACTIONS.TAKE_PAIR],
        [
          encodeDecreaseLiquidity({ tokenId: deps.tokenId, liquidity, amount0Min: 0n, amount1Min: 0n }),
          encodeBurnPosition({ tokenId: deps.tokenId, amount0Min: 0n, amount1Min: 0n }),
          encodeTakePair(deps.poolKey.currency0, deps.poolKey.currency1, deps.recipient),
        ],
      );
      return writeModify(deps, unlockData);
    }

    if (action === 'REBALANCE') {
      const [tick, liquidity] = await Promise.all([
        deps.currentTick(),
        readPositionLiquidity(deps.publicClient, deps.positionManager, deps.tokenId),
      ]);
      const range = computeNewRange({ currentTick: tick, tickSpacing: deps.poolKey.tickSpacing, widthPct: 0.05 });
      // DECREASE old + MINT new with same liquidity, then SETTLE any debt then TAKE any surplus.
      const unlockData = encodeUnlockData(
        [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.MINT_POSITION, ACTIONS.SETTLE_PAIR, ACTIONS.TAKE_PAIR],
        [
          encodeDecreaseLiquidity({ tokenId: deps.tokenId, liquidity, amount0Min: 0n, amount1Min: 0n }),
          encodeMintPosition({
            poolKey: deps.poolKey,
            tickLower: range.tickLower,
            tickUpper: range.tickUpper,
            liquidity,
            amount0Max: maxUint128,
            amount1Max: maxUint128,
            owner: deps.recipient,
          }),
          encodeSettlePair(deps.poolKey.currency0, deps.poolKey.currency1),
          encodeTakePair(deps.poolKey.currency0, deps.poolKey.currency1, deps.recipient),
        ],
      );
      return writeModify(deps, unlockData);
    }

    throw new Error(`unknown action ${action}`);
  }

  async function wait(hash: `0x${string}`) {
    const r = await deps.publicClient.waitForTransactionReceipt({ hash });
    return { gasUsed: r.gasUsed.toString(), blockNumber: Number(r.blockNumber) };
  }

  return { submit, wait };
}

async function writeModify(deps: SubmitDeps, unlockData: `0x${string}`): Promise<{ hash: `0x${string}` }> {
  const account = deps.walletClient.account;
  if (!account) throw new Error('wallet client missing account');
  const hash = await deps.walletClient.writeContract({
    address: deps.positionManager,
    abi: POSITION_MANAGER_ABI,
    functionName: 'modifyLiquidities',
    args: [unlockData, deadline()],
    account,
    chain: null,
  });
  return { hash };
}
