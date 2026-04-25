'use client';
import type { HydraEvent, Snapshot } from '../lib/ws';

function fmt(n: number, digits = 4) { return Number.isFinite(n) ? n.toFixed(digits) : '—'; }

export function PositionPanel({ snapshot, events }: { snapshot: Snapshot | null; events: HydraEvent[] }) {
  const lastPrice = events.find((e) => e.type === 'PRICE_UPDATE');
  const lastHealth = events.find((e) => e.type === 'IL_THRESHOLD_BREACH' || e.type === 'POSITION_HEALTHY');
  const tick = lastPrice ? Number(lastPrice.payload.tick) : snapshot?.latestPool?.tick;
  const price = lastPrice ? Number(lastPrice.payload.price) : 0;
  const range = snapshot?.range;
  const ilPct = lastHealth ? Number(lastHealth.payload.ilPct) : 0;
  const inRange = range && tick != null
    ? tick >= range.tickLower && tick <= range.tickUpper
    : null;

  const inRangeClass = inRange == null ? 'text-muted' : inRange ? 'text-accent' : 'text-warn';
  const ilClass = ilPct >= 2.5 ? 'text-err' : ilPct >= 1 ? 'text-warn' : 'text-accent';

  return (
    <section className="bg-panel border border-border rounded-lg p-4">
      <h2 className="text-xs uppercase tracking-wider text-muted mb-3">Position</h2>
      <dl className="grid grid-cols-2 gap-y-2 text-sm font-mono">
        <dt className="text-muted">Tick</dt>
        <dd>{tick ?? '—'}</dd>

        <dt className="text-muted">Price</dt>
        <dd>{fmt(price, 6)}</dd>

        <dt className="text-muted">Range</dt>
        <dd>{range ? `${range.tickLower} … ${range.tickUpper}` : '—'}</dd>

        <dt className="text-muted">In range</dt>
        <dd className={inRangeClass}>{inRange == null ? '—' : inRange ? 'yes' : 'no'}</dd>

        <dt className="text-muted">IL</dt>
        <dd className={ilClass}>{ilPct.toFixed(2)}%</dd>

        <dt className="text-muted">Entry price</dt>
        <dd>{snapshot?.entryPrice != null ? fmt(snapshot.entryPrice, 6) : '—'}</dd>
      </dl>
    </section>
  );
}
