import { BaseAgent } from './base';
import type { Bus } from '../bus';
import type { AgentName, HydraEvent, StrategyRecommendation } from '../events';

export type CoordinatorConfig = {
  dailyTxCap: number;
  cooldownSec: number;
  minConfidence: number;
  requireSignals: readonly HydraEvent['type'][];
};

type Pending = { recId: string; rec: StrategyRecommendation['payload'] };

export class Coordinator extends BaseAgent {
  name: AgentName = 'coordinator';
  private off?: () => void;
  private recent = new Map<HydraEvent['type'], number>();
  private pending = new Map<string, Pending>();
  private txToday = 0;
  private lastApproved = 0;
  private dayStart = Date.now();

  constructor(bus: Bus, private cfg: CoordinatorConfig) { super(bus); }

  override start(): void {
    this.off = this.bus.onAny((e) => this.handle(e));
  }

  override stop(): void {
    super.stop();
    this.off?.();
  }

  private handle(e: HydraEvent) {
    if (Date.now() - this.dayStart > 24 * 3600 * 1000) {
      this.txToday = 0;
      this.dayStart = Date.now();
    }

    if (e.type === 'TX_CONFIRMED' || e.type === 'TX_FAILED') {
      this.txToday++;
      return;
    }

    if (e.type === 'HUMAN_DECISION') {
      const p = this.pending.get(e.payload.correlatesTo);
      if (!p) return;
      this.pending.delete(e.payload.correlatesTo);
      if (e.payload.decision === 'approve') {
        this.lastApproved = Date.now();
        this.emit({
          source: 'coordinator',
          type: 'APPROVED',
          payload: { action: p.rec.action, reason: 'human approved', correlatesTo: e.payload.correlatesTo },
        });
      }
      return;
    }

    if (e.type !== 'STRATEGY_RECOMMENDATION') {
      this.recent.set(e.type, e.ts);
      return;
    }

    const rec = (e as StrategyRecommendation).payload;
    if (rec.action === 'HOLD') return;
    const reason = this.evaluate(rec);
    if (!reason) {
      this.lastApproved = Date.now();
      this.emit({
        source: 'coordinator',
        type: 'APPROVED',
        payload: { action: rec.action, reason: 'consensus' },
      });
    } else {
      this.pending.set(e.id, { recId: e.id, rec });
      this.emit({
        source: 'coordinator',
        type: 'ESCALATE',
        payload: { reason, correlatesTo: e.id, recommendation: rec },
      });
    }
  }

  private evaluate(rec: StrategyRecommendation['payload']): string | null {
    if (this.txToday >= this.cfg.dailyTxCap) return 'daily tx cap exceeded';
    if (Date.now() - this.lastApproved < this.cfg.cooldownSec * 1000) return 'cooldown active';
    if (rec.confidence < this.cfg.minConfidence) return `confidence ${rec.confidence} < ${this.cfg.minConfidence}`;
    const supports = this.cfg.requireSignals.some((t) => {
      const ts = this.recent.get(t);
      return ts && Date.now() - ts < 60_000;
    });
    if (!supports) return 'no recent supporting signal';
    return null;
  }
}
