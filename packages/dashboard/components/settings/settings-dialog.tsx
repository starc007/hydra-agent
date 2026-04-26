'use client';
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { privateKeyToAccount } from 'viem/accounts';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { updateSettings, previewPosition, type PreviewPosition } from '../../lib/api';
import { shortAddr } from '../../lib/format';
import { PreviewCard } from '../onboarding/preview-card';

function normalizeKey(input: string): string {
  const t = input.trim();
  if (!t) return '';
  if (t.startsWith('0x') || t.startsWith('0X')) return '0x' + t.slice(2).toLowerCase();
  if (/^[0-9a-fA-F]+$/.test(t)) return '0x' + t.toLowerCase();
  return t;
}

export function SettingsDialog({
  doId,
  sessionToken,
  initial,
  onClose,
  onSaved,
}: {
  doId: string;
  sessionToken: string;
  initial: { telegramChatId?: string; stableCurrency?: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tg, setTg] = useState(initial.telegramChatId ?? '');
  const [stable, setStable] = useState(initial.stableCurrency ?? '');
  const [pk, setPk] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [preview, setPreview] = useState<PreviewPosition | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derive owner address from the new PK (if supplied).
  const newOwner = useMemo<string | null>(() => {
    if (!pk || !pk.startsWith('0x') || pk.length !== 66) return null;
    try { return privateKeyToAccount(pk as `0x${string}`).address.toLowerCase(); }
    catch { return null; }
  }, [pk]);

  const pkOrTokenChanged = pk.length > 0 || tokenId.length > 0;

  // Re-validate position when tokenId or PK changes.
  useEffect(() => {
    if (!tokenId) { setPreview(null); setPreviewError(null); return; }
    if (!newOwner) {
      setPreview(null);
      setPreviewError('Paste the new private key to validate this token ID.');
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    const handle = setTimeout(async () => {
      try {
        setPreview(await previewPosition(newOwner, tokenId));
        setPreviewError(null);
      } catch (err) {
        setPreview(null);
        setPreviewError(err instanceof Error ? err.message : String(err));
      } finally {
        setPreviewLoading(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [tokenId, newOwner]);

  // If only PK changes (no new tokenId), clear any stale preview state.
  useEffect(() => {
    if (pk && !tokenId) { setPreview(null); setPreviewError(null); }
  }, [pk, tokenId]);

  const previewIsEmpty = !!preview && preview.liquidity === '0';

  // Save is disabled when tokenId is being changed but preview hasn't succeeded yet.
  const tokenIdPending = tokenId.length > 0 && (!preview || previewIsEmpty || previewLoading);
  const canSave = !saving && !tokenIdPending;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateSettings(doId, sessionToken, {
        telegramChatId: tg.trim() === '' ? undefined : tg.trim(),
        stableCurrency: stable.trim() === '' ? undefined : stable.trim(),
        tokenId: tokenId.trim() || undefined,
        privateKey: pk ? (pk as `0x${string}`) : undefined,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-bg/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[min(92vw,480px)] rounded-xl border border-borderStrong bg-surface p-5 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Settings</h3>
          <button onClick={onClose} className="text-subtle hover:text-ink">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={save} className="space-y-5">

          {/* ── Notifications ── */}
          <div className="space-y-3">
            <p className="text-[11px] uppercase tracking-wider text-muted">Notifications</p>
            <div>
              <label className="text-[11px] text-muted block mb-1.5">Telegram chat ID</label>
              <Input
                value={tg}
                onChange={(e) => setTg(e.target.value)}
                placeholder="746166922 (leave empty to keep existing)"
                inputMode="numeric"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted block mb-1.5">Stable currency address</label>
              <Input
                value={stable}
                onChange={(e) => setStable(e.target.value)}
                placeholder="0x… (leave empty to keep existing)"
              />
            </div>
          </div>

          {/* ── Position ── */}
          <div className="space-y-3">
            <p className="text-[11px] uppercase tracking-wider text-muted">Position (optional — leave blank to keep current)</p>
            <div>
              <label className="text-[11px] text-muted block mb-1.5">New token ID</label>
              <Input
                value={tokenId}
                onChange={(e) => setTokenId(e.target.value.trim())}
                placeholder="e.g. 7470"
                inputMode="numeric"
              />
            </div>

            {previewLoading && tokenId && (
              <div className="rounded-xl border border-border bg-elevated p-3 text-xs text-subtle">
                Validating position…
              </div>
            )}
            {previewError && tokenId && (
              <div className="rounded-xl border border-err/30 bg-err/5 p-3">
                <p className="text-xs text-err">{previewError}</p>
              </div>
            )}
            {preview && !previewLoading && <PreviewCard preview={preview} />}
            {previewIsEmpty && (
              <div className="rounded-xl border border-warn/30 bg-warn/5 p-3">
                <p className="text-xs text-warn">
                  This position has zero liquidity. Pick an active tokenId.
                </p>
              </div>
            )}
          </div>

          {/* ── Private key rotation ── */}
          <div className="space-y-3">
            <p className="text-[11px] uppercase tracking-wider text-muted">Private key (optional — paste to rotate)</p>
            <div>
              <label className="text-[11px] text-muted block mb-1.5">New private key</label>
              <Input
                type="password"
                value={pk}
                onChange={(e) => setPk(normalizeKey(e.target.value))}
                placeholder="0x… (leave blank to keep existing)"
              />
            </div>
            {newOwner && (
              <div className="rounded-md border border-border bg-elevated px-3 py-2 text-[11px] text-muted">
                Owner wallet (from new PK):{' '}
                <span className="font-mono text-ink">{shortAddr(newOwner)}</span>
              </div>
            )}
          </div>

          {pkOrTokenChanged && (
            <div className="rounded-md border border-warn/20 bg-warn/5 px-3 py-2 text-[11px] text-muted">
              Changing position or key will reset the entry price. The agent will reboot automatically.
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-err/30 bg-err/5 p-3">
              <p className="text-xs text-err">{error}</p>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!canSave}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
