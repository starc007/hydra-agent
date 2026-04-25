import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  images: { unoptimized: true },
  trailingSlash: true,
  env: {
    NEXT_PUBLIC_BACKEND: process.env.NEXT_PUBLIC_BACKEND ?? 'http://localhost:8787',
  },
};

export default config;
