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
import { readSilentAccount } from '../lib/wallet';
import { lookup, unregister } from '../lib/api';

export default function HomePage() {
  const [hydrated, setHydrated] = useState(false);
  const [wallet, setWallet] = useState<Address | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    (async () => {
      const stored = loadSession();
      if (stored) setSession(stored);

      const silent = await readSilentAccount();
      if (silent) {
        setWallet(silent);
        if (!stored) {
          // Wallet known but no local session — check if there's a registered position.
          // We can't restore the session token (only issued at register time),
          // so we leave session=null to surface the register form.
          const rows = await lookup(silent);
          void rows; // available for future "re-link" UX
        }
      }
      setHydrated(true);
    })();
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
  }

  if (!session) {
    return (
      <AppShell
        left={<BrandCard wallet={wallet ?? undefined} />}
        center={
          <Onboarding
            wallet={wallet}
            setWallet={setWallet}
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
