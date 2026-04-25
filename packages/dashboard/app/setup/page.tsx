'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { privateKeyToAccount } from 'viem/accounts';
import { register } from '../../lib/api';
import { saveSession } from '../../lib/storage';

export default function SetupPage() {
  const router = useRouter();
  const [privateKey, setPrivateKey] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [stableCurrency, setStableCurrency] = useState('');
  const [wallet, setWallet] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derive wallet from private key
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
      saveSession({
        doId: res.doId,
        sessionToken: res.sessionToken,
        wallet,
        tokenId,
      });
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
        <Field label="Private key" hint="Hot wallet only. Derived address shown below.">
          <input
            type="password"
            placeholder="0x…"
            className="input"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value.trim())}
            required
          />
        </Field>

        <Field label="Wallet address" hint="Derived automatically.">
          <div className="input font-mono text-xs text-muted select-all">{wallet || '—'}</div>
        </Field>

        <Field label="Token ID" hint="Your Uniswap v4 LP NFT id from PositionManager.">
          <input
            type="text"
            inputMode="numeric"
            placeholder="e.g. 7466"
            className="input"
            value={tokenId}
            onChange={(e) => setTokenId(e.target.value.trim())}
            required
          />
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

        <Field label="Stable currency address" hint="Optional. The pool's USD-stable token address (token0 or token1) for fee USD conversion. Leave empty to default to token1.">
          <input
            type="text"
            placeholder="0x…"
            className="input"
            value={stableCurrency}
            onChange={(e) => setStableCurrency(e.target.value.trim())}
          />
        </Field>

        {error && (
          <div className="card p-3 border-err/30 bg-err/5">
            <p className="text-xs text-err">{error}</p>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary flex-1" disabled={!wallet || !tokenId || !privateKey || submitting}>
            {submitting ? 'Registering…' : 'Register & start monitoring'}
          </button>
        </div>
      </form>
    </main>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="label">{label}</span>
        {hint && <span className="text-[10px] text-subtle">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
