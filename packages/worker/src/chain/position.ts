import type { PublicClient, Address } from 'viem';

export type Position = {
  tokenId: bigint;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  feesOwed0: bigint;
  feesOwed1: bigint;
};

export const POSITION_MANAGER_ABI = [
  {
    type: 'function', name: 'getPositionLiquidity',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: 'liquidity', type: 'uint128' }],
  },
] as const;

export async function readPosition(
  client: PublicClient,
  positionManager: Address,
  tokenId: bigint,
  tickLower: number,
  tickUpper: number,
): Promise<Position> {
  const liquidity = await client.readContract({
    address: positionManager,
    abi: POSITION_MANAGER_ABI,
    functionName: 'getPositionLiquidity',
    args: [tokenId],
  });
  return {
    tokenId,
    tickLower,
    tickUpper,
    liquidity: liquidity as bigint,
    feesOwed0: 0n,
    feesOwed1: 0n,
  };
}
