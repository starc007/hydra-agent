import type { HydraEvent, StrategyRecommendation } from '../events';
import type { Bus } from '../bus';

export type DecisionRow = {
  id: string;
  ts: number;
  action: string;
  reason: string;
  approved: boolean;
  recommendation: StrategyRecommendation['payload'];
};

export async function writeEvent(db: D1Database, doId: string, e: HydraEvent): Promise<void> {
  await db
    .prepare('INSERT OR REPLACE INTO events (id, do_id, ts, source, type, payload) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(e.id, doId, e.ts, e.source, e.type, JSON.stringify(e.payload))
    .run();
}

export async function listEvents(db: D1Database, doId: string, limit: number): Promise<HydraEvent[]> {
  const r = await db
    .prepare('SELECT id, ts, source, type, payload FROM events WHERE do_id = ? ORDER BY ts DESC LIMIT ?')
    .bind(doId, limit)
    .all<{ id: string; ts: number; source: string; type: string; payload: string }>();
  return (r.results ?? []).map((x) => ({
    id: x.id,
    ts: x.ts,
    source: x.source as HydraEvent['source'],
    type: x.type as HydraEvent['type'],
    payload: JSON.parse(x.payload),
  })) as HydraEvent[];
}

export async function writeDecision(db: D1Database, doId: string, d: DecisionRow): Promise<void> {
  await db
    .prepare(
      'INSERT OR REPLACE INTO decisions (id, do_id, ts, action, reason, approved, recommendation) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(d.id, doId, d.ts, d.action, d.reason, d.approved ? 1 : 0, JSON.stringify(d.recommendation))
    .run();
}

export async function listDecisions(db: D1Database, doId: string, limit: number): Promise<DecisionRow[]> {
  const r = await db
    .prepare(
      'SELECT id, ts, action, reason, approved, recommendation FROM decisions WHERE do_id = ? ORDER BY ts DESC LIMIT ?',
    )
    .bind(doId, limit)
    .all<{ id: string; ts: number; action: string; reason: string; approved: number; recommendation: string }>();
  return (r.results ?? []).map((x) => ({
    id: x.id,
    ts: x.ts,
    action: x.action,
    reason: x.reason,
    approved: x.approved === 1,
    recommendation: JSON.parse(x.recommendation),
  }));
}

export function attachArchiver(bus: Bus, db: D1Database, doId: string): () => void {
  return bus.onAny((e) => {
    writeEvent(db, doId, e).catch((err) => console.error('[d1] writeEvent failed:', err));
  });
}
