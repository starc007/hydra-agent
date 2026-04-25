import type { PublicClient, Address, Hex } from 'viem';

export type Position = {
  tokenId: bigint;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  feesOwed0: bigint;
  feesOwed1: bigint;
};

export type PositionMetadata = {
  poolKey: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  };
  poolId: Hex;
  tickLower: number;
  tickUpper: number;
};

export const POSITION_MANAGER_ABI = [
  {
    type: 'function', name: 'getPositionLiquidity',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: 'liquidity', type: 'uint128' }],
  },
  {
    type: 'function', name: 'getPoolAndPositionInfo',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      {
        name: 'poolKey', type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      { name: 'info', type: 'uint256' },
    ],
  },
  {
    type: 'function', name: 'modifyLiquidities',
    stateMutability: 'payable',
    inputs: [
      { name: 'unlockData', type: 'bytes' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

export async function readPositionLiquidity(client: PublicClient, positionManager: Address, tokenId: bigint): Promise<bigint> {
  const liquidity = await client.readContract({
    address: positionManager,
    abi: POSITION_MANAGER_ABI,
    functionName: 'getPositionLiquidity',
    args: [tokenId],
  });
  return liquidity as bigint;
}

/**
 * Reads PoolKey + unpacks PositionInfo for a v4 LP NFT.
 * PositionInfo bit layout:
 *   bits 0-7   hasSubscriber (uint8)
 *   bits 8-31  tickLower     (int24, sign-extended)
 *   bits 32-55 tickUpper     (int24, sign-extended)
 *   bits 56-255 poolId       (bytes25, upper 200 bits)
 */
export async function readPositionMetadata(client: PublicClient, positionManager: Address, tokenId: bigint): Promise<PositionMetadata> {
  const [poolKey, info] = await client.readContract({
    address: positionManager,
    abi: POSITION_MANAGER_ABI,
    functionName: 'getPoolAndPositionInfo',
    args: [tokenId],
  }) as [PositionMetadata['poolKey'], bigint];

  const tickLower = Number(BigInt.asIntN(24, (info >> 8n) & 0xFFFFFFn));
  const tickUpper = Number(BigInt.asIntN(24, (info >> 32n) & 0xFFFFFFn));

  // The on-chain v4 PoolId is keccak256(abi.encode(PoolKey)). It is NOT recoverable
  // from PositionInfo's truncated 200-bit field; recompute it from the PoolKey.
  // We import keccak256 + encodeAbiParameters here to keep the helper self-contained.
  const { keccak256, encodeAbiParameters } = await import('viem');
  const poolId = keccak256(
    encodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'currency0', type: 'address' },
            { name: 'currency1', type: 'address' },
            { name: 'fee', type: 'uint24' },
            { name: 'tickSpacing', type: 'int24' },
            { name: 'hooks', type: 'address' },
          ],
        },
      ],
      [poolKey],
    ),
  );

  return { poolKey, poolId, tickLower, tickUpper };
}

// kept for backward-compat callers — we no longer use the hardcoded ABI here
export type { Position as PositionLegacy };
