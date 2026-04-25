export default function HomePage() {
  return (
    <main className="min-h-screen p-8">
      <header className="border-b border-border pb-6 mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Hydra</h1>
        <p className="text-sm text-muted mt-1">
          Multi-agent liquidity coordination on Uniswap v4 — Unichain Sepolia
        </p>
      </header>
      <section className="text-muted text-sm">
        Dashboard scaffolding ready. Live agent feed, position panel, and decision log will land in the next batch.
      </section>
    </main>
  );
}
