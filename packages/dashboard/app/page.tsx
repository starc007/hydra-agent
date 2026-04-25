'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useEventStream, useSnapshot } from '../lib/ws';
import { loadSession, clearSession, type Session } from '../lib/storage';
import { unregister, forceAction } from '../lib/api';
import { AgentStatus } from '../components/agent-status';
import { LiveFeed } from '../components/live-feed';
import { PositionPanel } from '../components/position-panel';
import { DecisionLog } from '../components/decision-log';

export default function HomePage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const s = loadSession();
    setSession(s);
    setHydrated(true);
    if (!s) router.replace('/setup');
  }, [router]);

  const events = useEventStream(session?.doId ?? null, 200);
  const { data: snapshot } = useSnapshot(session?.doId ?? null);

  if (!hydrated) return <main className="min-h-screen grid place-items-center text-muted text-sm">Loading…</main>;
  if (!session) return null; // redirecting

  async function handleSignOut() {
    if (!session) return;
    try {
      await unregister(session.doId, session.sessionToken);
    } catch { /* allow client-side clearing even if server-side fails */ }
    clearSession();
    router.replace('/setup');
  }

  async function handleForce(action: 'REBALANCE' | 'HARVEST' | 'EXIT') {
    if (!session) return;
    if (!confirm(`Trigger ${action} now?`)) return;
    try {
      await forceAction(session.doId, session.sessionToken, action);
    } catch (e) {
      alert(`force ${action} failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  return (
    <main className="min-h-screen px-6 py-8 max-w-[1400px] mx-auto">
      <header className="card p-6 mb-6 bg-hero-gradient">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="w-8 h-8 rounded-xl bg-brand-gradient grid place-items-center font-bold text-bg shadow-glow">H</span>
              <h1 className="text-2xl font-semibold tracking-tight text-ink">Hydra</h1>
              <span className="pill bg-brand-soft text-brand border-brand-ring/40">v4 LP coordinator</span>
            </div>
            <p className="text-sm text-muted ml-11">
              Multi-agent liquidity coordination on Uniswap v4 — Unichain Sepolia
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 ml-11 md:ml-0">
            <span className="pill bg-elevated text-muted border-border">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-soft" />
              connected
            </span>
            <span className="pill bg-elevated text-muted border-border font-mono">
              tokenId {snapshot?.activeTokenId ?? session.tokenId}
            </span>
            <span className="pill bg-elevated text-muted border-border font-mono">
              {session.wallet.slice(0, 6)}…{session.wallet.slice(-4)}
            </span>
            <button onClick={handleSignOut} className="btn-ghost text-xs px-3 py-1.5">Sign out</button>
          </div>
        </div>

        <div className="ml-11 mt-4 flex flex-wrap gap-2">
          <button onClick={() => handleForce('REBALANCE')} className="btn-ghost text-xs px-3 py-1.5">Force rebalance</button>
          <button onClick={() => handleForce('HARVEST')} className="btn-ghost text-xs px-3 py-1.5">Force harvest</button>
          <button onClick={() => handleForce('EXIT')} className="btn-ghost text-xs px-3 py-1.5">Force exit</button>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 md:col-span-3 lg:col-span-2">
          <AgentStatus events={events} />
        </div>
        <div className="col-span-12 md:col-span-9 lg:col-span-7">
          <LiveFeed events={events} />
        </div>
        <div className="col-span-12 lg:col-span-3 space-y-4">
          <PositionPanel snapshot={snapshot} events={events} />
          <DecisionLog snapshot={snapshot} />
        </div>
      </div>
    </main>
  );
}
