'use client';
import { useEffect, useState } from 'react';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address } from 'viem';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { register, previewPosition, type PreviewPosition } from '../../lib/api';
import { shortAddr } from '../../lib/format';
import { PreviewCard, StableCurrencySelect } from './preview-card';
import type { Session } from '../../lib/storage';

function normalizeKey(input: string): string {
  const t = input.trim();
  if (!t) return '';
  if (t.startsWith('0x') || t.startsWith('0X')) return '0x' + t.slice(2).toLowerCase();
  if (/^[0-9a-fA-F]+$/.test(t)) return '0x' + t.toLowerCase();
  return t;
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1.5 gap-3">
        <span className="label">{label}</span>
        {hint && <span className="text-[10px] text-subtle">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function RegisterForm({
  wallet: connectedWallet,
  onRegistered,
}: {
  wallet: Address | null;
  onRegistered: (s: Session) => void;
}) {
  const [privateKey, setPrivateKey] = useState('');
  const [ownerFromPk, setOwnerFromPk] = useState<string | null>(null);
  const [tokenId, setTokenId] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [stableCurrency, setStableCurrency] = useState('');
  const [preview, setPreview] = useState<PreviewPosition | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derive owner wallet from PK whenever it changes.
  useEffect(() => {
    if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
      setOwnerFromPk(null);
      return;
    }
    try {
      setOwnerFromPk(privateKeyToAccount(privateKey as `0x${string}`).address.toLowerCase());
    } catch {
      setOwnerFromPk(null);
    }
  }, [privateKey]);

  // Preview uses the PK-derived owner (ownership validated against it).
  // Falls back to connected wallet only when no PK supplied (should not happen in practice).
  const previewWallet = ownerFromPk ?? connectedWallet ?? '';

  // Debounced preview — fires when owner or tokenId changes.
  useEffect(() => {
    if (!previewWallet || !tokenId) { setPreview(null); setPreviewError(null); return; }
    setPreviewLoading(true);
    setPreviewError(null);
    const h = setTimeout(async () => {
      try { setPreview(await previewPosition(previewWallet, tokenId)); setPreviewError(null); }
      catch (e) { setPreview(null); setPreviewError(e instanceof Error ? e.message : String(e)); }
      finally { setPreviewLoading(false); }
    }, 400);
    return () => clearTimeout(h);
  }, [previewWallet, tokenId]);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!connectedWallet || !privateKey) return;  // connected wallet is required
    setError(null);
    setSubmitting(true);
    try {
      const res = await register({
        wallet: connectedWallet,    // canonical signer identity, never the PK-derived owner
        tokenId,
        privateKey: privateKey as `0x${string}`,
        telegramChatId: telegramChatId || undefined,
        stableCurrency: stableCurrency || undefined,
      });
      onRegistered({ doId: res.doId, sessionToken: res.sessionToken, wallet: connectedWallet, tokenId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const hasWallet = !!connectedWallet;  // must be connected — PK-derived fallback removed
  const previewIsEmpty = !!preview && preview.liquidity === '0';
  const canSubmit = hasWallet && !!tokenId && !!privateKey && !!preview && !previewIsEmpty && !submitting;

  return (
    <div className="space-y-4 max-w-[600px] mx-auto">
      {/* Testnet warning */}
      <div className="rounded-xl border border-warn/30 bg-warn/5 p-4 flex gap-3">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-warn/20 text-warn border border-warn/30 text-[11px] font-medium shrink-0">
          testnet only
        </span>
        <p className="text-xs text-muted leading-relaxed">
          This is a <strong className="text-warn">custodial hot-wallet</strong> setup. Your private
          key is sent to the worker and stored in Cloudflare Durable Object storage so the agents
          can sign rebalances on your behalf.{' '}
          <strong>Use only on Unichain Sepolia testnet wallets — never mainnet.</strong>
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Register position</CardTitle></CardHeader>
        <CardContent className="pt-0">
          {connectedWallet && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-elevated px-3 py-2">
              <span className="label">Connected wallet</span>
              <span className="font-mono text-xs text-ink ml-auto">{shortAddr(connectedWallet)}</span>
            </div>
          )}
          <form onSubmit={onSubmit} className="space-y-5">
            <Field label="Private key (owner of LP NFT)" hint="Hot wallet only. 0x prefix added automatically.">
              <Input
                type="password"
                placeholder="hex…"
                value={privateKey}
                onChange={(e) => setPrivateKey(normalizeKey(e.target.value))}
                required
              />
            </Field>

            {/* Show owner hint if derived owner differs from connected wallet */}
            {ownerFromPk && (
              <div className="rounded-md border border-border bg-elevated px-3 py-2 text-[11px] text-muted">
                Owner wallet (from PK):{' '}
                <span className="font-mono text-ink">{shortAddr(ownerFromPk)}</span>
                {connectedWallet && ownerFromPk !== connectedWallet.toLowerCase() && (
                  <span className="block mt-0.5">
                    You are signed in as{' '}
                    <span className="font-mono">{shortAddr(connectedWallet)}</span> — Hydra will sign
                    rebalances as the owner wallet. This is fine when using a separate hot wallet for
                    custodial signing.
                  </span>
                )}
              </div>
            )}

            {!connectedWallet && !ownerFromPk && (
              <Field label="Wallet address" hint="Derived automatically from private key.">
                <div className="flex h-10 w-full items-center rounded-md border border-border bg-elevated px-3 font-mono text-xs text-muted select-all">
                  —
                </div>
              </Field>
            )}

            <Field
              label="Token ID"
              hint={
                <a
                  href="https://app.uniswap.org/positions/v4?chain=unichain_sepolia"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand underline-offset-2 hover:underline"
                >
                  Where do I find this? ↗
                </a>
              }
            >
              <Input
                type="text"
                inputMode="numeric"
                placeholder="e.g. 7470"
                value={tokenId}
                onChange={(e) => setTokenId(e.target.value.trim())}
                required
              />
            </Field>

            {previewLoading && (
              <div className="rounded-xl border border-border bg-elevated p-3 text-xs text-subtle">
                Validating position…
              </div>
            )}
            {previewError && (
              <div className="rounded-xl border border-err/30 bg-err/5 p-3">
                <p className="text-xs text-err">{previewError}</p>
              </div>
            )}
            {preview && !previewLoading && <PreviewCard preview={preview} />}
            {previewIsEmpty && (
              <div className="rounded-xl border border-warn/30 bg-warn/5 p-3">
                <p className="text-xs text-warn">
                  This position has zero liquidity — it was probably drained by a previous rebalance.
                  Pick a different tokenId. (Your latest active position is the one Hydra last minted.)
                </p>
              </div>
            )}

            <Field label="Stable currency" hint="Used to convert fees into USD.">
              <StableCurrencySelect preview={preview} value={stableCurrency} onChange={setStableCurrency} />
            </Field>

            <Field label="Telegram chat ID" hint="Optional. For escalation messages. Find via @userinfobot.">
              <Input
                type="text"
                inputMode="numeric"
                placeholder="e.g. 746166912"
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value.trim())}
              />
            </Field>

            {error && (
              <div className="rounded-xl border border-err/30 bg-err/5 p-3">
                <p className="text-xs text-err">{error}</p>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={!canSubmit}>
              {submitting ? 'Registering…' : 'Register & start monitoring'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
