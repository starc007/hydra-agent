'use client';
import { useState } from 'react';
import { Wallet } from 'lucide-react';
import type { Address } from 'viem';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { hasInjected, requestAccount } from '../../lib/wallet';

export function ConnectWallet({ onConnected }: { onConnected: (address: Address) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  async function connect() {
    setError(null);
    setConnecting(true);
    try {
      const addr = await requestAccount();
      onConnected(addr);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }

  return (
    <Card className="bg-hero-gradient">
      <CardContent className="pt-8 pb-8 text-center space-y-5">
        <div className="space-y-2">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-brand-gradient grid place-items-center shadow-glow">
            <Wallet className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-xl font-semibold">Welcome to Hydra</h2>
          <p className="text-sm text-muted max-w-[420px] mx-auto">
            Autonomous LP management for Uniswap v4. Connect a wallet to start monitoring a position.
          </p>
        </div>
        <Button size="lg" onClick={connect} disabled={connecting || !hasInjected()}>
          {connecting ? 'Opening wallet…' : hasInjected() ? 'Connect wallet' : 'No wallet detected'}
        </Button>
        {error && <p className="text-xs text-err">{error}</p>}
        {!hasInjected() && (
          <p className="text-xs text-subtle">
            Install MetaMask or another browser wallet to continue.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
