import { Settings } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { shortAddr } from '../../lib/format';

export function BrandCard({
  wallet,
  onSignOut,
  onDisconnect,
  onSettings,
  onUnregister,
}: {
  wallet?: string;
  /** Logout only — clears localStorage + disconnects wallet; keeps server registration. */
  onSignOut?: () => void;
  /** Disconnect the wallet without touching server state. Used pre-registration. */
  onDisconnect?: () => void;
  /** Open the settings dialog. Only shown when a session is active. */
  onSettings?: () => void;
  /** Permanently delete server-side registration. Shown below sign-out in active session. */
  onUnregister?: () => void;
}) {
  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-brand-gradient grid place-items-center font-bold text-white border border-borderStrong shrink-0">
            H
          </span>
          <div>
            <div className="text-base font-semibold">Hydra</div>
            <div className="text-xs text-muted">v4 LP coordinator</div>
          </div>
        </div>
        {wallet && (
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="label">Wallet</div>
                <div className="font-mono text-xs">{shortAddr(wallet)}</div>
              </div>
              <div className="flex items-center gap-1">
                {onSettings && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onSettings}
                    title="Settings"
                    className="h-8 w-8"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </Button>
                )}
                {onSignOut ? (
                  <Button variant="ghost" size="sm" onClick={onSignOut}>
                    Sign out
                  </Button>
                ) : onDisconnect ? (
                  <Button variant="ghost" size="sm" onClick={onDisconnect}>
                    Disconnect
                  </Button>
                ) : null}
              </div>
            </div>
            {onUnregister && (
              <button
                onClick={onUnregister}
                className="w-full text-left text-[11px] text-subtle hover:text-err transition-colors pt-1"
              >
                Delete registration
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
