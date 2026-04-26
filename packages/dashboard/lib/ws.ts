'use client';
import { useEffect, useState } from 'react';

export type AgentName = 'price' | 'risk' | 'strategy' | 'coordinator' | 'execution' | 'bot' | 'macro';
export type HydraEvent = {
  id: string;
  ts: number;
  source: AgentName;
  type: string;
  payload: Record<string, unknown>;
};
export type Snapshot = {
  range: { tickLower: number; tickUpper: number };
  entryPrice?: number;
  activeTokenId?: string;
  latestPool?: {
    tick: number;
    sqrtPriceX96: string;
    fee: number;
    tickSpacing: number;
    token0: { address: string; symbol: string; decimals: number };
    token1: { address: string; symbol: string; decimals: number };
  };
  events: HydraEvent[];
  decisions: DecisionRow[];
};
export type DecisionRow = {
  id: string;
  ts: number;
  action: string;
  reason: string;
  approved: boolean;
  recommendation: { action: string; confidence: number; rationale: string; suggestedRange?: { tickLower: number; tickUpper: number } };
};

const BACKEND = process.env.NEXT_PUBLIC_BACKEND ?? 'http://localhost:8787';

function wsUrl(doId: string): string {
  const u = new URL(BACKEND);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/ws';
  u.searchParams.set('do', doId);
  return u.toString();
}

export function useEventStream(doId: string | null, max = 200): HydraEvent[] {
  const [events, setEvents] = useState<HydraEvent[]>([]);
  useEffect(() => {
    if (!doId) return;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    // Seed from persisted events first so the feed isn't blank on reload.
    void (async () => {
      try {
        const res = await fetch(`${BACKEND}/api/events?do=${doId}`);
        if (!res.ok) return;
        const seed = (await res.json()) as HydraEvent[];
        if (cancelled) return;
        setEvents((prev) => mergeEvents(prev, seed, max));
      } catch { /* ignore */ }
    })();

    const connect = () => {
      ws = new WebSocket(wsUrl(doId));
      ws.onmessage = (m) => {
        try {
          const e: HydraEvent = JSON.parse(m.data as string);
          setEvents((prev) => mergeEvents([e], prev, max));
        } catch { /* ignore */ }
      };
      ws.onclose = () => { retry = setTimeout(connect, 2000); };
      ws.onerror = () => { try { ws?.close(); } catch { /* ignore */ } };
    };
    connect();
    return () => { cancelled = true; ws?.close(); if (retry) clearTimeout(retry); };
  }, [doId, max]);
  return events;
}

/** Merge two event lists, dedupe by id, keep newest first, cap to max. */
function mergeEvents(a: HydraEvent[], b: HydraEvent[], max: number): HydraEvent[] {
  const seen = new Set<string>();
  const out: HydraEvent[] = [];
  for (const e of [...a, ...b]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  out.sort((x, y) => y.ts - x.ts);
  return out.slice(0, max);
}

export function useSnapshot(doId: string | null): { data: Snapshot | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!doId) { setLoading(false); return; }
    let alive = true;
    const fetcher = async () => {
      try {
        const res = await fetch(`${BACKEND}/api/snapshot?do=${doId}`);
        if (!res.ok) throw new Error(`snapshot ${res.status}`);
        const j = (await res.json()) as Snapshot;
        if (alive) setData(j);
      } catch (e) {
        if (alive) setError(String(e));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void fetcher();
    const id = setInterval(fetcher, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [doId]);
  return { data, loading, error };
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 1000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

export const AGENT_COLORS: Record<AgentName, string> = {
  price: 'bg-agent-price',
  risk: 'bg-agent-risk',
  strategy: 'bg-agent-strategy',
  coordinator: 'bg-agent-coordinator',
  execution: 'bg-agent-execution',
  bot: 'bg-agent-bot',
  macro: 'bg-agent-macro',
};
