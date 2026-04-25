import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hydra — multi-agent LP coordination',
  description: 'A swarm of 5 specialized agents managing a Uniswap v4 LP position.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-ink">{children}</body>
    </html>
  );
}
