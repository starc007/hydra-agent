'use client';
import { AGENT_COLORS, type AgentName, type HydraEvent } from '../lib/ws';

const AGENTS: { name: AgentName; label: string }[] = [
  { name: 'price', label: 'Price' },
  { name: 'risk', label: 'Risk' },
  { name: 'strategy', label: 'Strategy' },
  { name: 'coordinator', label: 'Coordinator' },
  { name: 'execution', label: 'Execution' },
];

export function AgentStatus({ events }: { events: HydraEvent[] }) {
  const lastSeen = new Map<AgentName, number>();
  for (const e of events) if (!lastSeen.has(e.source)) lastSeen.set(e.source, e.ts);
  const escalating = events.some((e) => e.type === 'ESCALATE' && Date.now() - e.ts < 30_000);

  return (
    <aside className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="label">Agents</h2>
        <span className="text-[10px] text-subtle font-mono">5 active</span>
      </div>
      <ul className="space-y-3">
        {AGENTS.map(({ name, label }) => {
          const ts = lastSeen.get(name);
          const seconds = ts ? Math.max(0, Math.floor((Date.now() - ts) / 1000)) : null;
          const idle = ts ? Date.now() - ts > 30_000 : true;
          const isCoordEscalating = name === 'coordinator' && escalating;
          const dotColor = isCoordEscalating
            ? 'bg-warn'
            : idle ? 'bg-subtle/40' : `${AGENT_COLORS[name]}`;
          return (
            <li key={name} className="flex items-center gap-3">
              <span className={`relative inline-block w-2 h-2 rounded-full ${dotColor} ${idle ? '' : 'animate-pulse-soft'}`}>
                {!idle && <span className={`absolute inset-0 rounded-full ${dotColor} opacity-30 blur-sm`} />}
              </span>
              <span className="text-sm font-medium text-ink">{label}</span>
              <span className="ml-auto text-[11px] text-subtle font-mono">
                {seconds == null ? '—' : seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`}
              </span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
