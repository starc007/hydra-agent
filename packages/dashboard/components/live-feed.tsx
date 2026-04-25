'use client';
import { AGENT_COLORS, relativeTime, type HydraEvent } from '../lib/ws';

function summarize(e: HydraEvent): string {
  switch (e.type) {
    case 'PRICE_UPDATE': return `tick ${e.payload.tick}`;
    case 'OUT_OF_RANGE': return `tick ${e.payload.tick} ${e.payload.side as string}`;
    case 'IL_THRESHOLD_BREACH': return `IL ${(e.payload.ilPct as number).toFixed(2)}%`;
    case 'POSITION_HEALTHY': return `IL ${(e.payload.ilPct as number).toFixed(2)}%`;
    case 'FEE_HARVEST_READY': return `$${(e.payload.feesEarnedUsd as number).toFixed(2)} fees ready`;
    case 'STRATEGY_RECOMMENDATION': {
      const action = e.payload.action as string;
      const conf = e.payload.confidence as number;
      return `${action} (${(conf * 100).toFixed(0)}%)`;
    }
    case 'APPROVED': return `${e.payload.action as string} — ${e.payload.reason as string}`;
    case 'ESCALATE': return e.payload.reason as string;
    case 'HUMAN_DECISION': return `${e.payload.decision as string}`;
    case 'TX_SUBMITTED': return `${(e.payload.hash as string).slice(0, 10)}…`;
    case 'TX_CONFIRMED': return `block ${e.payload.blockNumber as number}`;
    case 'TX_FAILED': return (e.payload.error as string).slice(0, 80);
    default: return '';
  }
}

export function LiveFeed({ events }: { events: HydraEvent[] }) {
  return (
    <section className="bg-panel border border-border rounded-lg p-4 h-[calc(100vh-200px)] flex flex-col">
      <h2 className="text-xs uppercase tracking-wider text-muted mb-3">Live feed</h2>
      <ul className="overflow-y-auto flex-1 font-mono text-sm space-y-1">
        {events.length === 0 && (
          <li className="text-muted text-xs">Waiting for events…</li>
        )}
        {events.map((e) => (
          <li key={e.id} className="row-enter flex items-center gap-3 py-1 border-b border-border/50 last:border-0">
            <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${AGENT_COLORS[e.source]}`} />
            <span className="text-muted text-xs w-20 shrink-0">{e.source}</span>
            <span className="text-ink w-44 shrink-0">{e.type}</span>
            <span className="text-muted text-xs flex-1 truncate">{summarize(e)}</span>
            <span className="text-muted text-xs shrink-0">{relativeTime(e.ts)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
