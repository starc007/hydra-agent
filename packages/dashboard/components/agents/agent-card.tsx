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
};

export function AgentCard({ name, last }: { name: AgentName; last?: HydraEvent }) {
  const active = !!last && Date.now() - last.ts < 5000;
  const label = last ? eventLabel(last) : null;

  return (
    <motion.div layout transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
      <Card className="p-3">
        <div className="flex items-center gap-3">
          <span
            className={`relative inline-block w-2 h-2 rounded-full shrink-0 ${AGENT_DOT[name]} ${active ? 'animate-pulse-soft' : 'opacity-40'}`}
          >
            {active && (
              <span
                className={`absolute inset-0 rounded-full ${AGENT_DOT[name]} opacity-40 blur-[3px]`}
              />
            )}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{AGENT_LABEL[name]}</div>
            <div className="text-[11px] text-subtle">{AGENT_ROLE[name]}</div>
          </div>
        </div>
        {last && (
          <div className="mt-2 pt-2 border-t border-border flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted truncate">{label?.headline}</span>
            <span className="text-[10px] text-subtle font-mono shrink-0">{relativeTime(last.ts)}</span>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
