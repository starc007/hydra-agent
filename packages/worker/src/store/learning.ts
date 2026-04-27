export type DecisionContext = {
  id: string;
  doId: string;
  ts: number;
  action: string;
  poolId: string;
  featureVector: number[];
  contextSnapshot: Record<string, unknown>;
};

export type Outcome = {
  decisionId: string;
  doId: string;
  ts: number;
  feeDeltaUsd?: number;
  ilDeltaPct?: number;
  rangeAdherence4h?: number;
  rangeAdherence24h?: number;
  netPnlVsHold?: number;
  score4h?: number;
  score24h?: number;
  vectorized: number; // 0=pending, 1=done, -1=failed
};

export type Preference = {
  id: string;
  doId: string;
  ts: number;
  featureVector: number[];
  decision: 'approve' | 'reject';
  correlatesTo: string;
};

export type CalibrationEntry = {
  id: string;
  doId: string;
  ts: number;
  oldThresholds: Record<string, number>;
  newThresholds: Record<string, number>;
  outcomeSampleSize: number;
  avgScore: number;
};

export async function saveDecisionContext(db: D1Database, ctx: DecisionContext): Promise<void> {
  await db
    .prepare(
      'INSERT OR REPLACE INTO decision_contexts (id, do_id, ts, action, pool_id, feature_vector, context_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(ctx.id, ctx.doId, ctx.ts, ctx.action, ctx.poolId, JSON.stringify(ctx.featureVector), JSON.stringify(ctx.contextSnapshot))
    .run();
}

export async function getDecisionContext(db: D1Database, id: string): Promise<DecisionContext | null> {
  const r = await db
    .prepare('SELECT * FROM decision_contexts WHERE id = ?')
    .bind(id)
    .first<{ id: string; do_id: string; ts: number; action: string; pool_id: string; feature_vector: string; context_snapshot: string }>();
  if (!r) return null;
  return {
    id: r.id,
    doId: r.do_id,
    ts: r.ts,
    action: r.action,
    poolId: r.pool_id,
    featureVector: JSON.parse(r.feature_vector),
    contextSnapshot: JSON.parse(r.context_snapshot),
  };
}

export async function saveOutcome(db: D1Database, o: Outcome): Promise<void> {
  await db
    .prepare(
      'INSERT OR REPLACE INTO outcomes (decision_id, do_id, ts, fee_delta_usd, il_delta_pct, range_adherence_4h, range_adherence_24h, net_pnl_vs_hold, score_4h, score_24h, vectorized) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      o.decisionId, o.doId, o.ts,
      o.feeDeltaUsd ?? null, o.ilDeltaPct ?? null,
      o.rangeAdherence4h ?? null, o.rangeAdherence24h ?? null,
      o.netPnlVsHold ?? null, o.score4h ?? null, o.score24h ?? null,
      o.vectorized,
    )
    .run();
}

export async function updateOutcome(db: D1Database, decisionId: string, patch: Partial<Omit<Outcome, 'decisionId' | 'doId' | 'ts'>>): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.feeDeltaUsd !== undefined) { fields.push('fee_delta_usd = ?'); values.push(patch.feeDeltaUsd); }
  if (patch.ilDeltaPct !== undefined) { fields.push('il_delta_pct = ?'); values.push(patch.ilDeltaPct); }
  if (patch.rangeAdherence4h !== undefined) { fields.push('range_adherence_4h = ?'); values.push(patch.rangeAdherence4h); }
  if (patch.rangeAdherence24h !== undefined) { fields.push('range_adherence_24h = ?'); values.push(patch.rangeAdherence24h); }
  if (patch.netPnlVsHold !== undefined) { fields.push('net_pnl_vs_hold = ?'); values.push(patch.netPnlVsHold); }
  if (patch.score4h !== undefined) { fields.push('score_4h = ?'); values.push(patch.score4h); }
  if (patch.score24h !== undefined) { fields.push('score_24h = ?'); values.push(patch.score24h); }
  if (patch.vectorized !== undefined) { fields.push('vectorized = ?'); values.push(patch.vectorized); }
  if (!fields.length) return;
  values.push(decisionId);
  await db.prepare(`UPDATE outcomes SET ${fields.join(', ')} WHERE decision_id = ?`).bind(...values).run();
}

export async function getOutcome(db: D1Database, decisionId: string): Promise<Outcome | null> {
  const r = await db.prepare('SELECT * FROM outcomes WHERE decision_id = ?').bind(decisionId).first<Record<string, unknown>>();
  if (!r) return null;
  return mapOutcomeRow(r);
}

export async function listOutcomes(db: D1Database, doId: string, limit = 100): Promise<Outcome[]> {
  const r = await db
    .prepare('SELECT * FROM outcomes WHERE do_id = ? AND score_24h IS NOT NULL ORDER BY ts DESC LIMIT ?')
    .bind(doId, limit)
    .all<Record<string, unknown>>();
  return (r.results ?? []).map(mapOutcomeRow);
}

export async function listUnvectorized(db: D1Database, limit = 20): Promise<Outcome[]> {
  const r = await db
    .prepare('SELECT * FROM outcomes WHERE vectorized = 0 AND score_24h IS NOT NULL LIMIT ?')
    .bind(limit)
    .all<Record<string, unknown>>();
  return (r.results ?? []).map(mapOutcomeRow);
}

function mapOutcomeRow(r: Record<string, unknown>): Outcome {
  return {
    decisionId: r.decision_id as string,
    doId: r.do_id as string,
    ts: r.ts as number,
    feeDeltaUsd: r.fee_delta_usd as number | undefined,
    ilDeltaPct: r.il_delta_pct as number | undefined,
    rangeAdherence4h: r.range_adherence_4h as number | undefined,
    rangeAdherence24h: r.range_adherence_24h as number | undefined,
    netPnlVsHold: r.net_pnl_vs_hold as number | undefined,
    score4h: r.score_4h as number | undefined,
    score24h: r.score_24h as number | undefined,
    vectorized: r.vectorized as number,
  };
}

export async function savePreference(db: D1Database, p: Preference): Promise<void> {
  await db
    .prepare('INSERT OR REPLACE INTO preferences (id, do_id, ts, feature_vector, decision, correlates_to) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(p.id, p.doId, p.ts, JSON.stringify(p.featureVector), p.decision, p.correlatesTo)
    .run();
}

export async function listPreferences(db: D1Database, doId: string): Promise<Preference[]> {
  const r = await db
    .prepare('SELECT * FROM preferences WHERE do_id = ? ORDER BY ts DESC')
    .bind(doId)
    .all<{ id: string; do_id: string; ts: number; feature_vector: string; decision: string; correlates_to: string }>();
  return (r.results ?? []).map((x) => ({
    id: x.id,
    doId: x.do_id,
    ts: x.ts,
    featureVector: JSON.parse(x.feature_vector),
    decision: x.decision as 'approve' | 'reject',
    correlatesTo: x.correlates_to,
  }));
}

export async function saveCalibrationLog(db: D1Database, entry: CalibrationEntry): Promise<void> {
  await db
    .prepare('INSERT INTO calibration_log (id, do_id, ts, old_thresholds, new_thresholds, outcome_sample_size, avg_score) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(entry.id, entry.doId, entry.ts, JSON.stringify(entry.oldThresholds), JSON.stringify(entry.newThresholds), entry.outcomeSampleSize, entry.avgScore)
    .run();
}

export async function getLatestCalibration(db: D1Database, doId: string): Promise<CalibrationEntry | null> {
  const r = await db
    .prepare('SELECT * FROM calibration_log WHERE do_id = ? ORDER BY ts DESC LIMIT 1')
    .bind(doId)
    .first<{ id: string; do_id: string; ts: number; old_thresholds: string; new_thresholds: string; outcome_sample_size: number; avg_score: number }>();
  if (!r) return null;
  return {
    id: r.id,
    doId: r.do_id,
    ts: r.ts,
    oldThresholds: JSON.parse(r.old_thresholds),
    newThresholds: JSON.parse(r.new_thresholds),
    outcomeSampleSize: r.outcome_sample_size,
    avgScore: r.avg_score,
  };
}
