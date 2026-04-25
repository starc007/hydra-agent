import { type Address, type PublicClient, type WalletClient } from 'viem';
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
import { readPoolSlot } from './state-view';
import { getSqrtPriceAtTick } from './tick-math';
import {
  getAmountsForLiquidity,
  getLiquidityForAmounts,
} from './liquidity-amounts';
import type { StrategyAction } from '../events';

export type SubmitDeps = {
  publicClient: PublicClient;
  walletClient: WalletClient;
  positionManager: Address;
  stateView: Address;
  poolKey: PoolKey;
  poolId: `0x${string}`;
  tokenId: bigint;
  recipient: Address;
  slippageBps: number; // e.g. 50 = 0.5%
};

const BPS = 10_000n;
const DEADLINE_BUFFER_SEC = 600n; // 10 min

function deadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000)) + DEADLINE_BUFFER_SEC;
}

function applyMin(amount: bigint, slippageBps: number): bigint {
  return (amount * (BPS - BigInt(slippageBps))) / BPS;
}

function applyMax(amount: bigint, slippageBps: number): bigint {
  return (amount * (BPS + BigInt(slippageBps))) / BPS;
}

export function makeSubmit(deps: SubmitDeps) {
  async function submit(action: StrategyAction): Promise<{ hash: `0x${string}` }> {
    if (action === 'HOLD') throw new Error('refusing to submit HOLD');

    if (action === 'HARVEST') {
      // Decrease 0 liquidity → settle accumulated fees → take pair.
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
      const [{ slot0 }, oldLiquidity] = await Promise.all([
        readPoolSlot({ client: deps.publicClient, stateView: deps.stateView, poolId: deps.poolId }),
        readPositionLiquidity(deps.publicClient, deps.positionManager, deps.tokenId),
      ]);

      // Re-read position ticks to avoid stale boot values.
      const [, info] = await deps.publicClient.readContract({
        address: deps.positionManager,
        abi: POSITION_MANAGER_ABI,
        functionName: 'getPoolAndPositionInfo',
        args: [deps.tokenId],
      }) as [unknown, bigint];
      const tickLowerOld = Number(BigInt.asIntN(24, (info >> 8n) & 0xFFFFFFn));
      const tickUpperOld = Number(BigInt.asIntN(24, (info >> 32n) & 0xFFFFFFn));

      // Step 1: amounts that DECREASE will release.
      const sqrtCurrent = slot0.sqrtPriceX96;
      const sqrtOldA = getSqrtPriceAtTick(tickLowerOld);
      const sqrtOldB = getSqrtPriceAtTick(tickUpperOld);
      const released = getAmountsForLiquidity(sqrtCurrent, sqrtOldA, sqrtOldB, oldLiquidity);

      // Step 2: choose new range, compute new liquidity that consumes (most of) released amounts.
      const newRange = computeNewRange({ currentTick: slot0.tick, tickSpacing: deps.poolKey.tickSpacing, widthPct: 0.05 });
      const sqrtNewA = getSqrtPriceAtTick(newRange.tickLower);
      const sqrtNewB = getSqrtPriceAtTick(newRange.tickUpper);
      const newLiquidity = getLiquidityForAmounts(sqrtCurrent, sqrtNewA, sqrtNewB, released.amount0, released.amount1);

      // Step 3: amounts the new MINT will need.
      const needed = getAmountsForLiquidity(sqrtCurrent, sqrtNewA, sqrtNewB, newLiquidity);

      // Step 4: apply slippage bands.
      const amount0Min = applyMin(released.amount0, deps.slippageBps); // floor for what DECREASE returns
      const amount1Min = applyMin(released.amount1, deps.slippageBps);
      const amount0Max = applyMax(needed.amount0, deps.slippageBps);   // ceiling for what MINT can spend
      const amount1Max = applyMax(needed.amount1, deps.slippageBps);

      const unlockData = encodeUnlockData(
        [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.MINT_POSITION, ACTIONS.SETTLE_PAIR, ACTIONS.TAKE_PAIR],
        [
          encodeDecreaseLiquidity({ tokenId: deps.tokenId, liquidity: oldLiquidity, amount0Min, amount1Min }),
          encodeMintPosition({
            poolKey: deps.poolKey,
            tickLower: newRange.tickLower,
            tickUpper: newRange.tickUpper,
            liquidity: newLiquidity,
            amount0Max,
            amount1Max,
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
  const args = [unlockData, deadline()] as const;

  // Pre-flight: catch reverts before broadcasting.
  await deps.publicClient.simulateContract({
    address: deps.positionManager,
    abi: POSITION_MANAGER_ABI,
    functionName: 'modifyLiquidities',
    args,
    account: account.address,
  });

  const hash = await deps.walletClient.writeContract({
    address: deps.positionManager,
    abi: POSITION_MANAGER_ABI,
    functionName: 'modifyLiquidities',
    args,
    account,
    chain: null,
  });
  return { hash };
}
