'use client';
import { motion } from 'motion/react';
import { Card } from '../ui/card';
import type { AgentName, HydraEvent } from '../../lib/ws';
import { AGENT_LABEL, AGENT_ROLE, eventLabel } from '../../lib/event-format';
import { relativeTime } from '../../lib/format';

const AGENT_DOT: Record<string, string> = {
  price: 'bg-agent-price',
  risk: 'bg-agent-risk',
  strategy: 'bg-agent-strategy',
  coordinator: 'bg-agent-coordinator',
  execution: 'bg-agent-execution',
  bot: 'bg-agent-bot',
  macro: 'bg-agent-macro',
};

const VERDICT_TYPE_FOR: Record<string, string> = {
  price: 'PRICE_PATTERN',
  risk: 'RISK_ANALYSIS',
  strategy: 'STRATEGY_RECOMMENDATION',
  coordinator: 'COORDINATOR_REVIEW',
  macro: 'MARKET_CONTEXT',
  // execution: deterministic, no verdict event
};

export function findVerdict(name: AgentName, events: HydraEvent[]): HydraEvent | undefined {
  const t = VERDICT_TYPE_FOR[name];
  if (!t) return undefined;
  return events.find((e) => e.type === t && e.source === name);
}

export function AgentCard({ name, last, verdict }: { name: AgentName; last?: HydraEvent; verdict?: HydraEvent }) {
  const event = verdict ?? last;
  const active = !!event && Date.now() - event.ts < 5000;
  const label = event ? eventLabel(event) : null;
  const labelColor =
    label?.tone === 'err' ? 'text-err' :
    label?.tone === 'warn' ? 'text-warn' :
    label?.tone === 'accent' ? 'text-accent' :
    label?.tone === 'brand' ? 'text-brand' :
    'text-ink';

  return (
    <motion.div layout transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
      <Card className="p-3">
        <div className="flex items-center gap-3">
          <span
            className={`relative inline-block w-2 h-2 rounded-full shrink-0 ${AGENT_DOT[name]} ${active ? 'animate-pulse-soft' : 'opacity-40'}`}
          >
            {active && (
              <span className={`absolute inset-0 rounded-full ${AGENT_DOT[name]} opacity-40 blur-[3px]`} />
            )}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{AGENT_LABEL[name]}</div>
            <div className="text-[11px] text-subtle">{AGENT_ROLE[name]}</div>
          </div>
        </div>
        {event && label && (
          <div className="mt-2 pt-2 border-t border-border">
            <div className={`text-xs font-medium truncate ${labelColor}`}>{label.headline}</div>
            {label.detail && (
              <div className="text-[11px] text-muted line-clamp-2 mt-0.5">{label.detail}</div>
            )}
            <div className="text-[10px] text-subtle font-mono mt-1">{relativeTime(event.ts)}</div>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
