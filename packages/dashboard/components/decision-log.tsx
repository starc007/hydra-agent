'use client';
import type { Snapshot } from '../lib/ws';

export function DecisionLog({ snapshot }: { snapshot: Snapshot | null }) {
  const decisions = snapshot?.decisions ?? [];
  return (
    <section className="bg-panel border border-border rounded-lg p-4">
      <h2 className="text-xs uppercase tracking-wider text-muted mb-3">Decisions</h2>
      {decisions.length === 0 && <p className="text-xs text-muted">No decisions yet.</p>}
      <ul className="space-y-3 max-h-80 overflow-y-auto">
        {decisions.map((d) => (
          <li key={d.id} className="border-b border-border/50 pb-2 last:border-0">
            <div className="flex items-center gap-2 text-xs">
              <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${d.approved ? 'bg-accent/20 text-accent' : 'bg-warn/20 text-warn'}`}>
                {d.approved ? 'approved' : 'escalated'}
              </span>
              <span className="font-mono text-ink">{d.action}</span>
              <span className="text-muted ml-auto">{new Date(d.ts).toLocaleTimeString()}</span>
            </div>
            <p className="text-xs text-muted mt-1">{d.recommendation.rationale || d.reason}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
