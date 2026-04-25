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
  /** Returns the currently-active LP NFT id. Dynamic so it can change after a rebalance mint. */
  tokenId: () => bigint;
  recipient: Address;
  slippageBps: number; // e.g. 50 = 0.5%
  /** Called when wait() observes a fresh ERC721 mint to the recipient (REBALANCE path). */
  onPositionMinted?: (newTokenId: bigint) => Promise<void> | void;
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
      const tokenId = deps.tokenId();
      // Decrease 0 liquidity → settle accumulated fees → take pair.
      const unlockData = encodeUnlockData(
        [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.TAKE_PAIR],
        [
          encodeDecreaseLiquidity({ tokenId, liquidity: 0n, amount0Min: 0n, amount1Min: 0n }),
          encodeTakePair(deps.poolKey.currency0, deps.poolKey.currency1, deps.recipient),
        ],
      );
      return writeModify(deps, unlockData);
    }

    if (action === 'EXIT') {
      const tokenId = deps.tokenId();
      const liquidity = await readPositionLiquidity(deps.publicClient, deps.positionManager, tokenId);
      const unlockData = encodeUnlockData(
        [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.BURN_POSITION, ACTIONS.TAKE_PAIR],
        [
          encodeDecreaseLiquidity({ tokenId, liquidity, amount0Min: 0n, amount1Min: 0n }),
          encodeBurnPosition({ tokenId, amount0Min: 0n, amount1Min: 0n }),
          encodeTakePair(deps.poolKey.currency0, deps.poolKey.currency1, deps.recipient),
        ],
      );
      return writeModify(deps, unlockData);
    }

    if (action === 'REBALANCE') {
      const tokenId = deps.tokenId();
      const [{ slot0 }, oldLiquidity] = await Promise.all([
        readPoolSlot({ client: deps.publicClient, stateView: deps.stateView, poolId: deps.poolId }),
        readPositionLiquidity(deps.publicClient, deps.positionManager, tokenId),
      ]);

      // Re-read position ticks to avoid stale boot values.
      const [, info] = await deps.publicClient.readContract({
        address: deps.positionManager,
        abi: POSITION_MANAGER_ABI,
        functionName: 'getPoolAndPositionInfo',
        args: [tokenId],
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
          encodeDecreaseLiquidity({ tokenId, liquidity: oldLiquidity, amount0Min, amount1Min }),
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

    // If this tx minted a fresh position NFT to our recipient, surface the new tokenId.
    // ERC721 Transfer(from, to, tokenId) — topic[0] is the canonical Transfer signature,
    // topic[1] = padded `from`, topic[2] = padded `to`, topic[3] = tokenId.
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const recipientPadded = `0x${'0'.repeat(24)}${deps.recipient.slice(2).toLowerCase()}`;
    const mintLog = r.logs.find(
      (l) =>
        l.address.toLowerCase() === deps.positionManager.toLowerCase()
        && l.topics?.[0] === TRANSFER_TOPIC
        && /^0x0+$/.test(l.topics?.[1] ?? '')
        && (l.topics?.[2] ?? '').toLowerCase() === recipientPadded
        && l.topics?.[3] !== undefined,
    );
    let mintedTokenId: bigint | undefined;
    if (mintLog && mintLog.topics?.[3]) {
      mintedTokenId = BigInt(mintLog.topics[3]);
      if (deps.onPositionMinted) {
        try { await deps.onPositionMinted(mintedTokenId); }
        catch (err) { console.error('[submit] onPositionMinted callback threw', err); }
      }
    }
    return { gasUsed: r.gasUsed.toString(), blockNumber: Number(r.blockNumber), mintedTokenId };
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
