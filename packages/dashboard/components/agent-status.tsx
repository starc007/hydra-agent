'use client';
import { AGENT_COLORS, type AgentName, type HydraEvent } from '../lib/ws';

const AGENTS: AgentName[] = ['price', 'risk', 'strategy', 'coordinator', 'execution'];

export function AgentStatus({ events }: { events: HydraEvent[] }) {
  const lastSeen = new Map<AgentName, number>();
  for (const e of events) {
    if (!lastSeen.has(e.source)) lastSeen.set(e.source, e.ts);
  }
  const escalating = events.some((e) => e.type === 'ESCALATE' && Date.now() - e.ts < 30_000);

  return (
    <aside className="bg-panel border border-border rounded-lg p-4">
      <h2 className="text-xs uppercase tracking-wider text-muted mb-3">Agents</h2>
      <ul className="space-y-2">
        {AGENTS.map((a) => {
          const ts = lastSeen.get(a);
          const idle = ts ? Date.now() - ts > 30_000 : true;
          const dot = a === 'coordinator' && escalating
            ? 'bg-warn'
            : idle ? 'bg-muted/50' : AGENT_COLORS[a];
          return (
            <li key={a} className="flex items-center gap-3">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${dot}`} />
              <span className="text-sm capitalize">{a}</span>
              <span className="text-xs text-muted ml-auto">
                {ts ? `${Math.max(0, Math.floor((Date.now() - ts) / 1000))}s` : '—'}
              </span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
