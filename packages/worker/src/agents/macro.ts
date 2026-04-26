import { BaseAgent } from './base';
import type { Bus } from '../bus';
import type { AgentName } from '../events';
import type { LLMClient } from '../llm/client';

export type MacroPoolStats = {
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tick: number;
  recentTickRange: { min: number; max: number };
  stdDev?: number;
  drift?: number;
};

export type MacroAgentDeps = {
  client: Pick<LLMClient, 'analyzeMarket'>;
  getPoolStats: () => Promise<MacroPoolStats>;
};

const MIN_TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class MacroAgent extends BaseAgent {
  name: AgentName = 'macro';
  private lastTickTs = 0;

  constructor(bus: Bus, private deps: MacroAgentDeps) { super(bus); }

  async tick(): Promise<void> {
    if (this.stopped) return;
    const now = Date.now();
    if (now - this.lastTickTs < MIN_TICK_INTERVAL_MS) return;

    let stats: MacroPoolStats;
    try { stats = await this.deps.getPoolStats(); }
    catch (err) { console.error('[macro] getPoolStats failed', err); return; }

    try {
      const result = await this.deps.client.analyzeMarket({
        poolStats: {
          sqrtPriceX96: stats.sqrtPriceX96.toString(),
          liquidity: stats.liquidity.toString(),
          tick: stats.tick,
          recentTickRange: stats.recentTickRange,
          stdDev: stats.stdDev,
          drift: stats.drift,
        },
      });
      this.lastTickTs = now;
      this.emit({
        source: 'macro',
        type: 'MARKET_CONTEXT',
        payload: { vibe: result.vibe, reasoning: result.reasoning },
      });
    } catch (err) {
      console.error('[macro] analyzeMarket failed', err);
    }
  }
}
