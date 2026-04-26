'use client';
import type { Address } from 'viem';
import type { Session } from '../../lib/storage';
import { ConnectWallet } from './connect-wallet';
import { RegisterForm } from './register-form';

export function Onboarding({
  wallet,
  onRegistered,
}: {
  wallet: Address | null;
  onRegistered: (s: Session) => void;
}) {
  // When wallet is null AppKit modal handles the connect flow.
  // wagmi reactivity updates `wallet` once connected.
  if (!wallet) {
    return <ConnectWallet />;
  }
  return <RegisterForm wallet={wallet} onRegistered={onRegistered} />;
}
