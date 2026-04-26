import { Badge } from '../ui/badge';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { shortAddr } from '../../lib/format';

export function BrandCard({
  wallet,
  onSignOut,
}: {
  wallet?: string;
  onSignOut?: () => void;
}) {
  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-brand-gradient grid place-items-center font-bold text-white shadow-glow shrink-0">
            H
          </span>
          <div>
            <div className="text-base font-semibold">Hydra</div>
            <div className="text-xs text-muted">v4 LP coordinator</div>
          </div>
        </div>
        {wallet && (
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
            <div className="space-y-0.5">
              <div className="label">Wallet</div>
              <div className="font-mono text-xs">{shortAddr(wallet)}</div>
            </div>
            {onSignOut && (
              <Button variant="ghost" size="sm" onClick={onSignOut}>
                Sign out
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
