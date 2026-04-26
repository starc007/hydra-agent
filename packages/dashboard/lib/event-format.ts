import type { HydraEvent } from './ws';

export type EventTone = 'default' | 'brand' | 'accent' | 'warn' | 'err';

export type EventLabel = {
  headline: string;
  detail: string;
  tone: EventTone;
  /** When set, the row renders the detail as a clickable link to the chain explorer. */
  txHash?: string;
};

export const EXPLORER_TX_BASE = 'https://sepolia.uniscan.xyz/tx';

export function shortHash(h: string): string {
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}

export function eventLabel(e: HydraEvent): EventLabel {
  switch (e.type) {
    case 'PRICE_UPDATE':
      return { headline: 'Price tick', detail: `tick ${e.payload.tick}`, tone: 'default' };
    case 'OUT_OF_RANGE':
      return { headline: 'Position out of range', detail: `${e.payload.side} ${e.payload.tickLower}…${e.payload.tickUpper}`, tone: 'warn' };
    case 'IL_THRESHOLD_BREACH':
      return { headline: 'Impermanent loss too high', detail: `${(e.payload.ilPct as number).toFixed(2)}%`, tone: 'err' };
    case 'POSITION_HEALTHY':
      return { headline: 'Position healthy', detail: `IL ${(e.payload.ilPct as number).toFixed(2)}%`, tone: 'accent' };
    case 'FEE_HARVEST_READY':
      return { headline: 'Fees ready to harvest', detail: `$${(e.payload.feesEarnedUsd as number).toFixed(2)}`, tone: 'accent' };
    case 'STRATEGY_RECOMMENDATION':
      return {
        headline: `Decision: ${e.payload.action}`,
        detail: `${((e.payload.confidence as number) * 100).toFixed(0)}% confidence — ${(e.payload.rationale as string).slice(0, 120)}`,
        tone: 'brand',
      };
    case 'APPROVED':
      return { headline: `Approved ${e.payload.action}`, detail: e.payload.reason as string, tone: 'accent' };
    case 'ESCALATE':
      return { headline: 'Escalated to human', detail: e.payload.reason as string, tone: 'warn' };
    case 'HUMAN_DECISION':
      return { headline: `Human ${e.payload.decision}`, detail: '', tone: 'brand' };
    case 'TX_SUBMITTED': {
      const hash = e.payload.hash as string;
      return { headline: 'Tx sent', detail: shortHash(hash), tone: 'default', txHash: hash };
    }
    case 'TX_CONFIRMED': {
      const hash = e.payload.hash as string;
      return {
        headline: 'Tx confirmed',
        detail: `block ${e.payload.blockNumber} — ${shortHash(hash)}`,
        tone: 'accent',
        txHash: hash,
      };
    }
    case 'TX_FAILED': {
      const hash = (e.payload.hash as string | undefined) ?? '';
      return {
        headline: 'Tx failed',
        detail: (e.payload.error as string).slice(0, 140),
        tone: 'err',
        txHash: hash || undefined,
      };
    }
    case 'PRICE_PATTERN': {
      const p = e.payload as { pattern: string; volatility: string; reasoning: string };
      const tone: EventTone = p.volatility === 'high' ? 'warn' : p.volatility === 'medium' ? 'default' : 'accent';
      return { headline: `Price ${p.pattern.replace(/_/g, ' ')}`, detail: `${p.volatility} volatility — ${p.reasoning.slice(0, 120)}`, tone };
    }
    case 'VOLATILITY_SPIKE': {
      const p = e.payload as { stdDev: number; window: number; reasoning?: string };
      return { headline: 'Volatility spike', detail: p.reasoning ?? `σ ${p.stdDev.toFixed(2)} over ${p.window} samples`, tone: 'warn' };
    }
    case 'RISK_ANALYSIS': {
      const p = e.payload as { verdict: string; reasoning: string; hint?: string; ilPct: number; feesEarnedUsd: number };
      const tone: EventTone = p.verdict === 'dangerous' ? 'err' : p.verdict === 'concerning' ? 'warn' : 'accent';
      return { headline: `Risk: ${p.verdict}`, detail: `${p.reasoning.slice(0, 130)}${p.hint ? ` — hint: ${p.hint}` : ''}`, tone };
    }
    case 'COORDINATOR_REVIEW': {
      const p = e.payload as { action: string; reasoning: string };
      const tone: EventTone = p.action === 'block' ? 'err' : p.action === 'escalate' ? 'warn' : 'accent';
      return { headline: `Coordinator: ${p.action}`, detail: p.reasoning.slice(0, 140), tone };
    }
    case 'MARKET_CONTEXT': {
      const p = e.payload as { vibe: string; reasoning: string };
      const tone: EventTone = p.vibe === 'bullish' ? 'accent' : p.vibe === 'bearish' ? 'warn' : 'default';
      return { headline: `Market: ${p.vibe}`, detail: p.reasoning.slice(0, 140), tone };
    }
    default:
      return { headline: e.type, detail: '', tone: 'default' };
  }
}

export const AGENT_LABEL: Record<string, string> = {
  price: 'Price',
  risk: 'Risk',
  strategy: 'Strategy',
  coordinator: 'Coordinator',
  execution: 'Execution',
  bot: 'Bot',
  macro: 'Macro',
};

export const AGENT_ROLE: Record<string, string> = {
  price: 'Watches the pool tick',
  risk: 'Tracks impermanent loss',
  strategy: 'Reasons via LLM',
  coordinator: 'Approves or escalates',
  execution: 'Submits on-chain txs',
  bot: 'Telegram escalation',
  macro: 'Reads market context',
};

export const LLM_DRIVEN_EVENT_TYPES = new Set([
  'STRATEGY_RECOMMENDATION',
  'PRICE_PATTERN',
  'VOLATILITY_SPIKE',
  'RISK_ANALYSIS',
  'COORDINATOR_REVIEW',
  'MARKET_CONTEXT',
]);
