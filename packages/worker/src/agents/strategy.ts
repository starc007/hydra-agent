import { BaseAgent } from './base';
import type { Bus } from '../bus';
import type { AgentName, HydraEvent } from '../events';
import type { ClaudeClient } from '../llm/claude';

export type StrategyAgentDeps = {
  client: Pick<ClaudeClient, 'recommend'>;
  getPosition: () => unknown;
  triggerTypes?: HydraEvent['type'][];
};

const TRIGGERS: HydraEvent['type'][] = [
  'OUT_OF_RANGE',
  'IL_THRESHOLD_BREACH',
  'VOLATILITY_SPIKE',
  'FEE_HARVEST_READY',
];

export class StrategyAgent extends BaseAgent {
  name: AgentName = 'strategy';
  private recent: HydraEvent[] = [];
  private off?: () => void;

  constructor(bus: Bus, private deps: StrategyAgentDeps) { super(bus); }

  override start(): void {
    const triggers = new Set(this.deps.triggerTypes ?? TRIGGERS);
    this.off = this.bus.onAny(async (e) => {
      this.recent.push(e);
      if (this.recent.length > 50) this.recent.shift();
      if (!triggers.has(e.type)) return;
      try {
        const out = await this.deps.client.recommend({
          events: this.recent,
          position: this.deps.getPosition(),
        });
        this.emit({
          source: 'strategy',
          type: 'STRATEGY_RECOMMENDATION',
          payload: out,
        });
      } catch (err) {
        console.error('[strategy] recommend failed', err);
      }
    });
  }

  override stop(): void {
    super.stop();
    this.off?.();
  }
}
