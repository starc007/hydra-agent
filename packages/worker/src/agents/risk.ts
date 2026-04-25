import { BaseAgent } from './base';
import type { Bus } from '../bus';
import type { AgentName } from '../events';
import { ilPercent } from '../chain/il';

export type RiskSample = {
  priceEntry: number;
  priceNow: number;
  feesEarnedUsd: number;
};

export type RiskAgentDeps = {
  thresholdPct: number;
  feeHarvestMinUsd?: number;
  sample: () => Promise<RiskSample>;
};

export class RiskAgent extends BaseAgent {
  name: AgentName = 'risk';
  constructor(bus: Bus, private deps: RiskAgentDeps) { super(bus); }

  async tick(): Promise<void> {
    if (this.stopped) return;
    const minHarvest = this.deps.feeHarvestMinUsd ?? 5;
    let s: RiskSample;
    try { s = await this.deps.sample(); }
    catch (err) { console.error('[risk] sample failed', err); return; }

    const ilPct = Math.abs(ilPercent(s.priceEntry, s.priceNow)) * 100;
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
  }
}
