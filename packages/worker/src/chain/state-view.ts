import type { Address, Hex, PublicClient } from 'viem';

export const STATE_VIEW_ABI = [
  {
    type: 'function', name: 'getFeeGrowthInside',
    stateMutability: 'view',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'tickLower', type: 'int24' },
      { name: 'tickUpper', type: 'int24' },
    ],
    outputs: [
      { name: 'feeGrowthInside0X128', type: 'uint256' },
      { name: 'feeGrowthInside1X128', type: 'uint256' },
    ],
  },
  {
    type: 'function', name: 'getPositionInfo',
    stateMutability: 'view',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'owner', type: 'address' },
      { name: 'tickLower', type: 'int24' },
      { name: 'tickUpper', type: 'int24' },
      { name: 'salt', type: 'bytes32' },
    ],
    outputs: [
      { name: 'liquidity', type: 'uint128' },
      { name: 'feeGrowthInside0LastX128', type: 'uint256' },
      { name: 'feeGrowthInside1LastX128', type: 'uint256' },
    ],
  },
] as const;

const Q128 = 1n << 128n;

/**
 * Compute fees owed for a v4 position via StateView.
 * For positions held by PositionManager, owner = positionManager address, salt = bytes32(tokenId).
 */
export async function readPositionFees(args: {
  client: PublicClient;
  stateView: Address;
  poolId: Hex;
  positionManager: Address;
  tokenId: bigint;
  tickLower: number;
  tickUpper: number;
}): Promise<{ fees0: bigint; fees1: bigint }> {
  const salt = ('0x' + args.tokenId.toString(16).padStart(64, '0')) as Hex;

  const [insideNow, stored] = await Promise.all([
    args.client.readContract({
      address: args.stateView,
      abi: STATE_VIEW_ABI,
      functionName: 'getFeeGrowthInside',
      args: [args.poolId, args.tickLower, args.tickUpper],
    }),
    args.client.readContract({
      address: args.stateView,
      abi: STATE_VIEW_ABI,
      functionName: 'getPositionInfo',
      args: [args.poolId, args.positionManager, args.tickLower, args.tickUpper, salt],
    }),
  ]);

  const [insideNow0, insideNow1] = insideNow as [bigint, bigint];
  const [liquidity, last0, last1] = stored as [bigint, bigint, bigint];

  // Solidity unchecked subtraction: wrap to uint256.
  const delta0 = BigInt.asUintN(256, insideNow0 - last0);
  const delta1 = BigInt.asUintN(256, insideNow1 - last1);

  return {
    fees0: (delta0 * liquidity) / Q128,
    fees1: (delta1 * liquidity) / Q128,
  };
}
