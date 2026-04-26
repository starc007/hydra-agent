import { BaseAgent } from './base';
import type { Bus } from '../bus';
import type { AgentName } from '../events';
import { ilPercent } from '../chain/il';
import type { LLMClient } from '../llm/client';
import type { TickSample } from './price';

export type RiskSample = {
  priceEntry: number;
  priceNow: number;
  feesEarnedUsd: number;
};

export type RiskAgentDeps = {
  thresholdPct: number;
  feeHarvestMinUsd?: number;
  sample: () => Promise<RiskSample>;
  client: Pick<LLMClient, 'analyzeRisk'>;
  getRecentTicks?: () => TickSample[];
  getTimeInRange?: () => number;
};

const MIN_ANALYSIS_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const IL_CHANGE_THRESHOLD_PCT = 0.3;

export class RiskAgent extends BaseAgent {
  name: AgentName = 'risk';
  private lastAnalysisTs = 0;
  private lastIlPct = -1;

  constructor(bus: Bus, private deps: RiskAgentDeps) { super(bus); }

  async tick(): Promise<void> {
    if (this.stopped) return;
    const minHarvest = this.deps.feeHarvestMinUsd ?? 5;
    let s: RiskSample;
    try { s = await this.deps.sample(); }
    catch (err) { console.error('[risk] sample failed', err); return; }

    const ilPct = Math.abs(ilPercent(s.priceEntry, s.priceNow)) * 100;

    // Deterministic rule-based emits (Strategy still triggers on these)
    if (ilPct >= this.deps.thresholdPct) {
      this.emit({
        source: 'risk',
        type: 'IL_THRESHOLD_BREACH',
        payload: { ilPct, thresholdPct: this.deps.thresholdPct },
      });
    } else {
      this.emit({
        source: 'risk',
        type: 'POSITION_HEALTHY',
        payload: { ilPct, feesEarnedUsd: s.feesEarnedUsd },
      });
    }
    if (s.feesEarnedUsd >= minHarvest) {
      this.emit({
        source: 'risk',
        type: 'FEE_HARVEST_READY',
        payload: { feesEarnedUsd: s.feesEarnedUsd },
      });
    }

    // Throttled LLM analysis
    const now = Date.now();
    const ilChanged =
      this.lastIlPct < 0
        ? true
        : Math.abs(ilPct - this.lastIlPct) >= IL_CHANGE_THRESHOLD_PCT;
    const timeThresholdMet = now - this.lastAnalysisTs >= MIN_ANALYSIS_INTERVAL_MS;

    if (ilChanged || timeThresholdMet) {
      try {
        const ticks = this.deps.getRecentTicks ? this.deps.getRecentTicks() : [];
        const timeInRange = this.deps.getTimeInRange ? this.deps.getTimeInRange() : 100;
        const result = await this.deps.client.analyzeRisk({
          ilPct,
          feesEarnedUsd: s.feesEarnedUsd,
          timeInRange,
          ticks: ticks.slice(-10),
        });
        this.lastAnalysisTs = now;
        this.lastIlPct = ilPct;
        this.emit({
          source: 'risk',
          type: 'RISK_ANALYSIS',
          payload: {
            verdict: result.verdict,
            reasoning: result.reasoning,
            hint: result.hint,
            ilPct,
            feesEarnedUsd: s.feesEarnedUsd,
          },
        });
      } catch (err) {
        console.error('[risk] analyzeRisk failed', err);
      }
    }
  }
}
