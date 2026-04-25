'use client';

import { useEventStream, useSnapshot } from '../lib/ws';
import { AgentStatus } from '../components/agent-status';
import { LiveFeed } from '../components/live-feed';
import { PositionPanel } from '../components/position-panel';
import { DecisionLog } from '../components/decision-log';

export default function HomePage() {
  const events = useEventStream(200);
  const { data: snapshot } = useSnapshot();

  return (
    <main className="min-h-screen px-6 py-8 max-w-[1400px] mx-auto">
      {/* Hero header */}
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
          <div className="flex items-center gap-3 ml-11 md:ml-0">
            <span className="pill bg-elevated text-muted border-border">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-soft" />
              connected
            </span>
            <span className="pill bg-elevated text-muted border-border font-mono">
              tokenId {(snapshot as (typeof snapshot & { activeTokenId?: string | number }) | null)?.activeTokenId ?? '—'}
            </span>
          </div>
        </div>
      </header>

      {/* Main grid */}
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
