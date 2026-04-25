import { BaseAgent } from './base';
import type { Bus } from '../bus';
import type { PoolState } from '../chain/pool';
import type { AgentName } from '../events';

export type PriceAgentDeps = {
  range: () => { tickLower: number; tickUpper: number };
  fetcher: () => Promise<PoolState>;
};

export class PriceAgent extends BaseAgent {
  name: AgentName = 'price';
  private lastSide: 'in' | 'below' | 'above' = 'in';

  constructor(bus: Bus, private deps: PriceAgentDeps) { super(bus); }

  async tick(): Promise<void> {
    if (this.stopped) return;
    let s: PoolState;
    try { s = await this.deps.fetcher(); }
    catch (err) { console.error('[price] fetch failed', err); return; }

    this.emit({
      source: 'price',
      type: 'PRICE_UPDATE',
      payload: { tick: s.tick, sqrtPriceX96: s.sqrtPriceX96.toString(), price: 0 },
    });

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
  }
}
