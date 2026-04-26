'use client';
import type { AgentName, HydraEvent } from '../../lib/ws';
import { AgentCard } from './agent-card';

const ORDER: AgentName[] = ['price', 'risk', 'strategy', 'coordinator', 'execution'];

export function AgentList({ events }: { events: HydraEvent[] }) {
  const last = new Map<AgentName, HydraEvent>();
  for (const e of events) if (!last.has(e.source)) last.set(e.source, e);

  return (
    <div className="space-y-2">
      <div className="label px-1">Agents</div>
      <div className="space-y-2">
        {ORDER.map((n) => (
          <AgentCard key={n} name={n} last={last.get(n)} />
        ))}
      </div>
    </div>
  );
}
