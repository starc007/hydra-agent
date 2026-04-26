'use client';
import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { AppShell } from '../components/layout/app-shell';
import { BrandCard } from '../components/layout/brand-card';
import { AgentList } from '../components/agents/agent-list';
import { LiveFeed } from '../components/feed/live-feed';
import { PositionPanel } from '../components/position/position-panel';
import { DecisionLog } from '../components/position/decision-log';
import { ActionsPanel } from '../components/position/actions-panel';
import { Onboarding } from '../components/onboarding/onboarding';
import { useEventStream, useSnapshot } from '../lib/ws';
import { loadSession, saveSession, clearSession, type Session } from '../lib/storage';
import { useWallet } from '../lib/wallet';
import { unregister } from '../lib/api';

export default function HomePage() {
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  // Wallet state is owned by wagmi — no local useState for address.
  const { address, isConnected, disconnect } = useWallet();
  const wallet: Address | null = isConnected && address ? address : null;

  useEffect(() => {
    const stored = loadSession();
    if (stored) setSession(stored);
    setHydrated(true);
  }, []);

  const events = useEventStream(session?.doId ?? null, 200);
  const { data: snapshot } = useSnapshot(session?.doId ?? null);

  if (!hydrated) {
    return (
      <main className="min-h-screen grid place-items-center text-sm text-muted bg-bg">
        Loading…
      </main>
    );
  }

  async function handleSignOut() {
    if (!session) return;
    try { await unregister(session.doId, session.sessionToken); } catch { /* tolerate */ }
    clearSession();
    setSession(null);
    await disconnect();
  }

  if (!session) {
    return (
      <AppShell
        left={<BrandCard wallet={wallet ?? undefined} />}
        center={
          <Onboarding
            wallet={wallet}
            onRegistered={(s) => { saveSession(s); setSession(s); }}
          />
        }
        right={null}
      />
    );
  }

  return (
    <AppShell
      left={
        <>
          <BrandCard wallet={session.wallet} onSignOut={handleSignOut} />
          <AgentList events={events} />
        </>
      }
      center={<LiveFeed events={events} />}
      right={
        <>
          <PositionPanel snapshot={snapshot} events={events} />
          <ActionsPanel session={session} />
          <DecisionLog snapshot={snapshot} />
        </>
      }
    />
  );
}
