declare const process: { env: Record<string, string | undefined>; argv: string[]; exit: (code: number) => never; cwd: () => string };

import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, type Address, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const UNICHAIN_SEPOLIA_ADDRESSES = {
  poolManager:     '0x00b036b58a818b1bc34d502d3fe730db729e62ac' as Address,
  positionManager: '0xf969aee60879c54baaed9f3ed26147db216fd664' as Address,
  stateView:       '0xc199f1072a74d4e905aba1a84d9a45e2546b6222' as Address,
  permit2:         '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address,
};

export const unichainSepolia: Chain = {
  id: 1301,
  name: 'Unichain Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia.unichain.org'] } },
};

function parseDevVars(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  let raw: string;
  try { raw = readFileSync(path, 'utf8'); }
  catch { return out; }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

export function loadEnv(): { privateKey: `0x${string}`; rpcUrl: string } {
  const vars = parseDevVars(`${process.cwd()}/packages/worker/.dev.vars`);
  const merged: Record<string, string | undefined> = { ...vars, ...process.env };
  const pk = merged.PRIVATE_KEY;
  if (!pk || !pk.startsWith('0x')) {
    throw new Error('PRIVATE_KEY missing or malformed (set in packages/worker/.dev.vars or env)');
  }
  return {
    privateKey: pk as `0x${string}`,
    rpcUrl: merged.RPC_URL ?? 'https://sepolia.unichain.org',
  };
}

export function makeClients(privateKey: `0x${string}`, rpcUrl: string) {
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl);
  return {
    account,
    publicClient: createPublicClient({ chain: unichainSepolia, transport }),
    walletClient: createWalletClient({ chain: unichainSepolia, transport, account }),
  };
}

export function arg(name: string, fallback?: string): string | undefined {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

export function requireArg(name: string): string {
  const v = arg(name);
  if (!v) {
    console.error(`missing required --${name} arg`);
    process.exit(1);
  }
  return v;
}
