import type { PreviewPosition } from '../../lib/api';
import { Badge } from '../ui/badge';
import { shortAddr } from '../../lib/format';

export function PreviewCard({ preview }: { preview: PreviewPosition }) {
  return (
    <div className="rounded-xl border border-border bg-elevated p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge tone="accent">✓ position validated</Badge>
          <span className="font-mono text-xs text-ink">
            {preview.token0.symbol} / {preview.token1.symbol}
          </span>
        </div>
        <span className="text-[11px] text-subtle font-mono">
          fee {preview.poolKey.fee / 10_000}%
        </span>
      </div>
      <div className="text-xs text-muted font-mono">
        range {preview.tickLower} … {preview.tickUpper}
      </div>
    </div>
  );
}

export function StableCurrencySelect({
  preview,
  value,
  onChange,
}: {
  preview: PreviewPosition | null;
  value: string;
  onChange: (v: string) => void;
}) {
  if (!preview) {
    return (
      <div className="flex h-10 w-full items-center rounded-md border border-border bg-elevated px-3 text-xs text-subtle">
        Enter a valid token ID to choose.
      </div>
    );
  }
  return (
    <select
      className="flex h-10 w-full rounded-md border border-border bg-elevated px-3 py-2 text-sm text-ink focus:outline-none focus:border-brand-ring transition"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Auto — treat token1 ({preview.token1.symbol}) as stable</option>
      <option value={preview.token0.address}>
        {preview.token0.symbol} ({shortAddr(preview.token0.address)})
      </option>
      <option value={preview.token1.address}>
        {preview.token1.symbol} ({shortAddr(preview.token1.address)})
      </option>
    </select>
  );
}
