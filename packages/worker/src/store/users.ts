import type { Address, Hex } from 'viem';
import { keccak256, encodePacked } from 'viem';

export function deriveDoId(wallet: Address, tokenId: bigint): Hex {
  return keccak256(encodePacked(['address', 'uint256'], [wallet, tokenId]));
}

export type UserRow = {
  doId: string;
  wallet: string;
  tokenId: string;
  registeredAt: number;
  lastKick: number;
};

export async function upsertUser(
  db: D1Database,
  u: { doId: string; wallet: string; tokenId: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (do_id, wallet, token_id, registered_at, last_kick)
       VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(do_id) DO UPDATE SET wallet=excluded.wallet, token_id=excluded.token_id, registered_at=excluded.registered_at`,
    )
    .bind(u.doId, u.wallet.toLowerCase(), u.tokenId, Date.now())
    .run();
}

export async function deleteUser(db: D1Database, doId: string): Promise<void> {
  await db.prepare('DELETE FROM users WHERE do_id = ?').bind(doId).run();
  await db.prepare('DELETE FROM events WHERE do_id = ?').bind(doId).run();
  await db.prepare('DELETE FROM decisions WHERE do_id = ?').bind(doId).run();
}

export async function listActiveUsers(
  db: D1Database,
  kickedBeforeMs: number,
  limit: number,
): Promise<UserRow[]> {
  const r = await db
    .prepare(
      `SELECT do_id, wallet, token_id, registered_at, last_kick
       FROM users WHERE last_kick < ? ORDER BY last_kick ASC LIMIT ?`,
    )
    .bind(kickedBeforeMs, limit)
    .all<{ do_id: string; wallet: string; token_id: string; registered_at: number; last_kick: number }>();
  return (r.results ?? []).map((x) => ({
    doId: x.do_id,
    wallet: x.wallet,
    tokenId: x.token_id,
    registeredAt: x.registered_at,
    lastKick: x.last_kick,
  }));
}

export async function bumpKick(db: D1Database, doId: string): Promise<void> {
  await db.prepare('UPDATE users SET last_kick = ? WHERE do_id = ?').bind(Date.now(), doId).run();
}

export async function listAllUsers(db: D1Database): Promise<UserRow[]> {
  const r = await db
    .prepare(
      `SELECT do_id, wallet, token_id, registered_at, last_kick FROM users ORDER BY registered_at DESC LIMIT 200`,
    )
    .all<{ do_id: string; wallet: string; token_id: string; registered_at: number; last_kick: number }>();
  return (r.results ?? []).map((x) => ({
    doId: x.do_id,
    wallet: x.wallet,
    tokenId: x.token_id,
    registeredAt: x.registered_at,
    lastKick: x.last_kick,
  }));
}

export async function findByWallet(db: D1Database, wallet: string): Promise<UserRow[]> {
  const r = await db
    .prepare(
      `SELECT do_id, wallet, token_id, registered_at, last_kick FROM users WHERE wallet = ? ORDER BY registered_at DESC`,
    )
    .bind(wallet.toLowerCase())
    .all<{ do_id: string; wallet: string; token_id: string; registered_at: number; last_kick: number }>();
  return (r.results ?? []).map((x) => ({
    doId: x.do_id,
    wallet: x.wallet,
    tokenId: x.token_id,
    registeredAt: x.registered_at,
    lastKick: x.last_kick,
  }));
}
