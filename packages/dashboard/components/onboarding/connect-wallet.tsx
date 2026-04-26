'use client';
import { useEffect } from 'react';
import { Wallet } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { useWallet } from '../../lib/wallet';
import type { Address } from 'viem';

export function ConnectWallet({ onConnected }: { onConnected?: (address: Address) => void }) {
  const { address, isConnected, open } = useWallet();

  useEffect(() => {
    if (isConnected && address) onConnected?.(address);
  }, [isConnected, address, onConnected]);

  return (
    <Card className="bg-hero-gradient">
      <CardContent className="pt-8 pb-8 text-center space-y-5">
        <div className="space-y-2">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-brand-gradient grid place-items-center border border-borderStrong">
            <Wallet className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-xl font-semibold">Welcome to Hydra</h2>
          <p className="text-sm text-muted max-w-[420px] mx-auto">
            Autonomous LP management for Uniswap v4. Connect a wallet to start monitoring a
            position.
          </p>
        </div>
        <Button size="lg" onClick={() => void open()}>
          Connect wallet
        </Button>
      </CardContent>
    </Card>
  );
}
