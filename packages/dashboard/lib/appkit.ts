'use client';

import { createAppKit } from '@reown/appkit/react';
import { networks, projectId, wagmiAdapter } from './wagmi';

// Side-effect: registers the AppKit web component + creates the modal singleton.
// Import this file once at the providers level to activate it.
export const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata: {
    name: 'Hydra',
    description: 'Autonomous LP management for Uniswap v4',
    url:
      typeof window !== 'undefined'
        ? window.location.origin
        : 'https://hydra-dashboard-81h.pages.dev',
    icons: ['https://hydra-dashboard-81h.pages.dev/favicon.ico'],
  },
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#E501A5',
    '--w3m-color-mix': '#131313',
    '--w3m-color-mix-strength': 25,
    '--w3m-border-radius-master': '12px',
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
});
