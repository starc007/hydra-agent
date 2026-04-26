'use client';
import type { Snapshot } from '../../lib/ws';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';

export function DecisionLog({ snapshot }: { snapshot: Snapshot | null }) {
  const decisions = snapshot?.decisions ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Decisions</CardTitle>
        <span className="text-[10px] text-subtle font-mono">{decisions.length}</span>
      </CardHeader>
      <CardContent className="pt-0">
        {decisions.length === 0 && (
          <p className="text-xs text-subtle py-6 text-center">No decisions yet.</p>
        )}
        <ul className="space-y-3 max-h-72 overflow-y-auto">
          {decisions.map((d) => (
            <li key={d.id} className="space-y-1.5 pb-3 border-b border-border last:border-0 last:pb-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge tone={d.approved ? 'accent' : 'warn'}>
                  {d.approved ? 'approved' : 'escalated'}
                </Badge>
                <span className="font-mono text-xs text-ink">{d.action}</span>
                <span className="text-[10px] text-subtle font-mono ml-auto">
                  {new Date(d.ts).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-xs text-muted leading-relaxed">
                {d.recommendation.rationale || d.reason}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
