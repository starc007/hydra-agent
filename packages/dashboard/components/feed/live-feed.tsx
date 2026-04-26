'use client';
import { AnimatePresence } from 'motion/react';
import type { HydraEvent } from '../../lib/ws';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { FeedRow } from './feed-row';

export function LiveFeed({ events }: { events: HydraEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Live feed</CardTitle>
        <span className="text-[10px] text-subtle font-mono">{events.length} events</span>
      </CardHeader>
      <CardContent className="px-0 pt-0">
        <ul className="overflow-y-auto max-h-[calc(100vh-200px)]">
          <AnimatePresence initial={false}>
            {events.length === 0 ? (
              <li className="px-5 py-12 text-center text-xs text-subtle">Waiting for events…</li>
            ) : (
              events.map((e) => <FeedRow key={e.id} e={e} />)
            )}
          </AnimatePresence>
        </ul>
      </CardContent>
    </Card>
  );
}
