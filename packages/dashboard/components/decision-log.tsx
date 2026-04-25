'use client';
import type { Snapshot } from '../lib/ws';

export function DecisionLog({ snapshot }: { snapshot: Snapshot | null }) {
  const decisions = snapshot?.decisions ?? [];
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="label">Decisions</h2>
        <span className="text-[10px] text-subtle font-mono">{decisions.length}</span>
      </div>
      {decisions.length === 0 && (
        <p className="text-xs text-subtle py-4 text-center">No decisions yet.</p>
      )}
      <ul className="space-y-3 max-h-80 overflow-y-auto">
        {decisions.map((d) => (
          <li key={d.id} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className={`pill ${d.approved ? 'bg-accent/15 text-accent border-accent/20' : 'bg-warn/15 text-warn border-warn/20'}`}>
                {d.approved ? 'approved' : 'escalated'}
              </span>
              <span className="font-mono text-xs text-ink">{d.action}</span>
              <span className="text-[10px] text-subtle font-mono ml-auto">
                {new Date(d.ts).toLocaleTimeString()}
              </span>
            </div>
            <p className="text-xs text-muted leading-relaxed">{d.recommendation.rationale || d.reason}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
