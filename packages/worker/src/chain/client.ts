import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const unichainSepolia = {
  id: 1301,
  name: 'Unichain Sepolia',
  network: 'unichain-sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia.unichain.org'] } },
} as const;

export function makeClients(opts: { rpcUrl: string; privateKey: `0x${string}` }) {
  const account = privateKeyToAccount(opts.privateKey);
  const transport = http(opts.rpcUrl);
  const publicClient = createPublicClient({ chain: unichainSepolia, transport });
  const walletClient = createWalletClient({ chain: unichainSepolia, transport, account });
  return { publicClient, walletClient, account };
}
