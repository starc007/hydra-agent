'use client';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND ?? 'http://localhost:8787';

export type RegisterPayload = {
  wallet: string;
  tokenId: string;
  privateKey: `0x${string}`;
  telegramChatId?: string;
  stableCurrency?: string;
};

export type RegisterResponse = {
  doId: string;
  sessionToken: string;
  range: { tickLower: number; tickUpper: number };
};

export async function register(p: RegisterPayload): Promise<RegisterResponse> {
  const res = await fetch(`${BACKEND}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(p),
  });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(j.error ?? `register ${res.status}`);
  return j as RegisterResponse;
}

export type PreviewPosition = {
  owner: string;
  tokenId: string;
  poolKey: {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  };
  poolId: string;
  tickLower: number;
  tickUpper: number;
  token0: { address: string; symbol: string; decimals: number };
  token1: { address: string; symbol: string; decimals: number };
  liquidity: string;  // bigint as string
};

export async function previewPosition(wallet: string, tokenId: string): Promise<PreviewPosition> {
  const url = `${BACKEND}/api/preview-position?wallet=${encodeURIComponent(wallet)}&tokenId=${encodeURIComponent(tokenId)}`;
  const res = await fetch(url);
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(j.error ?? `preview ${res.status}`);
  return j as PreviewPosition;
}

export async function unregister(doId: string, sessionToken: string): Promise<void> {
  const res = await fetch(`${BACKEND}/api/unregister`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hydra-session': sessionToken },
    body: JSON.stringify({ doId }),
  });
  if (!res.ok) throw new Error(`unregister ${res.status}`);
}

export async function forceAction(
  doId: string, sessionToken: string,
  action: 'REBALANCE' | 'HARVEST' | 'EXIT',
): Promise<void> {
  const res = await fetch(`${BACKEND}/admin/force?do=${doId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hydra-session': sessionToken },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(`force ${res.status}`);
}

export async function setRange(
  doId: string, sessionToken: string,
  range: { tickLower: number; tickUpper: number },
): Promise<void> {
  const res = await fetch(`${BACKEND}/admin/range?do=${doId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hydra-session': sessionToken },
    body: JSON.stringify(range),
  });
  if (!res.ok) throw new Error(`setRange ${res.status}`);
}

export type LookupRow = { doId: string; wallet: string; tokenId: string; registeredAt: number };
export async function lookup(wallet: string): Promise<LookupRow[]> {
  const res = await fetch(`${BACKEND}/api/lookup?wallet=${encodeURIComponent(wallet)}`);
  if (!res.ok) return [];
  return (await res.json()) as LookupRow[];
}
