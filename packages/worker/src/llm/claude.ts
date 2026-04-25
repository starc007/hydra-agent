import Anthropic from '@anthropic-ai/sdk';
import { STRATEGY_SYSTEM, RECOMMEND_TOOL, buildUserMessage } from './prompt';

export type StrategyOutput = {
  action: 'HOLD' | 'REBALANCE' | 'HARVEST' | 'EXIT';
  confidence: number;
  rationale: string;
  suggestedRange?: { tickLower: number; tickUpper: number };
};

export class ClaudeClient {
  private client: Anthropic;
  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async recommend(ctx: { events: unknown[]; position: unknown }): Promise<StrategyOutput> {
    const res = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: [{ type: 'text', text: STRATEGY_SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [RECOMMEND_TOOL],
      tool_choice: { type: 'tool', name: 'recommend_action' },
      messages: [{ role: 'user', content: buildUserMessage(ctx) }],
    });
    const block = res.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') throw new Error('no tool_use in Claude response');
    return block.input as StrategyOutput;
  }
}
