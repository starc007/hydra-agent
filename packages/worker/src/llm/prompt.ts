import { z } from 'zod';

export const STRATEGY_SYSTEM = `You are the Strategy Agent inside Hydra, a multi-agent system that manages a Uniswap v4 LP position.

Inputs you receive:
- Recent PRICE_UPDATE events with tick, sqrtPriceX96, and price
- Recent OUT_OF_RANGE / VOLATILITY_SPIKE events
- Recent IL_THRESHOLD_BREACH / POSITION_HEALTHY / FEE_HARVEST_READY events
- The current position range and fees earned

Your job is to recommend exactly one action: HOLD | REBALANCE | HARVEST | EXIT.
Return JSON via the recommend_action tool with:
- action: one of the four strings
- confidence: 0..1
- rationale: 1-2 sentences in plain English
- suggestedRange: only when action=REBALANCE, with tickLower and tickUpper

Heuristics:
- If position is OUT_OF_RANGE and not volatile -> REBALANCE
- If IL_THRESHOLD_BREACH and trend is one-directional -> EXIT
- If FEE_HARVEST_READY and position is in-range -> HARVEST
- Otherwise -> HOLD with high confidence

Be concise. Do not chain-of-thought. Do not include disclaimers.`;

export function buildUserMessage(ctx: { events: unknown[]; position: unknown }): string {
  return `## Recent events\n${JSON.stringify(ctx.events, null, 2)}\n\n## Position\n${JSON.stringify(ctx.position, null, 2)}`;
}

export const RecommendSchema = z.object({
  action: z.enum(['HOLD', 'REBALANCE', 'HARVEST', 'EXIT']),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  suggestedRange: z.object({
    tickLower: z.number(),
    tickUpper: z.number(),
  }).optional(),
});

export type RecommendOutput = z.infer<typeof RecommendSchema>;
