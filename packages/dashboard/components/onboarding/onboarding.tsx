'use client';
import type { Address } from 'viem';
import type { Session } from '../../lib/storage';
import { ConnectWallet } from './connect-wallet';
import { RegisterForm } from './register-form';

export function Onboarding({
  wallet,
  setWallet,
  onRegistered,
}: {
  wallet: Address | null;
  setWallet: (a: Address) => void;
  onRegistered: (s: Session) => void;
}) {
  if (!wallet) {
    return <ConnectWallet onConnected={setWallet} />;
  }
  return <RegisterForm wallet={wallet} onRegistered={onRegistered} />;
}
