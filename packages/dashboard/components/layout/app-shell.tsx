import * as React from 'react';

export function AppShell({
  left,
  center,
  right,
}: {
  left: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-bg text-ink">
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 lg:grid-cols-[280px_1fr_360px] gap-4 px-4 py-6">
        <aside className="lg:sticky lg:top-6 lg:self-start space-y-4">{left}</aside>
        <section className="min-w-0">{center}</section>
        <aside className="lg:sticky lg:top-6 lg:self-start space-y-4">{right}</aside>
      </div>
    </main>
  );
}
