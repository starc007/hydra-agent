import { BaseAgent } from './base';
import type { Bus } from '../bus';
import type { AgentName, StrategyAction } from '../events';

export type ExecutionDeps = {
  submit: (action: StrategyAction) => Promise<{ hash: `0x${string}` }>;
  wait: (hash: `0x${string}`) => Promise<{ gasUsed: string; blockNumber: number }>;
};

export class ExecutionAgent extends BaseAgent {
  name: AgentName = 'execution';
  private off?: () => void;

  constructor(bus: Bus, private deps: ExecutionDeps) { super(bus); }

  override start(): void {
    this.off = this.bus.on('APPROVED', async (e) => {
      const { action } = e.payload;
      try {
        const { hash } = await this.deps.submit(action);
        this.emit({
          source: 'execution',
          type: 'TX_SUBMITTED',
          payload: { hash, action },
        });
        const r = await this.deps.wait(hash);
        this.emit({
          source: 'execution',
          type: 'TX_CONFIRMED',
          payload: { hash, gasUsed: r.gasUsed, blockNumber: r.blockNumber },
        });
      } catch (err) {
        this.emit({
          source: 'execution',
          type: 'TX_FAILED',
          payload: { error: String(err) },
        });
      }
    });
  }

  override stop(): void {
    super.stop();
    this.off?.();
  }
}
