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
    <main className="min-h-screen p-6">
      <header className="border-b border-border pb-4 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Hydra</h1>
        <p className="text-sm text-muted mt-1">
          Multi-agent liquidity coordination on Uniswap v4 — Unichain Sepolia
        </p>
      </header>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 md:col-span-2">
          <AgentStatus events={events} />
        </div>
        <div className="col-span-12 md:col-span-7">
          <LiveFeed events={events} />
        </div>
        <div className="col-span-12 md:col-span-3 space-y-4">
          <PositionPanel snapshot={snapshot} events={events} />
          <DecisionLog snapshot={snapshot} />
        </div>
      </div>
    </main>
  );
}
