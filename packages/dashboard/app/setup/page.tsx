'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { privateKeyToAccount } from 'viem/accounts';
import { register, previewPosition, type PreviewPosition } from '../../lib/api';
import { saveSession } from '../../lib/storage';

function normalizePrivateKey(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
    return '0x' + trimmed.slice(2).toLowerCase();
  }
  if (/^[0-9a-fA-F]+$/.test(trimmed)) return '0x' + trimmed.toLowerCase();
  return trimmed;
}

function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function SetupPage() {
  const router = useRouter();
  const [privateKey, setPrivateKey] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [stableCurrency, setStableCurrency] = useState('');
  const [wallet, setWallet] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewPosition | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Derive wallet from PK
  useEffect(() => {
    if (!privateKey || !privateKey.startsWith('0x') || privateKey.length !== 66) {
      setWallet('');
      return;
    }
    try {
      const acc = privateKeyToAccount(privateKey as `0x${string}`);
      setWallet(acc.address);
    } catch {
      setWallet('');
    }
  }, [privateKey]);

  // Debounced preview when wallet + tokenId are both set
  useEffect(() => {
    if (!wallet || !tokenId) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    const handle = setTimeout(async () => {
      try {
        const p = await previewPosition(wallet, tokenId);
        setPreview(p);
        setPreviewError(null);
      } catch (err) {
        setPreview(null);
        setPreviewError(err instanceof Error ? err.message : String(err));
      } finally {
        setPreviewLoading(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [wallet, tokenId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await register({
        wallet,
        tokenId,
        privateKey: privateKey as `0x${string}`,
        telegramChatId: telegramChatId || undefined,
        stableCurrency: stableCurrency || undefined,
      });
      saveSession({ doId: res.doId, sessionToken: res.sessionToken, wallet, tokenId });
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen px-6 py-8 max-w-[640px] mx-auto">
      <header className="card p-6 mb-6 bg-hero-gradient">
        <div className="flex items-center gap-3 mb-2">
          <span className="w-8 h-8 rounded-xl bg-brand-gradient grid place-items-center font-bold text-bg shadow-glow">H</span>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Hydra setup</h1>
        </div>
        <p className="text-sm text-muted ml-11">
          Register a Uniswap v4 LP NFT on Unichain Sepolia and let the agent swarm monitor it.
        </p>
      </header>

      <div className="card p-4 mb-6 border-warn/30 bg-warn/5">
        <div className="flex gap-3">
          <span className="pill bg-warn/20 text-warn border-warn/30">⚠ testnet only</span>
          <p className="text-xs text-muted leading-relaxed">
            This is a <strong className="text-warn">custodial hot-wallet</strong> setup. Your private key is sent to
            the worker and stored in Cloudflare Durable Object storage so the agents can sign rebalances on your
            behalf. <strong>Use only on Unichain Sepolia testnet wallets — never mainnet.</strong>
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="card p-6 space-y-5">
        <Field label="Private key" hint="Hot wallet only. 0x prefix added automatically.">
          <input
            type="password"
            placeholder="hex…"
            className="input"
            value={privateKey}
            onChange={(e) => setPrivateKey(normalizePrivateKey(e.target.value))}
            required
          />
        </Field>

        <Field label="Wallet address" hint="Derived automatically.">
          <div className="input font-mono text-xs text-muted select-all">{wallet || '—'}</div>
        </Field>

        <Field
          label="Token ID"
          hint={
            <>
              <a
                href="https://app.uniswap.org/positions/v4?chain=unichain_sepolia"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand underline-offset-2 hover:underline"
              >
                Where do I find this? ↗
              </a>
            </>
          }
        >
          <input
            type="text"
            inputMode="numeric"
            placeholder="e.g. 7470"
            className="input"
            value={tokenId}
            onChange={(e) => setTokenId(e.target.value.trim())}
            required
          />
        </Field>

        {/* Preview card */}
        {previewLoading && (
          <div className="card-elevated p-3 text-xs text-subtle">Validating position…</div>
        )}
        {previewError && (
          <div className="card p-3 border-err/30 bg-err/5">
            <p className="text-xs text-err">{previewError}</p>
          </div>
        )}
        {preview && !previewLoading && !previewError && (
          <div className="card-elevated p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="pill bg-accent/15 text-accent border-accent/20">✓ position validated</span>
                <span className="font-mono text-xs text-ink">
                  {preview.token0.symbol} / {preview.token1.symbol}
                </span>
              </div>
              <span className="text-[11px] text-subtle font-mono">fee {preview.poolKey.fee / 10_000}%</span>
            </div>
            <div className="text-xs text-muted font-mono">
              range {preview.tickLower} … {preview.tickUpper}
            </div>
          </div>
        )}

        <Field
          label="Stable currency"
          hint="Used to convert fees into USD. Pick whichever side of the pool is the USD-pegged token."
        >
          {preview ? (
            <select
              className="input"
              value={stableCurrency}
              onChange={(e) => setStableCurrency(e.target.value)}
            >
              <option value="">Auto — treat token1 ({preview.token1.symbol}) as stable</option>
              <option value={preview.token0.address}>
                {preview.token0.symbol} ({shortAddress(preview.token0.address)})
              </option>
              <option value={preview.token1.address}>
                {preview.token1.symbol} ({shortAddress(preview.token1.address)})
              </option>
            </select>
          ) : (
            <div className="input text-xs text-subtle">Enter a valid token id to choose.</div>
          )}
        </Field>

        <Field label="Telegram chat ID" hint="Optional. For escalation messages. Find via @userinfobot.">
          <input
            type="text"
            inputMode="numeric"
            placeholder="e.g. 746166922"
            className="input"
            value={telegramChatId}
            onChange={(e) => setTelegramChatId(e.target.value.trim())}
          />
        </Field>

        {error && (
          <div className="card p-3 border-err/30 bg-err/5">
            <p className="text-xs text-err">{error}</p>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="btn-primary flex-1"
            disabled={!wallet || !tokenId || !privateKey || !preview || submitting}
          >
            {submitting ? 'Registering…' : 'Register & start monitoring'}
          </button>
        </div>
      </form>
    </main>
  );
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
