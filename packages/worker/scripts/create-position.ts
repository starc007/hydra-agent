declare const process: { env: Record<string, string | undefined>; argv: string[]; exit: (code: number) => never; cwd: () => string };

import {
  ACTIONS,
  encodeMintPosition,
  encodeSettlePair,
  encodeUnlockData,
  type PoolKey,
} from '../src/chain/actions';
import { POSITION_MANAGER_ABI } from '../src/chain/position';
import { STATE_VIEW_ABI } from '../src/chain/state-view';
import { ERC20_ABI } from '../src/chain/erc20';
import { getSqrtPriceAtTick } from '../src/chain/tick-math';
import { getLiquidityForAmounts } from '../src/chain/liquidity-amounts';
import { loadEnv, makeClients, UNICHAIN_SEPOLIA_ADDRESSES, arg, requireArg } from './_lib';
import { keccak256, encodeAbiParameters, maxUint256, type Address, type Account } from 'viem';

// maxUint160 is exported by viem 2.x; use inline fallback just in case
const MAX_UINT160 = (2n ** 160n - 1n);
const MAX_UINT160_HALF = MAX_UINT160 / 2n;

const POOL_MANAGER_ABI = [
  {
    type: 'function', name: 'initialize',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'key', type: 'tuple', components: [
        { name: 'currency0',   type: 'address' },
        { name: 'currency1',   type: 'address' },
        { name: 'fee',         type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks',       type: 'address' },
      ]},
      { name: 'sqrtPriceX96', type: 'uint160' },
    ],
    outputs: [{ name: 'tick', type: 'int24' }],
  },
] as const;

const PERMIT2_ABI = [
  {
    type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [
      { name: 'token',      type: 'address' },
      { name: 'spender',    type: 'address' },
      { name: 'amount',     type: 'uint160'  },
      { name: 'expiration', type: 'uint48'   },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'allowance', stateMutability: 'view',
    inputs: [
      { name: 'user',    type: 'address' },
      { name: 'token',   type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [
      { name: 'amount',     type: 'uint160' },
      { name: 'expiration', type: 'uint48'  },
      { name: 'nonce',      type: 'uint48'  },
    ],
  },
] as const;

const ERC20_APPROVE_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ type: 'uint256' }] },
] as const;

const NATIVE = '0x0000000000000000000000000000000000000000' as Address;

function sortCurrencies(a: Address, b: Address): [Address, Address, boolean] {
  const lo = a.toLowerCase();
  const hi = b.toLowerCase();
  if (lo < hi) return [a, b, false];
  return [b, a, true];
}

async function ensurePermit2Setup(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  walletClient: any;
  account: Account;
  token: Address;
  positionManager: Address;
  permit2: Address;
}) {
  if (args.token === NATIVE) return; // ETH path needs no allowance

  const owner = args.account.address;
  // 1. ERC20.allowance(owner, PERMIT2)
  const erc20Allow = await args.publicClient.readContract({
    address: args.token, abi: ERC20_APPROVE_ABI, functionName: 'allowance', args: [owner, args.permit2],
  }) as bigint;
  if (erc20Allow < maxUint256 / 2n) {
    console.log(`  approving Permit2 to pull ${args.token}...`);
    const hash = await args.walletClient.writeContract({
      address: args.token, abi: ERC20_APPROVE_ABI, functionName: 'approve', args: [args.permit2, maxUint256],
      account: args.account, chain: null,
    });
    await args.publicClient.waitForTransactionReceipt({ hash });
  }

  // 2. Permit2.allowance(owner, token, PositionManager)
  const [permit2Allow, expiration] = await args.publicClient.readContract({
    address: args.permit2, abi: PERMIT2_ABI, functionName: 'allowance', args: [owner, args.token, args.positionManager],
  }) as [bigint, number, number];

  const nowSec = Math.floor(Date.now() / 1000);
  if (permit2Allow < MAX_UINT160_HALF || expiration < nowSec + 3600) {
    console.log(`  granting PositionManager pull rights via Permit2 for ${args.token}...`);
    // uint48 max is 281474976710655 — far-future deadline well within that
    const farFuture = Number(BigInt(nowSec) + 365n * 24n * 3600n);
    const hash = await args.walletClient.writeContract({
      address: args.permit2, abi: PERMIT2_ABI, functionName: 'approve',
      args: [args.token, args.positionManager, MAX_UINT160, farFuture],
      account: args.account, chain: null,
    });
    await args.publicClient.waitForTransactionReceipt({ hash });
  }
}

async function main() {
  const { privateKey, rpcUrl } = loadEnv();
  const { account, publicClient, walletClient } = makeClients(privateKey, rpcUrl);
  const { positionManager, poolManager, stateView, permit2 } = UNICHAIN_SEPOLIA_ADDRESSES;

  const tokenA = requireArg('tokenA') as Address;
  const tokenB = requireArg('tokenB') as Address;
  const fee = Number(requireArg('fee'));
  const tickSpacing = Number(requireArg('tickSpacing'));
  const hooks = (arg('hooks') ?? NATIVE) as Address;
  const tickLower = Number(requireArg('tickLower'));
  const tickUpper = Number(requireArg('tickUpper'));
  const amountADesired = BigInt(requireArg('amount0'));
  const amountBDesired = BigInt(requireArg('amount1'));
  const initialPriceArg = arg('initialPriceX96');

  const [currency0, currency1, swapped] = sortCurrencies(tokenA, tokenB);
  const amount0Desired = swapped ? amountBDesired : amountADesired;
  const amount1Desired = swapped ? amountADesired : amountBDesired;

  const poolKey: PoolKey = { currency0, currency1, fee, tickSpacing, hooks };
  const poolId = keccak256(encodeAbiParameters(
    [{ type: 'tuple', components: [
      { name: 'currency0',   type: 'address' },
      { name: 'currency1',   type: 'address' },
      { name: 'fee',         type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks',       type: 'address' },
    ]}],
    [poolKey],
  ));

  console.log(`pool poolKey:\n  currency0=${currency0}\n  currency1=${currency1}\n  fee=${fee}, tickSpacing=${tickSpacing}, hooks=${hooks}\n  poolId=${poolId}`);

  // Step 1: ensure pool initialized
  const slot0 = await publicClient.readContract({
    address: stateView, abi: STATE_VIEW_ABI, functionName: 'getSlot0', args: [poolId],
  }) as [bigint, number, number, number];
  const sqrtPriceX96Now = slot0[0];

  if (sqrtPriceX96Now === 0n) {
    if (!initialPriceArg) {
      console.error('pool not initialized; pass --initialPriceX96 (e.g. for 1:1 ratio use 79228162514264337593543950336)');
      process.exit(1);
    }
    console.log('pool not initialized — initializing...');
    const hash = await walletClient.writeContract({
      address: poolManager, abi: POOL_MANAGER_ABI, functionName: 'initialize',
      args: [poolKey, BigInt(initialPriceArg)],
      account, chain: null,
    });
    console.log(`  init tx: ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log('  initialized.');
  } else {
    console.log(`pool already initialized at sqrtPriceX96=${sqrtPriceX96Now}, tick=${slot0[1]}`);
  }

  // Step 2: Permit2 setup for both tokens
  console.log('\nensuring Permit2 setup...');
  await ensurePermit2Setup({ publicClient, walletClient, account, token: currency0, positionManager, permit2 });
  await ensurePermit2Setup({ publicClient, walletClient, account, token: currency1, positionManager, permit2 });

  // Step 3: compute liquidity from desired amounts
  const sqrtCurrent = sqrtPriceX96Now === 0n ? BigInt(initialPriceArg!) : sqrtPriceX96Now;
  const sqrtA = getSqrtPriceAtTick(tickLower);
  const sqrtB = getSqrtPriceAtTick(tickUpper);
  const liquidity = getLiquidityForAmounts(sqrtCurrent, sqrtA, sqrtB, amount0Desired, amount1Desired);

  if (liquidity === 0n) {
    console.error('computed liquidity is 0 — your tickRange/amounts produce no liquidity. Check inputs.');
    process.exit(1);
  }

  console.log(`\nminting:\n  tickLower=${tickLower}, tickUpper=${tickUpper}\n  liquidity=${liquidity}\n  amount0Max=${amount0Desired}, amount1Max=${amount1Desired}`);

  // Step 4: build modifyLiquidities call: MINT_POSITION + SETTLE_PAIR
  const unlockData = encodeUnlockData(
    [ACTIONS.MINT_POSITION, ACTIONS.SETTLE_PAIR],
    [
      encodeMintPosition({
        poolKey,
        tickLower,
        tickUpper,
        liquidity,
        amount0Max: amount0Desired,
        amount1Max: amount1Desired,
        owner: account.address,
      }),
      encodeSettlePair(currency0, currency1),
    ],
  );

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  // Pre-flight via simulate
  console.log('\nsimulating...');
  await publicClient.simulateContract({
    address: positionManager, abi: POSITION_MANAGER_ABI, functionName: 'modifyLiquidities',
    args: [unlockData, deadline], account: account.address,
  });
  console.log('  ok.');

  console.log('\nsending mint tx...');
  const hash = await walletClient.writeContract({
    address: positionManager, abi: POSITION_MANAGER_ABI, functionName: 'modifyLiquidities',
    args: [unlockData, deadline],
    account, chain: null,
    value: currency0 === NATIVE ? amount0Desired : 0n,
  });
  console.log(`  tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  confirmed in block ${receipt.blockNumber}`);

  // Extract tokenId from the Transfer event (from = 0x0)
  const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const mintLog = receipt.logs.find(
    (l) => l.address.toLowerCase() === positionManager.toLowerCase()
      && l.topics?.[0] === transferTopic
      && /^0x0+$/.test(l.topics?.[1] ?? ''),
  );
  if (!mintLog) {
    console.warn('could not extract tokenId from tx logs — check the explorer.');
    return;
  }
  const tokenId = BigInt(mintLog.topics![3]!);

  console.log(`\n=========================================================`);
  console.log(`minted tokenId = ${tokenId}`);
  console.log(`paste this into wrangler.toml:\n`);
  console.log(`  TOKEN_ID = "${tokenId}"`);
  console.log(`=========================================================\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
