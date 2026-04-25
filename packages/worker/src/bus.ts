import type { HydraEvent, HydraEventType } from './events';

type Listener<T extends HydraEvent> = (e: T) => void | Promise<void>;
type AnyListener = (e: HydraEvent) => void | Promise<void>;

export class Bus {
  private byType = new Map<HydraEventType, Set<Listener<HydraEvent>>>();
  private any = new Set<AnyListener>();

  on<T extends HydraEventType>(type: T, fn: Listener<Extract<HydraEvent, { type: T }>>): () => void {
    let s = this.byType.get(type);
    if (!s) { s = new Set(); this.byType.set(type, s); }
    s.add(fn as Listener<HydraEvent>);
    return () => { s!.delete(fn as Listener<HydraEvent>); };
  }

  onAny(fn: AnyListener): () => void {
    this.any.add(fn);
    return () => { this.any.delete(fn); };
  }

  emit(e: HydraEvent): void {
    const set = this.byType.get(e.type);
    if (set) for (const l of set) {
      try { void l(e); } catch (err) { console.error(`[bus] ${e.type} listener threw:`, err); }
    }
    for (const l of this.any) {
      try { void l(e); } catch (err) { console.error('[bus] any-listener threw:', err); }
    }
  }
}
