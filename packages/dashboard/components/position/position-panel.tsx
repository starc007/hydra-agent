'use client';
import type { HydraEvent, Snapshot } from '../../lib/ws';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';

function fmt(n: number, digits = 4) {
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

function TokenPair({ a, b }: { a: string; b: string }) {
  return (
    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-borderStrong bg-elevated">
      <span className="flex -space-x-2">
        <span className="w-5 h-5 rounded-full bg-brand grid place-items-center text-[10px] font-bold text-white ring-2 ring-surface">
          {a.slice(0, 1)}
        </span>
        <span className="w-5 h-5 rounded-full bg-agent-execution grid place-items-center text-[10px] font-bold text-white ring-2 ring-surface">
          {b.slice(0, 1)}
        </span>
      </span>
      <span className="font-mono text-xs font-semibold">{a} / {b}</span>
    </div>
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

export function PositionPanel({
  snapshot,
  events,
}: {
  snapshot: Snapshot | null;
  events: HydraEvent[];
}) {
  const lastPrice = events.find((e) => e.type === 'PRICE_UPDATE');
  const lastHealth = events.find(
    (e) => e.type === 'IL_THRESHOLD_BREACH' || e.type === 'POSITION_HEALTHY',
  );
  const tick = lastPrice ? Number(lastPrice.payload.tick) : snapshot?.latestPool?.tick;
  const price = lastPrice ? Number(lastPrice.payload.price) : 0;
  const range = snapshot?.range;
  const ilPct = lastHealth ? Number(lastHealth.payload.ilPct) : 0;
  const inRange = range && tick != null ? tick >= range.tickLower && tick <= range.tickUpper : null;

  const rangeTone = inRange == null ? 'default' : inRange ? 'accent' : 'warn';
  const rangeText = inRange == null ? 'unknown' : inRange ? 'in range' : 'out of range';
  const ilTone = ilPct >= 2.5 ? 'text-err' : ilPct >= 1 ? 'text-warn' : 'text-accent';

  const t0 = snapshot?.latestPool?.token0?.symbol ?? '—';
  const t1 = snapshot?.latestPool?.token1?.symbol ?? '—';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Position</CardTitle>
        <TokenPair a={t0} b={t1} />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Price" value={fmt(price, 6)} mono />
          <Stat label="Tick" value={tick == null ? '—' : `${tick}`} mono />
          <Stat
            label="Entry price"
            value={snapshot?.entryPrice != null ? fmt(snapshot.entryPrice, 6) : '—'}
            mono
          />
          <Stat label="Status" value={<Badge tone={rangeTone}>{rangeText}</Badge>} />
        </div>
        <div className="pt-3 border-t border-border space-y-3">
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
      </CardContent>
    </Card>
  );
}
