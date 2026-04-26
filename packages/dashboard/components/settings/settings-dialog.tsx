'use client';
import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { updateSettings } from '../../lib/api';

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateSettings(doId, sessionToken, {
        telegramChatId: tg.trim() === '' ? undefined : tg.trim(),
        stableCurrency: stable.trim() === '' ? undefined : stable.trim(),
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
        className="w-[min(92vw,440px)] rounded-xl border border-borderStrong bg-surface p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Settings</h3>
          <button onClick={onClose} className="text-subtle hover:text-ink">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted block mb-1.5">
              Telegram chat ID
            </label>
            <Input
              value={tg}
              onChange={(e) => setTg(e.target.value)}
              placeholder="746166922 (leave empty to keep existing)"
              inputMode="numeric"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted block mb-1.5">
              Stable currency address
            </label>
            <Input
              value={stable}
              onChange={(e) => setStable(e.target.value)}
              placeholder="0x… (leave empty to keep existing)"
            />
          </div>
          {error && (
            <div className="rounded-xl border border-err/30 bg-err/5 p-3">
              <p className="text-xs text-err">{error}</p>
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
