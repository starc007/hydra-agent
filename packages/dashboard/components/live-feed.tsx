'use client';
import { AGENT_COLORS, relativeTime, type HydraEvent } from '../lib/ws';

function summarize(e: HydraEvent): string {
  switch (e.type) {
    case 'PRICE_UPDATE':         return `tick ${e.payload.tick}`;
    case 'OUT_OF_RANGE':         return `tick ${e.payload.tick} ${e.payload.side as string}`;
    case 'IL_THRESHOLD_BREACH':  return `IL ${(e.payload.ilPct as number).toFixed(2)}%`;
    case 'POSITION_HEALTHY':     return `IL ${(e.payload.ilPct as number).toFixed(2)}%`;
    case 'FEE_HARVEST_READY':    return `$${(e.payload.feesEarnedUsd as number).toFixed(2)} fees ready`;
    case 'STRATEGY_RECOMMENDATION': {
      const action = e.payload.action as string;
      const conf = e.payload.confidence as number;
      return `${action} (${(conf * 100).toFixed(0)}%)`;
    }
    case 'APPROVED':             return `${e.payload.action as string} — ${e.payload.reason as string}`;
    case 'ESCALATE':             return e.payload.reason as string;
    case 'HUMAN_DECISION':       return `${e.payload.decision as string}`;
    case 'TX_SUBMITTED':         return `${(e.payload.hash as string).slice(0, 10)}…`;
    case 'TX_CONFIRMED':         return `block ${e.payload.blockNumber as number}`;
    case 'TX_FAILED':            return (e.payload.error as string).slice(0, 80);
    default:                     return '';
  }
}

const PILL_TONE: Record<string, string> = {
  OUT_OF_RANGE:         'bg-warn/15 text-warn border-warn/20',
  IL_THRESHOLD_BREACH:  'bg-err/15 text-err border-err/20',
  STRATEGY_RECOMMENDATION: 'bg-brand-soft text-brand border-brand-ring/40',
  APPROVED:             'bg-accent/15 text-accent border-accent/20',
  ESCALATE:             'bg-warn/15 text-warn border-warn/20',
  TX_CONFIRMED:         'bg-accent/15 text-accent border-accent/20',
  TX_FAILED:            'bg-err/15 text-err border-err/20',
  TX_SUBMITTED:         'bg-elevated text-ink border-border',
};

export function LiveFeed({ events }: { events: HydraEvent[] }) {
  return (
    <section className="card p-5 h-[calc(100vh-220px)] flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="label">Live feed</h2>
        <span className="text-[10px] text-subtle font-mono">{events.length} events</span>
      </div>
      <ul className="overflow-y-auto flex-1 -mx-2 px-2">
        {events.length === 0 && (
          <li className="text-xs text-subtle px-2 py-8 text-center">Waiting for events…</li>
        )}
        {events.map((e) => {
          const tone = PILL_TONE[e.type] ?? 'bg-elevated text-muted border-border';
          return (
            <li key={e.id} className="animate-row-enter group flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-surfaceAlt/60 transition">
              <span className={`relative inline-block w-1.5 h-1.5 rounded-full shrink-0 ${AGENT_COLORS[e.source]}`} />
              <span className="text-[11px] text-subtle uppercase tracking-wider w-20 shrink-0">{e.source}</span>
              <span className={`pill ${tone} shrink-0`}>{e.type.replaceAll('_', ' ').toLowerCase()}</span>
              <span className="text-sm text-muted flex-1 truncate font-mono">{summarize(e)}</span>
              <span className="text-[11px] text-subtle font-mono shrink-0">{relativeTime(e.ts)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
