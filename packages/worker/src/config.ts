import { z } from 'zod';

export type Env = {
  HYDRA: DurableObjectNamespace;
  DB: D1Database;

  // LLM (host-provided, shared)
  ANTHROPIC_API_KEY?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  LLM_PROVIDER?: string;
  LLM_MODEL?: string;

  // Telegram (shared bot, per-user chat_id stored in DO)
  TELEGRAM_BOT_TOKEN?: string;

  // Chain (per-deployment, supports one chain per worker)
  RPC_URL: string;
  CHAIN_ID: string;
  POSITION_MANAGER: string;
  STATE_VIEW: string;
  UNISWAP_API_BASE: string;
  UNISWAP_API_KEY?: string;
  DASHBOARD_ORIGIN: string;

  // Coordinator + risk knobs (shared default policy across users; can be overridden per-user later)
  IL_THRESHOLD_PCT: string;
  DAILY_TX_CAP: string;
  COOLDOWN_SEC: string;
  MIN_CONFIDENCE: string;
  TICK_INTERVAL_MS: string;
  SLIPPAGE_BPS: string;
};

const Schema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  LLM_PROVIDER: z.enum(['anthropic', 'google', 'openai']).default('anthropic'),
  LLM_MODEL: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  RPC_URL: z.string().url(),
  CHAIN_ID: z.coerce.number(),
  POSITION_MANAGER: z.string().startsWith('0x'),
  STATE_VIEW: z.string().startsWith('0x'),
  UNISWAP_API_BASE: z.string().url(),
  UNISWAP_API_KEY: z.string().optional(),
  DASHBOARD_ORIGIN: z.string(),
  IL_THRESHOLD_PCT: z.coerce.number(),
  DAILY_TX_CAP: z.coerce.number(),
  COOLDOWN_SEC: z.coerce.number(),
  MIN_CONFIDENCE: z.coerce.number(),
  TICK_INTERVAL_MS: z.coerce.number(),
  SLIPPAGE_BPS: z.coerce.number().int().min(0).max(10_000).default(50),
});

export type Config = z.infer<typeof Schema> & {
  positionManager: `0x${string}`;
  stateView: `0x${string}`;
};

export function loadConfig(env: Env): Config {
  const p = Schema.parse(env);
  if (p.LLM_PROVIDER === 'anthropic' && !p.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic');
  }
  if (p.LLM_PROVIDER === 'google' && !p.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is required when LLM_PROVIDER=google');
  }
  if (p.LLM_PROVIDER === 'openai' && !p.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai');
  }
  return {
    ...p,
    positionManager: p.POSITION_MANAGER as `0x${string}`,
    stateView: p.STATE_VIEW as `0x${string}`,
  };
}
