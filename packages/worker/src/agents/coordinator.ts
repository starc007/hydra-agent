import { BaseAgent } from './base';
import type { Bus } from '../bus';
import type { AgentName, HydraEvent, StrategyRecommendation } from '../events';
import type { LLMClient } from '../llm/client';

export type CoordinatorConfig = {
  dailyTxCap: number;
  cooldownSec: number;
  minConfidence: number;
  requireSignals: readonly HydraEvent['type'][];
  client: Pick<LLMClient, 'reviewCoordinator'>;
};

type Pending = { recId: string; rec: StrategyRecommendation['payload'] };

export class Coordinator extends BaseAgent {
  name: AgentName = 'coordinator';
  private off?: () => void;
  private recent = new Map<HydraEvent['type'], number>();
  private recentEvents: HydraEvent[] = [];
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
      this.recentEvents.push(e);
      if (this.recentEvents.length > 30) this.recentEvents.shift();
      return;
    }

    const rec = (e as StrategyRecommendation).payload;
    if (rec.action === 'HOLD') return;

    void this.handleRecommendation(e as StrategyRecommendation, rec);
  }

  private async handleRecommendation(
    e: StrategyRecommendation,
    rec: StrategyRecommendation['payload'],
  ): Promise<void> {
    const { ruleReason, isMarginal } = this.evaluateWithMarginality(rec);

    if (!isMarginal) {
      // Hard outcomes — skip LLM
      if (!ruleReason) {
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
          payload: { reason: ruleReason, correlatesTo: e.id, recommendation: rec },
        });
      }
      return;
    }

    // Marginal case — ask LLM for a second opinion (one call per STRATEGY_RECOMMENDATION)
    let llmVerdict: { action: 'approve' | 'escalate' | 'block'; reasoning: string };
    try {
      llmVerdict = await this.cfg.client.reviewCoordinator({
        recommendation: { action: rec.action, confidence: rec.confidence, rationale: rec.rationale },
        recentEvents: this.recentEvents,
        rules: {
          ruleOutcome: ruleReason ? 'escalate' : 'approve',
          reason: ruleReason,
          txToday: this.txToday,
          dailyTxCap: this.cfg.dailyTxCap,
          cooldownActive: Date.now() - this.lastApproved < this.cfg.cooldownSec * 1000,
        },
      });
    } catch (err) {
      console.error('[coordinator] reviewCoordinator failed', err);
      // Fall back to rule outcome
      llmVerdict = { action: ruleReason ? 'escalate' : 'approve', reasoning: 'LLM unavailable' };
    }

    // Emit review event regardless of outcome
    this.emit({
      source: 'coordinator',
      type: 'COORDINATOR_REVIEW',
      payload: { action: llmVerdict.action, reasoning: llmVerdict.reasoning, correlatesTo: e.id },
    });

    if (llmVerdict.action === 'approve') {
      this.lastApproved = Date.now();
      this.emit({
        source: 'coordinator',
        type: 'APPROVED',
        payload: { action: rec.action, reason: llmVerdict.reasoning, correlatesTo: e.id },
      });
    } else {
      // escalate or block — surface as ESCALATE with reason prefixed for block
      const reason =
        llmVerdict.action === 'block'
          ? `blocked by reviewer: ${llmVerdict.reasoning}`
          : llmVerdict.reasoning;
      this.pending.set(e.id, { recId: e.id, rec });
      this.emit({
        source: 'coordinator',
        type: 'ESCALATE',
        payload: { reason, correlatesTo: e.id, recommendation: rec },
      });
    }
  }

  private evaluateWithMarginality(rec: StrategyRecommendation['payload']): {
    ruleReason: string | null;
    isMarginal: boolean;
  } {
    if (this.txToday >= this.cfg.dailyTxCap) {
      return { ruleReason: 'daily tx cap exceeded', isMarginal: false };
    }
    const cooldownActive = Date.now() - this.lastApproved < this.cfg.cooldownSec * 1000;
    if (cooldownActive) {
      return { ruleReason: 'cooldown active', isMarginal: false };
    }
    if (rec.confidence < this.cfg.minConfidence) {
      // Low confidence is hard-fail, not marginal
      return { ruleReason: `confidence ${rec.confidence} < ${this.cfg.minConfidence}`, isMarginal: false };
    }

    const hasSupport = this.cfg.requireSignals.some((t) => {
      const ts = this.recent.get(t);
      return ts && Date.now() - ts < 60_000;
    });

    const atHighTxUsage = this.txToday >= Math.floor(this.cfg.dailyTxCap * 0.8);
    const marginalConfidence = rec.confidence >= 0.7 && rec.confidence <= 0.9;

    // Marginal: medium confidence, OR support-only failure, OR near daily cap
    if (marginalConfidence || atHighTxUsage || !hasSupport) {
      const ruleReason = !hasSupport ? 'no recent supporting signal' : null;
      return { ruleReason, isMarginal: true };
    }

    // High confidence + good support + not near cap → clean approve
    return { ruleReason: null, isMarginal: false };
  }
}
