'use client';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { forceAction, simulateEscalate } from '../../lib/api';
import type { Session } from '../../lib/storage';

type Action = 'REBALANCE' | 'HARVEST' | 'EXIT';

const ACTION_LABELS: Record<Action, string> = {
  REBALANCE: 'Force rebalance',
  HARVEST: 'Force harvest',
  EXIT: 'Force exit',
};

export function ActionsPanel({ session }: { session: Session }) {
  const [pending, setPending] = useState<Action | null>(null);
  const [result, setResult] = useState<{ msg: string; ok: boolean } | null>(null);
  const [escalating, setEscalating] = useState(false);
  const [escalateResult, setEscalateResult] = useState<{ msg: string; ok: boolean } | null>(null);

  async function trigger(action: Action) {
    if (!confirm(`Trigger ${action} now? This will submit an on-chain transaction.`)) return;
    setPending(action);
    setResult(null);
    try {
      await forceAction(session.doId, session.sessionToken, action);
      setResult({ msg: `${action} submitted`, ok: true });
    } catch (e) {
      setResult({ msg: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setPending(null);
    }
  }

  async function triggerEscalation() {
    setEscalating(true);
    setEscalateResult(null);
    try {
      await simulateEscalate(session.doId, session.sessionToken);
      setEscalateResult({ msg: 'Escalation sent to Telegram', ok: true });
    } catch (e) {
      setEscalateResult({ msg: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setEscalating(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Force actions</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          {(['REBALANCE', 'HARVEST', 'EXIT'] as Action[]).map((a) => (
            <Button
              key={a}
              variant={a === 'EXIT' ? 'outline' : 'secondary'}
              size="sm"
              className="w-full justify-start"
              disabled={!!pending}
              onClick={() => trigger(a)}
            >
              {pending === a ? `${a}…` : ACTION_LABELS[a]}
            </Button>
          ))}
          {result && (
            <p className={`text-xs pt-1 ${result.ok ? 'text-accent' : 'text-err'}`}>{result.msg}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Demo</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <p className="text-xs text-muted leading-relaxed">
            Send a test escalation to your Telegram — see the ✅ / ❌ approval flow without triggering a real transaction.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="w-full justify-start"
            disabled={escalating}
            onClick={triggerEscalation}
          >
            {escalating ? 'Sending…' : '⚠️ Trigger Telegram escalation'}
          </Button>
          {escalateResult && (
            <p className={`text-xs ${escalateResult.ok ? 'text-accent' : 'text-err'}`}>
              {escalateResult.msg}
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
