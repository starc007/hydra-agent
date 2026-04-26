import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  images: { unoptimized: true },
  trailingSlash: true,
  env: {
    NEXT_PUBLIC_BACKEND: process.env.NEXT_PUBLIC_BACKEND ?? 'http://localhost:8787',
  },
  webpack: (webpackConfig) => {
    // @wagmi/core bundles a Tempo wallet connector that dynamically imports the
    // optional `accounts` SDK and `pino-pretty` (for WalletConnect logger).
    // Neither is installed and neither is needed for our build — stub them out.
    webpackConfig.resolve.fallback = {
      ...webpackConfig.resolve.fallback,
      'pino-pretty': false,
      accounts: false,
      '@metamask/connect-evm': false,
    };
    return webpackConfig;
  },
};

export default config;
