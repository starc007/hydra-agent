'use client';
import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { AppShell } from '../components/layout/app-shell';
import { BrandCard } from '../components/layout/brand-card';
import { AgentList } from '../components/agents/agent-list';
import { LiveFeed } from '../components/feed/live-feed';
import { PositionPanel } from '../components/position/position-panel';
import { DecisionLog } from '../components/position/decision-log';
import { ActionsPanel } from '../components/position/actions-panel';
import { ConnectWallet } from '../components/onboarding/connect-wallet';
import { RegisterForm } from '../components/onboarding/register-form';
import { WelcomeBack } from '../components/onboarding/welcome-back';
import { SettingsDialog } from '../components/settings/settings-dialog';
import { useEventStream, useSnapshot } from '../lib/ws';
import { loadSession, saveSession, clearSession, type Session } from '../lib/storage';
import { useWallet } from '../lib/wallet';
import { unregister, lookup, type LookupRow } from '../lib/api';

export default function HomePage() {
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lookupResult, setLookupResult] = useState<LookupRow[] | null>(null);
  const [lookupChecked, setLookupChecked] = useState(false);

  const { address, isConnected, disconnect } = useWallet();
  const wallet: Address | null = isConnected && address ? address : null;

  useEffect(() => {
    const stored = loadSession();
    if (stored) setSession(stored);
    setHydrated(true);
  }, []);

  // When wallet connects and there's no session, check for a prior registration.
  useEffect(() => {
    if (!wallet || session) {
      setLookupChecked(false);
      setLookupResult(null);
      return;
    }
    setLookupChecked(false);
    (async () => {
      try {
        const rows = await lookup(wallet);
        setLookupResult(rows);
      } catch {
        setLookupResult([]);
      } finally {
        setLookupChecked(true);
      }
    })();
  }, [wallet, session]);

  const events = useEventStream(session?.doId ?? null, 200);
  const { data: snapshot } = useSnapshot(session?.doId ?? null);

  if (!hydrated) {
    return (
      <main className="min-h-screen grid place-items-center text-sm text-muted bg-bg">
        Loading…
      </main>
    );
  }

  /** Logout only — keeps server-side registration so reconnecting auto-restores. */
  async function handleSignOut() {
    clearSession();
    setSession(null);
    await disconnect();
  }

  /** Permanently remove server-side registration. */
  async function handleUnregisterAndSignOut() {
    if (!session) return;
    if (!confirm('This will permanently delete your Hydra registration. Continue?')) return;
    try { await unregister(session.doId, session.sessionToken); } catch { /* tolerate */ }
    clearSession();
    setSession(null);
    await disconnect();
  }

  if (!session) {
    return (
      <AppShell
        left={
          <BrandCard
            wallet={wallet ?? undefined}
            onDisconnect={wallet ? () => { void disconnect(); } : undefined}
          />
        }
        center={
          !wallet ? (
            <ConnectWallet />
          ) : !lookupChecked ? (
            <div className="card p-6 text-center text-sm text-muted bg-surface border border-border rounded-xl">
              Checking for prior registrations…
            </div>
          ) : lookupResult && lookupResult.length > 0 ? (
            <WelcomeBack
              wallet={wallet}
              registrations={lookupResult}
              onResumed={(s) => { saveSession(s); setSession(s); }}
              onStartFresh={() => setLookupResult([])}
            />
          ) : (
            <RegisterForm wallet={wallet} onRegistered={(s) => { saveSession(s); setSession(s); }} />
          )
        }
        right={null}
      />
    );
  }

  return (
    <>
      <AppShell
        left={
          <>
            <BrandCard
              wallet={session.wallet}
              onSignOut={handleSignOut}
              onSettings={() => setSettingsOpen(true)}
              onUnregister={handleUnregisterAndSignOut}
            />
            <AgentList events={events} />
          </>
        }
        center={<LiveFeed events={events} />}
        right={
          <>
            <PositionPanel snapshot={snapshot} events={events} />
            <ActionsPanel session={session} />
            <DecisionLog snapshot={snapshot} />
          </>
        }
      />
      {settingsOpen && (
        <SettingsDialog
          doId={session.doId}
          sessionToken={session.sessionToken}
          initial={{}}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => { /* settings take effect on next alarm tick */ }}
        />
      )}
    </>
  );
}
