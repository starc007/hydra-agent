import { buildFeatureVector, type FeatureContext } from './feature-vector';
import { queryExperiences } from '../store/vectorize';
import { getDecisionContext, getOutcome } from '../store/learning';

export type RetrievalContext = {
  fewShotBlock: string;
  featureVector: number[];
};

/**
 * Build a few-shot context block from similar past decisions in Vectorize.
 * Returns empty string on cold start (no results).
 */
export async function buildRetrievalContext(args: {
  vectorize: VectorizeIndex | undefined;
  db: D1Database;
  featureCtx: FeatureContext;
}): Promise<RetrievalContext> {
  const { vectorize, db, featureCtx } = args;

  const featureVector = buildFeatureVector(featureCtx);

  if (!vectorize) {
    return { fewShotBlock: '', featureVector };
  }

  let matches: Awaited<ReturnType<typeof queryExperiences>> = [];
  try {
    matches = await queryExperiences(vectorize, featureVector, 5);
  } catch {
    return { fewShotBlock: '', featureVector };
  }

  if (!matches.length) {
    return { fewShotBlock: '', featureVector };
  }

  // Fetch full context + outcomes from D1
  const rows = await Promise.all(
    matches.map(async (m) => {
      const [ctx, outcome] = await Promise.all([
        getDecisionContext(db, m.decision_id),
        getOutcome(db, m.decision_id),
      ]);
      return { m, ctx, outcome };
    }),
  );

  const lines: string[] = ['## Past situations similar to now'];
  let idx = 1;
  for (const { m, ctx, outcome } of rows) {
    if (!ctx || !outcome) continue;
    const snap = ctx.contextSnapshot as Record<string, unknown>;
    const priceTrend = ctx.featureVector[0] > 0.55 ? 'up' : ctx.featureVector[0] < 0.45 ? 'down' : 'flat';
    const ilPct = ((ctx.featureVector[1] ?? 0) * 20).toFixed(1);
    const conf = ((ctx.featureVector[2] ?? 0) * 100).toFixed(0);
    const score4h = outcome.score4h?.toFixed(2) ?? '?';
    const score24h = outcome.score24h?.toFixed(2) ?? '?';
    const feeDelta = outcome.feeDeltaUsd != null ? `$${outcome.feeDeltaUsd.toFixed(2)} fees` : '?';
    const inRange = outcome.rangeAdherence24h === 1 ? '100% in-range' : outcome.rangeAdherence24h === 0 ? 'out-of-range' : '?';
    const verdict = (outcome.score24h ?? 0) >= 0 ? 'good call' : 'wrong call';
    lines.push(
      `[${idx}] Price: ${priceTrend} | IL: ${ilPct}% | confidence: ${parseFloat(conf) / 100} → ${ctx.action}`,
      `    4h: ${feeDelta}, ${inRange} | 24h score: ${score24h} (${verdict})`,
    );
    idx++;
  }

  if (idx === 1) return { fewShotBlock: '', featureVector }; // no valid rows

  return { fewShotBlock: lines.join('\n'), featureVector };
}
