import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { Config } from '../config';
import { STRATEGY_SYSTEM, buildUserMessage, RecommendSchema, type RecommendOutput } from './prompt';

export type StrategyOutput = RecommendOutput;

const DEFAULTS = {
  anthropic: 'claude-sonnet-4-6',
  google: 'gemini-3.1-pro-preview',
  openai: 'gpt-4o',
} as const;

export class LLMClient {
  constructor(private cfg: Config) {}

  async recommend(ctx: { events: unknown[]; position: unknown }): Promise<StrategyOutput> {
    const provider = this.cfg.LLM_PROVIDER;
    const modelId = this.cfg.LLM_MODEL ?? DEFAULTS[provider];
    const model = this.pickModel(provider, modelId);

    // For Anthropic, attach ephemeral cache control to the system message.
    // For other providers, system is a plain string (providerOptions is ignored silently).
    const systemMsg =
      provider === 'anthropic'
        ? {
            role: 'system' as const,
            content: STRATEGY_SYSTEM,
            providerOptions: {
              anthropic: { cacheControl: { type: 'ephemeral' as const } },
            },
          }
        : STRATEGY_SYSTEM;

    const { object } = await generateObject({
      model,
      schema: RecommendSchema,
      system: systemMsg,
      prompt: buildUserMessage(ctx),
    });

    return object;
  }

  private pickModel(provider: 'anthropic' | 'google' | 'openai', modelId: string) {
    if (provider === 'anthropic') {
      const anthropic = createAnthropic({ apiKey: this.cfg.ANTHROPIC_API_KEY! });
      return anthropic(modelId);
    }
    if (provider === 'google') {
      const google = createGoogleGenerativeAI({ apiKey: this.cfg.GOOGLE_GENERATIVE_AI_API_KEY! });
      return google(modelId);
    }
    const openai = createOpenAI({ apiKey: this.cfg.OPENAI_API_KEY! });
    return openai(modelId);
  }
}
