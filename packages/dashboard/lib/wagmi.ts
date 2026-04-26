'use client';

import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import type { AppKitNetwork } from '@reown/appkit/networks';

// Unichain Sepolia (chainId 1301) defined inline — not included in AppKit's preset
// networks list as of @reown/appkit v1.8. Shape satisfies AppKitNetwork (BaseNetwork).
export const unichainSepolia: AppKitNetwork = {
  id: 1301,
  name: 'Unichain Sepolia',
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia.unichain.org'] } },
  blockExplorers: { default: { name: 'Uniscan', url: 'https://sepolia.uniscan.xyz' } },
  testnet: true,
} as AppKitNetwork;

export const projectId =
  (process.env.NEXT_PUBLIC_REOWN_PROJECT_ID as string | undefined) ?? 'MISSING_PROJECT_ID';

export const networks = [unichainSepolia] as [AppKitNetwork, ...AppKitNetwork[]];

// v1.6+ API: WagmiAdapter creates its own internal wagmiConfig and exposes it
// as wagmiAdapter.wagmiConfig. We do NOT call defaultWagmiConfig separately.
export const wagmiAdapter = new WagmiAdapter({
  ssr: false,
  networks,
  projectId,
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
