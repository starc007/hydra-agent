import { BaseAgent } from './base';
import type { Bus } from '../bus';
import type { PoolState } from '../chain/pool';
import type { AgentName, VolatilityLevel } from '../events';
import type { LLMClient } from '../llm/client';

export type TickSample = { tick: number; ts: number };

export type PriceAgentDeps = {
  range: () => { tickLower: number; tickUpper: number };
  fetcher: () => Promise<PoolState>;
  priceOf?: (s: PoolState) => number;
  client: Pick<LLMClient, 'analyzePrice'>;
};

const BUFFER_SIZE = 30;
const MIN_ANALYSIS_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const STD_DEV_CHANGE_THRESHOLD = 0.2; // 20%

function stdDev(samples: TickSample[]): number {
  if (samples.length < 2) return 0;
  const ticks = samples.map((s) => s.tick);
  const mean = ticks.reduce((a, b) => a + b, 0) / ticks.length;
  const variance = ticks.reduce((sum, t) => sum + (t - mean) ** 2, 0) / ticks.length;
  return Math.sqrt(variance);
}

export class PriceAgent extends BaseAgent {
  name: AgentName = 'price';
  private lastSide: 'in' | 'below' | 'above' = 'in';

  private buffer: TickSample[] = [];
  private lastAnalysisTs = 0;
  private lastStdDev = 0;
  private lastVolatility: VolatilityLevel = 'low';

  constructor(bus: Bus, private deps: PriceAgentDeps) { super(bus); }

  getRecentTicks(n = BUFFER_SIZE): TickSample[] {
    return this.buffer.slice(-n);
  }

  getTimeInRangePct(): number {
    const { tickLower, tickUpper } = this.deps.range();
    if (this.buffer.length === 0) return 100;
    const inRange = this.buffer.filter((s) => s.tick >= tickLower && s.tick <= tickUpper).length;
    return (inRange / this.buffer.length) * 100;
  }

  async tick(): Promise<void> {
    if (this.stopped) return;
    let s: PoolState;
    try { s = await this.deps.fetcher(); }
    catch (err) { console.error('[price] fetch failed', err); return; }

    const price = this.deps.priceOf ? this.deps.priceOf(s) : 0;
    this.emit({
      source: 'price',
      type: 'PRICE_UPDATE',
      payload: { tick: s.tick, sqrtPriceX96: s.sqrtPriceX96.toString(), price },
    });

    // Maintain rolling buffer
    this.buffer.push({ tick: s.tick, ts: Date.now() });
    if (this.buffer.length > BUFFER_SIZE) this.buffer.shift();

    // Out-of-range detection
    const { tickLower, tickUpper } = this.deps.range();
    const side: 'in' | 'below' | 'above' =
      s.tick < tickLower ? 'below' : s.tick > tickUpper ? 'above' : 'in';
    if (side !== 'in' && side !== this.lastSide) {
      this.emit({
        source: 'price',
        type: 'OUT_OF_RANGE',
        payload: { tick: s.tick, tickLower, tickUpper, side },
      });
    }
    this.lastSide = side;

    // LLM analysis — only if buffer has enough data
    if (this.buffer.length < 3) return;

    const currentStdDev = stdDev(this.buffer);
    const now = Date.now();
    const timeSinceLastAnalysis = now - this.lastAnalysisTs;
    const stdDevChanged =
      this.lastStdDev > 0
        ? Math.abs(currentStdDev - this.lastStdDev) / this.lastStdDev > STD_DEV_CHANGE_THRESHOLD
        : true;
    const timeThresholdMet = timeSinceLastAnalysis >= MIN_ANALYSIS_INTERVAL_MS;
    const hasPriceMovement = currentStdDev > 1;

    if ((stdDevChanged || timeThresholdMet) && hasPriceMovement) {
      try {
        const result = await this.deps.client.analyzePrice({ ticks: this.buffer });
        this.lastAnalysisTs = now;
        this.lastStdDev = currentStdDev;

        this.emit({
          source: 'price',
          type: 'PRICE_PATTERN',
          payload: { pattern: result.pattern, volatility: result.volatility, reasoning: result.reasoning },
        });

        if (result.volatility === 'high' && this.lastVolatility !== 'high') {
          this.emit({
            source: 'price',
            type: 'VOLATILITY_SPIKE',
            payload: { stdDev: currentStdDev, window: this.buffer.length, reasoning: result.reasoning },
          });
        }
        this.lastVolatility = result.volatility;
      } catch (err) {
        console.error('[price] analyzePrice failed', err);
      }
    }
  }
}
