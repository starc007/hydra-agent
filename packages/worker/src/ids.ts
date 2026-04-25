import type { HydraEvent } from './events';

export function newId(): string {
  return crypto.randomUUID();
}

export function newEvent<T extends HydraEvent>(e: Omit<T, 'id' | 'ts'>): T {
  return { ...e, id: newId(), ts: Date.now() } as T;
}
