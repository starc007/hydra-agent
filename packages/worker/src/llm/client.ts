import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { Config } from '../config';
import { STRATEGY_SYSTEM, buildUserMessage, RecommendSchema, type RecommendOutput } from './prompt';
import {
  PRICE_SYSTEM, PriceOutputSchema,
  RISK_SYSTEM, RiskOutputSchema,
  COORDINATOR_SYSTEM, CoordinatorOutputSchema,
  MACRO_SYSTEM, MacroOutputSchema,
} from './prompts';
import type {
  PriceAnalysisInput, PriceAnalysisOutput,
  RiskAnalysisInput, RiskAnalysisOutput,
  CoordinatorReviewInput, CoordinatorReviewOutput,
  MacroAnalysisInput, MacroAnalysisOutput,
} from './prompts';

export type StrategyOutput = RecommendOutput;

const DEFAULTS = {
  anthropic: 'claude-sonnet-4-6',
  google: 'gemini-3.1-pro-preview',
  openai: 'gpt-4o',
} as const;

export class LLMClient {
  constructor(private cfg: Config) {}

  async recommend(ctx: { events: unknown[]; position: unknown }): Promise<StrategyOutput> {
    const { model, systemMsg } = this.buildCall(STRATEGY_SYSTEM);
    const { object } = await generateObject({
      model,
      schema: RecommendSchema,
      system: systemMsg,
      prompt: buildUserMessage(ctx),
    });
    return object;
  }

  async analyzePrice(input: PriceAnalysisInput): Promise<PriceAnalysisOutput> {
    const { model, systemMsg } = this.buildCall(PRICE_SYSTEM);
    const { object } = await generateObject({
      model,
      schema: PriceOutputSchema,
      system: systemMsg,
      prompt: `## Ticks\n${JSON.stringify(input.ticks)}`,
    });
    return object;
  }

  async analyzeRisk(input: RiskAnalysisInput): Promise<RiskAnalysisOutput> {
    const { model, systemMsg } = this.buildCall(RISK_SYSTEM);
    const { object } = await generateObject({
      model,
      schema: RiskOutputSchema,
      system: systemMsg,
      prompt: `ilPct=${input.ilPct.toFixed(4)} feesEarnedUsd=${input.feesEarnedUsd.toFixed(4)} timeInRange=${input.timeInRange.toFixed(2)}\n## Recent ticks\n${JSON.stringify(input.ticks)}`,
    });
    return object;
  }

  async reviewCoordinator(input: CoordinatorReviewInput): Promise<CoordinatorReviewOutput> {
    const { model, systemMsg } = this.buildCall(COORDINATOR_SYSTEM);
    const { object } = await generateObject({
      model,
      schema: CoordinatorOutputSchema,
      system: systemMsg,
      prompt: `## Recommendation\n${JSON.stringify(input.recommendation)}\n\n## Rules outcome\n${JSON.stringify(input.rules)}\n\n## Recent events\n${JSON.stringify(input.recentEvents.slice(-10))}`,
    });
    return object;
  }

  async analyzeMarket(input: MacroAnalysisInput): Promise<MacroAnalysisOutput> {
    const { model, systemMsg } = this.buildCall(MACRO_SYSTEM);
    const { object } = await generateObject({
      model,
      schema: MacroOutputSchema,
      system: systemMsg,
      prompt: `## Pool stats\n${JSON.stringify(input.poolStats)}`,
    });
    return object;
  }

  private buildCall(systemText: string) {
    const provider = this.cfg.LLM_PROVIDER;
    const modelId = this.cfg.LLM_MODEL ?? DEFAULTS[provider];
    const model = this.pickModel(provider, modelId);
    const systemMsg =
      provider === 'anthropic'
        ? {
            role: 'system' as const,
            content: systemText,
            providerOptions: {
              anthropic: { cacheControl: { type: 'ephemeral' as const } },
            },
          }
        : systemText;
    return { model, systemMsg };
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
