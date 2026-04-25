import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: '#0a0a0a',
        panel: '#111111',
        border: '#1f1f1f',
        muted: '#6b7280',
        ink: '#f5f5f5',
        accent: '#22c55e',
        warn: '#f59e0b',
        err: '#ef4444',
        agent: {
          price: '#3b82f6',
          risk: '#f59e0b',
          strategy: '#a855f7',
          coordinator: '#22c55e',
          execution: '#06b6d4',
          bot: '#ec4899',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
