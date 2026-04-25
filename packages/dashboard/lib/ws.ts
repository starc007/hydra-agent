'use client';
import { useEffect, useState } from 'react';

export type AgentName = 'price' | 'risk' | 'strategy' | 'coordinator' | 'execution' | 'bot';

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

function wsUrl(): string {
  const u = new URL(BACKEND);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/ws';
  return u.toString();
}

export function useEventStream(max = 200): HydraEvent[] {
  const [events, setEvents] = useState<HydraEvent[]>([]);
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      ws = new WebSocket(wsUrl());
      ws.onmessage = (m) => {
        try {
          const e: HydraEvent = JSON.parse(m.data as string);
          setEvents((prev) => [e, ...prev].slice(0, max));
        } catch { /* ignore malformed */ }
      };
      ws.onclose = () => { retry = setTimeout(connect, 2000); };
      ws.onerror = () => { try { ws?.close(); } catch { /* ignore */ } };
    };
    connect();
    return () => {
      ws?.close();
      if (retry) clearTimeout(retry);
    };
  }, [max]);
  return events;
}

export function useSnapshot(): { data: Snapshot | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const fetcher = async () => {
      try {
        const res = await fetch(`${BACKEND}/api/snapshot`);
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
  }, []);
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
};
