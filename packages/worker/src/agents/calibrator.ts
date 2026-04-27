import { listOutcomes, saveCalibrationLog } from '../store/learning';
import { newId } from '../ids';

export type CoordinatorThresholds = {
  minConfidence: number;
  cooldownSec: number;
  dailyTxCap: number;
};

const MIN_CONFIDENCE_GRID = [0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90];
const COOLDOWN_GRID = [300, 600, 900, 1800, 3600];
const DAILY_CAP_GRID = [3, 5, 7, 10];
const MIN_SAMPLES = 10;

/**
 * Run a grid search over coordinator thresholds using historical outcome scores.
 * Returns the best thresholds, or null if insufficient data.
 */
export async function calibrateThresholds(
  db: D1Database,
  doId: string,
  current: CoordinatorThresholds,
): Promise<CoordinatorThresholds | null> {
  const outcomes = await listOutcomes(db, doId, 200);
  if (outcomes.length < MIN_SAMPLES) return null;

  let bestScore = -Infinity;
  let best = current;

  for (const minConfidence of MIN_CONFIDENCE_GRID) {
    for (const cooldownSec of COOLDOWN_GRID) {
      for (const dailyTxCap of DAILY_CAP_GRID) {
        const scores: number[] = [];
        let txToday = 0;
        let dayStart = outcomes[outcomes.length - 1].ts;
        let lastApproved = 0;

        for (const o of [...outcomes].reverse()) {
          if (o.ts - dayStart > 24 * 3600 * 1000) {
            txToday = 0;
            dayStart = o.ts;
          }
          const snap = o as { featureVector?: number[] };
          const confidence = (snap.featureVector?.[2] ?? 0.7);
          const cooldownActive = o.ts - lastApproved < cooldownSec * 1000;

          const wouldApprove =
            txToday < dailyTxCap &&
            !cooldownActive &&
            confidence >= minConfidence;

          if (wouldApprove && o.score24h != null) {
            scores.push(o.score24h);
            txToday++;
            lastApproved = o.ts;
          }
        }

        if (!scores.length) continue;
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        if (avg > bestScore) {
          bestScore = avg;
          best = { minConfidence, cooldownSec, dailyTxCap };
        }
      }
    }
  }

  if (best === current) return null;

  await saveCalibrationLog(db, {
    id: newId(),
    doId,
    ts: Date.now(),
    oldThresholds: current,
    newThresholds: best,
    outcomeSampleSize: outcomes.length,
    avgScore: bestScore,
  });

  return best;
}

/**
 * Compute the preference profile centroid vectors from approve/reject history.
 */
export function computePreferenceProfile(
  preferences: Array<{ featureVector: number[]; decision: 'approve' | 'reject' }>,
): { approvedCentroid: number[]; rejectedCentroid: number[]; approveCount: number; rejectCount: number } {
  const approved = preferences.filter((p) => p.decision === 'approve').map((p) => p.featureVector);
  const rejected = preferences.filter((p) => p.decision === 'reject').map((p) => p.featureVector);

  return {
    approvedCentroid: centroid(approved),
    rejectedCentroid: centroid(rejected),
    approveCount: approved.length,
    rejectCount: rejected.length,
  };
}

function centroid(vecs: number[][]): number[] {
  if (!vecs.length) return [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  const dims = vecs[0].length;
  const sum = new Array<number>(dims).fill(0);
  for (const v of vecs) {
    for (let i = 0; i < dims; i++) sum[i] += v[i];
  }
  return sum.map((s) => s / vecs.length);
}
