import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Config } from '../config';

export const unichainSepolia = {
  id: 1301,
  name: 'Unichain Sepolia',
  network: 'unichain-sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia.unichain.org'] } },
} as const;

export function makeClients(cfg: Config) {
  const account = privateKeyToAccount(cfg.privateKey);
  const transport = http(cfg.RPC_URL);
  const publicClient = createPublicClient({ chain: unichainSepolia, transport });
  const walletClient = createWalletClient({ chain: unichainSepolia, transport, account });
  return { publicClient, walletClient, account };
}
