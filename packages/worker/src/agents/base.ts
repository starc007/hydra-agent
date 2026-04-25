import type { Bus } from '../bus';
import { newEvent } from '../ids';
import type { AgentName, HydraEvent } from '../events';

export abstract class BaseAgent {
  abstract name: AgentName;
  protected stopped = false;

  constructor(protected bus: Bus) {}

  protected emit<T extends HydraEvent>(e: Omit<T, 'id' | 'ts'>): void {
    this.bus.emit(newEvent<T>(e));
  }

  start(): void {}
  stop(): void { this.stopped = true; }
}
