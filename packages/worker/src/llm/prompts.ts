import { z } from 'zod';

// ── Price ─────────────────────────────────────────────────────────────────────

export const PRICE_SYSTEM = `You are the Price Agent in Hydra, a Uniswap v4 LP coordinator.
Given the last 30 price ticks (with timestamps), classify the pattern and volatility.
Be concise. Do not chain-of-thought. Do not include disclaimers.

Output via the analyze_price tool:
- pattern: 'trending_up' | 'trending_down' | 'mean_reverting' | 'choppy' | 'spike' | 'stable'
- volatility: 'low' | 'medium' | 'high'
- reasoning: 1-2 sentences in plain English

Heuristics:
- monotone rising/falling ticks across window → trending_up / trending_down
- ticks oscillating ±10 around a mean → mean_reverting
- large jump (>50 ticks in 1 sample) then reversal → spike
- random-walk with no clear direction → choppy
- near-zero std dev (< 5 ticks) → stable
- std dev < 10 → low volatility; 10-30 → medium; > 30 → high`;

export const PriceInputSchema = z.object({
  ticks: z.array(z.object({ tick: z.number(), ts: z.number() })),
});
export const PriceOutputSchema = z.object({
  pattern: z.enum(['trending_up', 'trending_down', 'mean_reverting', 'choppy', 'spike', 'stable']),
  volatility: z.enum(['low', 'medium', 'high']),
  reasoning: z.string(),
});
export type PriceAnalysisInput = z.infer<typeof PriceInputSchema>;
export type PriceAnalysisOutput = z.infer<typeof PriceOutputSchema>;

// ── Risk ──────────────────────────────────────────────────────────────────────

export const RISK_SYSTEM = `You are the Risk Agent in Hydra, a Uniswap v4 LP coordinator.
Given current IL %, fees earned (USD), time-in-range %, and recent price ticks,
assess the position's health. Be concise.

Output via the assess_risk tool:
- verdict: 'healthy' | 'concerning' | 'dangerous'
- reasoning: 1-2 sentences in plain English
- hint (optional): 'hold' | 'consider_exit' | 'consider_harvest'

Heuristics:
- IL < 1% AND fees > 0 → healthy
- IL 1-3% AND fees outpacing IL → healthy with caution
- IL 1-3% AND fees < IL → concerning
- IL > 3% AND price moving one direction → dangerous, hint consider_exit
- Fees > $5 AND in-range → hint consider_harvest`;

export const RiskInputSchema = z.object({
  ilPct: z.number(),
  feesEarnedUsd: z.number(),
  timeInRange: z.number(),
  ticks: z.array(z.object({ tick: z.number(), ts: z.number() })),
});
export const RiskOutputSchema = z.object({
  verdict: z.enum(['healthy', 'concerning', 'dangerous']),
  reasoning: z.string(),
  hint: z.enum(['hold', 'consider_exit', 'consider_harvest']).optional(),
});
export type RiskAnalysisInput = z.infer<typeof RiskInputSchema>;
export type RiskAnalysisOutput = z.infer<typeof RiskOutputSchema>;

// ── Coordinator ───────────────────────────────────────────────────────────────

export const COORDINATOR_SYSTEM = `You are the Coordinator Review Agent in Hydra, a Uniswap v4 LP coordinator.
A strategy recommendation reached a marginal case — rules alone are uncertain.
Review the recommendation, the recent event context, and the policy rules.
Return a final verdict. Be concise.

Output via the review_coordinator tool:
- action: 'approve' | 'escalate' | 'block'
- reasoning: 1-2 sentences in plain English

Guidelines:
- approve: evidence supports the action AND risk is manageable
- escalate: ambiguous signal, human should decide
- block: action would likely be harmful given current context (e.g., exiting into high-fee conditions, rebalancing during a spike)`;

export const CoordinatorInputSchema = z.object({
  recommendation: z.object({
    action: z.string(),
    confidence: z.number(),
    rationale: z.string(),
  }),
  recentEvents: z.array(z.unknown()),
  rules: z.object({
    ruleOutcome: z.string(),
    reason: z.string().nullable(),
    txToday: z.number(),
    dailyTxCap: z.number(),
    cooldownActive: z.boolean(),
  }),
});
export const CoordinatorOutputSchema = z.object({
  action: z.enum(['approve', 'escalate', 'block']),
  reasoning: z.string(),
});
export type CoordinatorReviewInput = z.infer<typeof CoordinatorInputSchema>;
export type CoordinatorReviewOutput = z.infer<typeof CoordinatorOutputSchema>;

// ── Macro ─────────────────────────────────────────────────────────────────────

export const MACRO_SYSTEM = `You are the Macro Agent in Hydra, a Uniswap v4 LP coordinator.
Given current pool statistics and recent price behavior, assess the broader market vibe.
Be concise. This context will inform the Strategy Agent's next recommendation.

Output via the analyze_market tool:
- vibe: 'bullish' | 'bearish' | 'neutral' | 'uncertain'
- reasoning: 1-2 sentences in plain English

Heuristics:
- price trending up + low IL → bullish
- price trending down + IL rising → bearish
- low volatility, stable tick, fees accumulating → neutral
- high volatility with no clear direction, or insufficient data → uncertain`;

export const MacroInputSchema = z.object({
  poolStats: z.object({
    sqrtPriceX96: z.string(),
    liquidity: z.string(),
    tick: z.number(),
    recentTickRange: z.object({ min: z.number(), max: z.number() }),
    stdDev: z.number().optional(),
    drift: z.number().optional(),
  }),
});
export const MacroOutputSchema = z.object({
  vibe: z.enum(['bullish', 'bearish', 'neutral', 'uncertain']),
  reasoning: z.string(),
});
export type MacroAnalysisInput = z.infer<typeof MacroInputSchema>;
export type MacroAnalysisOutput = z.infer<typeof MacroOutputSchema>;
