'use client';
import type { HydraEvent, Snapshot } from '../lib/ws';

function fmt(n: number, digits = 4) { return Number.isFinite(n) ? n.toFixed(digits) : '—'; }

function TokenPair({ a, b }: { a: string; b: string }) {
  return (
    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-pill-gradient border border-borderStrong">
      <span className="flex -space-x-2">
        <span className="w-5 h-5 rounded-full bg-brand grid place-items-center text-[10px] font-bold text-bg ring-2 ring-surface">{a.slice(0, 1)}</span>
        <span className="w-5 h-5 rounded-full bg-agent-execution grid place-items-center text-[10px] font-bold text-bg ring-2 ring-surface">{b.slice(0, 1)}</span>
      </span>
      <span className="font-mono text-xs font-semibold tracking-wide">{a} / {b}</span>
    </span>
  );
}

export function PositionPanel({ snapshot, events }: { snapshot: Snapshot | null; events: HydraEvent[] }) {
  const lastPrice = events.find((e) => e.type === 'PRICE_UPDATE');
  const lastHealth = events.find((e) => e.type === 'IL_THRESHOLD_BREACH' || e.type === 'POSITION_HEALTHY');
  const tick = lastPrice ? Number(lastPrice.payload.tick) : snapshot?.latestPool?.tick;
  const price = lastPrice ? Number(lastPrice.payload.price) : 0;
  const range = snapshot?.range;
  const ilPct = lastHealth ? Number(lastHealth.payload.ilPct) : 0;
  const inRange = range && tick != null ? tick >= range.tickLower && tick <= range.tickUpper : null;

  const inRangeBadge = inRange == null
    ? { text: 'unknown', tone: 'bg-elevated text-muted border-border' }
    : inRange
      ? { text: 'in range', tone: 'bg-accent/15 text-accent border-accent/20' }
      : { text: 'out of range', tone: 'bg-warn/15 text-warn border-warn/20' };

  const ilTone = ilPct >= 2.5 ? 'text-err' : ilPct >= 1 ? 'text-warn' : 'text-accent';

  const t0 = snapshot?.latestPool?.token0?.symbol ?? '—';
  const t1 = snapshot?.latestPool?.token1?.symbol ?? '—';

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="label">Position</h2>
        <TokenPair a={t0} b={t1} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Stat label="Price" value={fmt(price, 6)} mono />
        <Stat label="Tick" value={tick == null ? '—' : `${tick}`} mono />
        <Stat label="Entry price" value={snapshot?.entryPrice != null ? fmt(snapshot.entryPrice, 6) : '—'} mono />
        <Stat label="Status" value={<span className={`pill ${inRangeBadge.tone}`}>{inRangeBadge.text}</span>} />
      </div>

      <div className="mt-5 pt-4 border-t border-border space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="label">Range</span>
          <span className="font-mono text-sm text-ink">
            {range ? `${range.tickLower} … ${range.tickUpper}` : '—'}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="label">IL</span>
          <span className={`font-mono text-sm ${ilTone}`}>{ilPct.toFixed(2)}%</span>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      <div className={`text-base text-ink ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}
