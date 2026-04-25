import type { Address, PublicClient } from 'viem';

export const ERC20_ABI = [
  { type: 'function', name: 'symbol',   stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8'  }] },
  { type: 'function', name: 'name',     stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const;

export type TokenMetadata = {
  address: Address;
  symbol: string;
  decimals: number;
};

const NATIVE: TokenMetadata = { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 };

export async function readErc20Metadata(client: PublicClient, address: Address): Promise<TokenMetadata> {
  // v4 uses address(0) for native ETH
  if (address === NATIVE.address) return NATIVE;
  const [symbol, decimals] = await Promise.all([
    client.readContract({ address, abi: ERC20_ABI, functionName: 'symbol' }) as Promise<string>,
    client.readContract({ address, abi: ERC20_ABI, functionName: 'decimals' }) as Promise<number>,
  ]);
  return { address, symbol, decimals: Number(decimals) };
}
