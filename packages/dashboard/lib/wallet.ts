'use client';
import { createWalletClient, custom, type Address } from 'viem';

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...a: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...a: unknown[]) => void) => void;
    };
  }
}

export function hasInjected(): boolean {
  return typeof window !== 'undefined' && !!window.ethereum;
}

export async function readSilentAccount(): Promise<Address | null> {
  if (!hasInjected()) return null;
  try {
    const accs = (await window.ethereum!.request({ method: 'eth_accounts' })) as string[];
    return accs?.[0] ? (accs[0].toLowerCase() as Address) : null;
  } catch { return null; }
}

export async function requestAccount(): Promise<Address> {
  if (!hasInjected()) throw new Error('No injected wallet detected. Install MetaMask or similar.');
  const accs = (await window.ethereum!.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accs?.[0]) throw new Error('No account returned from wallet.');
  return accs[0].toLowerCase() as Address;
}

export function makeInjectedClient(account: Address) {
  return createWalletClient({ account, transport: custom(window.ethereum!) });
}
