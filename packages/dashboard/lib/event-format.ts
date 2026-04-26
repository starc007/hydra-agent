import type { HydraEvent } from './ws';

export function eventLabel(e: HydraEvent): { headline: string; detail: string; tone: 'default' | 'brand' | 'accent' | 'warn' | 'err' } {
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
    case 'TX_SUBMITTED':
      return { headline: 'Tx sent', detail: `${(e.payload.hash as string).slice(0, 12)}…`, tone: 'default' };
    case 'TX_CONFIRMED':
      return { headline: 'Tx confirmed', detail: `block ${e.payload.blockNumber}`, tone: 'accent' };
    case 'TX_FAILED':
      return { headline: 'Tx failed', detail: (e.payload.error as string).slice(0, 140), tone: 'err' };
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
};

export const AGENT_ROLE: Record<string, string> = {
  price: 'Watches the pool tick',
  risk: 'Tracks impermanent loss',
  strategy: 'Reasons via LLM',
  coordinator: 'Approves or escalates',
  execution: 'Submits on-chain txs',
  bot: 'Telegram escalation',
};
