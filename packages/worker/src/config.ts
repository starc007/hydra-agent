import { z } from 'zod';

export type Env = {
  HYDRA: DurableObjectNamespace;
  DB: D1Database;

  ANTHROPIC_API_KEY?: string;
  PRIVATE_KEY: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  UNISWAP_API_KEY?: string;
  LLM_PROVIDER?: string;
  LLM_MODEL?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  OPENAI_API_KEY?: string;

  RPC_URL: string;
  CHAIN_ID: string;
  POOL_ID: string;
  POSITION_MANAGER: string;
  TOKEN_ID: string;
  UNISWAP_API_BASE: string;
  DASHBOARD_ORIGIN: string;

  IL_THRESHOLD_PCT: string;
  DAILY_TX_CAP: string;
  COOLDOWN_SEC: string;
  MIN_CONFIDENCE: string;
  TICK_INTERVAL_MS: string;
};

const Schema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  PRIVATE_KEY: z.string().startsWith('0x'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  UNISWAP_API_KEY: z.string().optional(),
  LLM_PROVIDER: z.enum(['anthropic', 'google', 'openai']).default('anthropic'),
  LLM_MODEL: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  RPC_URL: z.string().url(),
  CHAIN_ID: z.coerce.number(),
  POOL_ID: z.string().startsWith('0x'),
  POSITION_MANAGER: z.string().startsWith('0x'),
  TOKEN_ID: z.coerce.bigint(),
  UNISWAP_API_BASE: z.string().url(),
  DASHBOARD_ORIGIN: z.string(),
  IL_THRESHOLD_PCT: z.coerce.number(),
  DAILY_TX_CAP: z.coerce.number(),
  COOLDOWN_SEC: z.coerce.number(),
  MIN_CONFIDENCE: z.coerce.number(),
  TICK_INTERVAL_MS: z.coerce.number(),
});

export type Config = z.infer<typeof Schema> & {
  privateKey: `0x${string}`;
  poolId: `0x${string}`;
  positionManager: `0x${string}`;
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
    privateKey: p.PRIVATE_KEY as `0x${string}`,
    poolId: p.POOL_ID as `0x${string}`,
    positionManager: p.POSITION_MANAGER as `0x${string}`,
  };
}
