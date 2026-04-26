'use client';
import { useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { resume, type LookupRow } from '../../lib/api';
import { shortAddr } from '../../lib/format';
import type { Address } from 'viem';

function normalizePrivateKey(input: string): string {
  const t = input.trim();
  if (!t) return '';
  if (t.startsWith('0x') || t.startsWith('0X')) return '0x' + t.slice(2).toLowerCase();
  if (/^[0-9a-fA-F]+$/.test(t)) return '0x' + t.toLowerCase();
  return t;
}

export function WelcomeBack({
  wallet,
  registrations,
  onResumed,
  onStartFresh,
}: {
  wallet: Address;
  registrations: LookupRow[];
  onResumed: (s: { doId: string; sessionToken: string; wallet: string; tokenId: string }) => void;
  onStartFresh: () => void;
}) {
  // Assume single registration (typical case). Future: add a picker.
  const reg = registrations[0]!;
  const [pk, setPk] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResume(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const out = await resume({ wallet, tokenId: reg.tokenId, privateKey: pk as `0x${string}` });
      onResumed({ doId: out.doId, sessionToken: out.sessionToken, wallet, tokenId: reg.tokenId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="bg-hero-gradient">
      <CardContent className="pt-8 pb-6 space-y-5">
        <div className="text-center space-y-1">
          <h2 className="text-xl font-semibold">Welcome back</h2>
          <p className="text-sm text-muted">
            We found a Hydra registration for{' '}
            <span className="font-mono">{shortAddr(wallet)}</span>.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-elevated p-4 space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-muted">Position</div>
          <div className="font-mono text-sm">tokenId {reg.tokenId}</div>
          <div className="text-[11px] text-subtle">
            registered {new Date(reg.registeredAt).toLocaleDateString()}
          </div>
        </div>

        <form onSubmit={handleResume} className="space-y-3">
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted block mb-1.5">
              Re-enter private key to resume
            </label>
            <Input
              type="password"
              placeholder="hex…"
              value={pk}
              onChange={(e) => setPk(normalizePrivateKey(e.target.value))}
              required
            />
            <p className="text-[11px] text-subtle mt-1">
              Used to verify ownership and refresh your session.
            </p>
          </div>
          {error && (
            <div className="rounded-xl border border-err/30 bg-err/5 p-3">
              <p className="text-xs text-err">{error}</p>
            </div>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={!pk || submitting} className="flex-1">
              {submitting ? 'Resuming…' : 'Resume monitoring'}
            </Button>
            <Button type="button" variant="ghost" onClick={onStartFresh}>
              Start fresh
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
