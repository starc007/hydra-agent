'use client';
import { motion } from 'motion/react';
import { Badge } from '../ui/badge';
import type { HydraEvent } from '../../lib/ws';
import { eventLabel, AGENT_LABEL } from '../../lib/event-format';
import { relativeTime } from '../../lib/format';

const SOURCE_DOT: Record<string, string> = {
  price: 'bg-agent-price',
  risk: 'bg-agent-risk',
  strategy: 'bg-agent-strategy',
  coordinator: 'bg-agent-coordinator',
  execution: 'bg-agent-execution',
  bot: 'bg-agent-bot',
};

export function FeedRow({ e }: { e: HydraEvent }) {
  const { headline, detail, tone } = eventLabel(e);

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="flex gap-3 py-3 px-4 rounded-lg hover:bg-surfaceAlt/40 transition border-b border-border last:border-0"
    >
      <div className="pt-1 shrink-0">
        <span className={`inline-block w-2 h-2 rounded-full ${SOURCE_DOT[e.source] ?? 'bg-muted'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 mb-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium truncate">{headline}</span>
            <Badge tone={tone}>{AGENT_LABEL[e.source] ?? e.source}</Badge>
          </div>
          <span className="text-[11px] text-subtle font-mono shrink-0">{relativeTime(e.ts)}</span>
        </div>
        {detail && <div className="text-xs text-muted truncate font-mono">{detail}</div>}
      </div>
    </motion.li>
  );
}
