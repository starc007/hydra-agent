'use client';

import { useAccount, useDisconnect } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import type { Address } from 'viem';

export function useWallet(): {
  address: Address | undefined;
  isConnected: boolean;
  open: () => Promise<void>;
  disconnect: () => Promise<void>;
} {
  const { address, isConnected } = useAccount();
  const { open } = useAppKit();
  const { disconnectAsync } = useDisconnect();
  return {
    address: address?.toLowerCase() as Address | undefined,
    isConnected,
    open: async () => { await open(); },
    disconnect: async () => { await disconnectAsync(); },
  };
}
