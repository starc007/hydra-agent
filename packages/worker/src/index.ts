import type { Env } from './config';
import { listEvents, listDecisions } from './store/d1';
import { upsertUser, deleteUser, listAllUsers, deriveDoId, findByWallet } from './store/users';
import { parseCallback, answerCallback, resolveEscalationMessage } from './bot/telegram';
export { HydraDO } from './do';

function corsHeaders(env: Env): Record<string, string> {
  return {
    'access-control-allow-origin': env.DASHBOARD_ORIGIN || '*',
    'access-control-allow-headers': 'content-type, x-hydra-session',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };
}

function doStub(env: Env, doId: string): DurableObjectStub<import('./do').HydraDO> {
  return env.HYDRA.get(env.HYDRA.idFromName(doId)) as DurableObjectStub<import('./do').HydraDO>;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomToken(): string {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return Array.from(a)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function jsonBigintReplacer(_k: string, v: unknown) {
  return typeof v === 'bigint' ? v.toString() : v;
}

function jsonResponse(body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body, jsonBigintReplacer), {
    headers: { ...headers, 'content-type': 'application/json' },
  });
}

async function previewPosition(env: Env, wallet: string, tokenIdStr: string) {
  const { createPublicClient, http } = await import('viem');
  const { readPositionMetadata } = await import('./chain/position');
  const { readErc20Metadata } = await import('./chain/erc20');

  // Public client only — no private key needed for read-only validation.
  const publicClient = createPublicClient({
    transport: http(env.RPC_URL),
  });

  const tokenId = BigInt(tokenIdStr);
  const positionManager = env.POSITION_MANAGER as `0x${string}`;
  const walletLower = wallet.toLowerCase();

  // Validate ownership
  const owner = (await publicClient.readContract({
    address: positionManager,
    abi: [{
      type: 'function', name: 'ownerOf', stateMutability: 'view',
      inputs: [{ name: 'tokenId', type: 'uint256' }],
      outputs: [{ type: 'address' }],
    }],
    functionName: 'ownerOf',
    args: [tokenId],
  })) as `0x${string}`;
  if (owner.toLowerCase() !== walletLower) {
    throw new Error(`tokenId ${tokenIdStr} is owned by ${owner}, not ${wallet}`);
  }

  const meta = await readPositionMetadata(publicClient as any, positionManager, tokenId);
  const [token0, token1, liquidity] = await Promise.all([
    readErc20Metadata(publicClient as any, meta.poolKey.currency0),
    readErc20Metadata(publicClient as any, meta.poolKey.currency1),
    publicClient.readContract({
      address: positionManager,
      abi: [{ type: 'function', name: 'getPositionLiquidity', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'uint128' }] }],
      functionName: 'getPositionLiquidity',
      args: [tokenId],
    }) as Promise<bigint>,
  ]);

  return {
    owner,
    tokenId: tokenIdStr,
    poolKey: meta.poolKey,
    poolId: meta.poolId,
    tickLower: meta.tickLower,
    tickUpper: meta.tickUpper,
    token0,
    token1,
    liquidity: liquidity.toString(),
  };
}

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeaders(env);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    // ── /health ──────────────────────────────────────────────────────────────
    if (url.pathname === '/health') {
      return new Response('ok', { headers: cors });
    }

    // ── POST /api/register ────────────────────────────────────────────────────
    if (url.pathname === '/api/register' && req.method === 'POST') {
      const body = (await req.json()) as {
        wallet?: string;
        tokenId?: string;
        privateKey?: string;
        telegramChatId?: string;
        stableCurrency?: string;
      };
      if (!body.wallet || !body.tokenId || !body.privateKey) {
        return jsonResponse(
          { error: 'wallet, tokenId, and privateKey are required' },
          { ...cors, 'cache-control': 'no-store' },
        );
      }
      const wallet = body.wallet.toLowerCase() as `0x${string}`;
      const sessionToken = randomToken();
      const sessionTokenHash = await sha256Hex(sessionToken);
      const doId = deriveDoId(wallet, BigInt(body.tokenId));
      try {
        const stub = doStub(env, doId);
        const result = await stub.register({
          wallet,
          tokenId: body.tokenId,
          privateKey: body.privateKey as `0x${string}`,
          telegramChatId: body.telegramChatId,
          stableCurrency: body.stableCurrency,
          sessionTokenHash,
        });
        await upsertUser(env.DB, { doId: result.doId, wallet, tokenId: body.tokenId });
        return jsonResponse({ doId: result.doId, sessionToken, range: result.range }, cors);
      } catch (err) {
        return jsonResponse(
          { error: String(err instanceof Error ? err.message : err) },
          { ...cors },
        );
      }
    }

    // ── POST /api/unregister ──────────────────────────────────────────────────
    if (url.pathname === '/api/unregister' && req.method === 'POST') {
      const body = (await req.json()) as { doId?: string };
      const session = req.headers.get('x-hydra-session') ?? '';
      if (!body.doId) return jsonResponse({ error: 'doId required' }, cors);
      const ok = await doStub(env, body.doId).verifySession(await sha256Hex(session));
      if (!ok) return new Response('forbidden', { status: 403, headers: cors });
      await doStub(env, body.doId).unregister();
      await deleteUser(env.DB, body.doId);
      return jsonResponse({ ok: true }, cors);
    }

    // ── GET /api/users ────────────────────────────────────────────────────────
    if (url.pathname === '/api/users') {
      const list = await listAllUsers(env.DB);
      // Return only non-PII fields
      return jsonResponse(
        list.map((u) => ({ doId: u.doId, wallet: u.wallet, tokenId: u.tokenId })),
        cors,
      );
    }

    // ── GET /api/lookup?wallet=<addr> ─────────────────────────────────────────
    if (url.pathname === '/api/lookup') {
      const wallet = url.searchParams.get('wallet');
      if (!wallet) return jsonResponse({ error: 'wallet required' }, cors);
      const list = await findByWallet(env.DB, wallet);
      return jsonResponse(
        list.map((u) => ({ doId: u.doId, wallet: u.wallet, tokenId: u.tokenId, registeredAt: u.registeredAt })),
        cors,
      );
    }

    // ── GET /api/preview-position?wallet=<addr>&tokenId=<id> ──────────────────
    if (url.pathname === '/api/preview-position') {
      const wallet = url.searchParams.get('wallet');
      const tokenIdStr = url.searchParams.get('tokenId');
      if (!wallet || !tokenIdStr) {
        return jsonResponse({ error: 'wallet and tokenId required' }, cors);
      }
      try {
        const preview = await previewPosition(env, wallet, tokenIdStr);
        return jsonResponse(preview, cors);
      } catch (err) {
        return jsonResponse(
          { error: err instanceof Error ? err.message : String(err) },
          { ...cors, 'cache-control': 'no-store' },
        );
      }
    }

    // ── POST /api/resume ──────────────────────────────────────────────────────
    if (url.pathname === '/api/resume' && req.method === 'POST') {
      const body = (await req.json()) as { wallet?: string; tokenId?: string; privateKey?: string };
      if (!body.wallet || !body.tokenId || !body.privateKey) {
        return jsonResponse({ error: 'wallet, tokenId, and privateKey are required' }, cors);
      }
      const wallet = body.wallet.toLowerCase() as `0x${string}`;
      const sessionToken = randomToken();
      const sessionTokenHash = await sha256Hex(sessionToken);
      const doId = deriveDoId(wallet, BigInt(body.tokenId));
      try {
        const stub = doStub(env, doId);
        const out = await stub.resume({ privateKey: body.privateKey as `0x${string}`, sessionTokenHash });
        return jsonResponse({ doId: out.doId, sessionToken }, cors);
      } catch (err) {
        return jsonResponse(
          { error: err instanceof Error ? err.message : String(err) },
          { ...cors, 'cache-control': 'no-store' },
        );
      }
    }

    // ── POST /api/update ──────────────────────────────────────────────────────
    if (url.pathname === '/api/update' && req.method === 'POST') {
      const body = (await req.json()) as {
        doId?: string;
        telegramChatId?: string | null;
        stableCurrency?: string | null;
      };
      const session = req.headers.get('x-hydra-session') ?? '';
      if (!body.doId) return jsonResponse({ error: 'doId required' }, cors);
      const sessionTokenHash = await sha256Hex(session);
      try {
        await doStub(env, body.doId).updateSettings({
          sessionTokenHash,
          telegramChatId: body.telegramChatId,
          stableCurrency: body.stableCurrency,
        });
        return jsonResponse({ ok: true }, cors);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('forbidden')) return new Response('forbidden', { status: 403, headers: cors });
        if (msg.includes('not_registered')) return new Response('not registered', { status: 404, headers: cors });
        return jsonResponse({ error: msg }, cors);
      }
    }

    // Routes below require ?do=
    const doId = url.searchParams.get('do');

    // ── GET /ws ───────────────────────────────────────────────────────────────
    if (url.pathname === '/ws') {
      if (!doId) return new Response('missing ?do', { status: 400, headers: cors });
      return doStub(env, doId).fetch(new Request(new URL('/ws', req.url), req));
    }

    // ── GET /api/snapshot ─────────────────────────────────────────────────────
    if (url.pathname === '/api/snapshot') {
      if (!doId) return new Response('missing ?do', { status: 400, headers: cors });
      try {
        const snap = await doStub(env, doId).snapshot();
        return jsonResponse(snap, cors);
      } catch (err) {
        const msg = String(err instanceof Error ? err.message : err);
        if (msg.includes('not_registered')) {
          return new Response('not registered', { status: 404, headers: cors });
        }
        throw err;
      }
    }

    // ── GET /api/events ───────────────────────────────────────────────────────
    if (url.pathname === '/api/events') {
      if (!doId) return new Response('missing ?do', { status: 400, headers: cors });
      const evts = await listEvents(env.DB, doId, 200);
      return jsonResponse(evts, cors);
    }

    // ── GET /api/decisions ────────────────────────────────────────────────────
    if (url.pathname === '/api/decisions') {
      if (!doId) return new Response('missing ?do', { status: 400, headers: cors });
      const decs = await listDecisions(env.DB, doId, 200);
      return jsonResponse(decs, cors);
    }

    // ── POST /admin/force ─────────────────────────────────────────────────────
    if (url.pathname === '/admin/force' && req.method === 'POST') {
      if (!doId) return new Response('missing ?do', { status: 400, headers: cors });
      const session = req.headers.get('x-hydra-session') ?? '';
      const ok = await doStub(env, doId).verifySession(await sha256Hex(session));
      if (!ok) return new Response('forbidden', { status: 403, headers: cors });
      const { action } = (await req.json()) as { action: 'REBALANCE' | 'HARVEST' | 'EXIT' };
      await doStub(env, doId).forceAction(action);
      return jsonResponse({ ok: true }, cors);
    }

    // ── POST /admin/range ─────────────────────────────────────────────────────
    if (url.pathname === '/admin/range' && req.method === 'POST') {
      if (!doId) return new Response('missing ?do', { status: 400, headers: cors });
      const session = req.headers.get('x-hydra-session') ?? '';
      const ok = await doStub(env, doId).verifySession(await sha256Hex(session));
      if (!ok) return new Response('forbidden', { status: 403, headers: cors });
      const range = (await req.json()) as { tickLower: number; tickUpper: number };
      await doStub(env, doId).setRange(range);
      return jsonResponse({ ok: true }, cors);
    }

    // ── POST /telegram ────────────────────────────────────────────────────────
    if (url.pathname === '/telegram' && req.method === 'POST') {
      const update = await req.json();
      const parsed = parseCallback(update);
      if (parsed && env.TELEGRAM_BOT_TOKEN) {
        const row = await env.DB.prepare(
          'SELECT do_id FROM escalations WHERE correlates_to = ?',
        )
          .bind(parsed.correlatesTo)
          .first<{ do_id: string }>();
        if (row) {
          const tgCfg = { token: env.TELEGRAM_BOT_TOKEN, chatId: '' };
          await doStub(env, row.do_id).injectHumanDecision(parsed.decision, parsed.correlatesTo);
          await answerCallback(tgCfg, parsed.cqId, `Recorded ${parsed.decision}`);
          if (parsed.chatId != null && parsed.messageId != null) {
            await resolveEscalationMessage(tgCfg, {
              chatId: parsed.chatId,
              messageId: parsed.messageId,
              decision: parsed.decision,
            });
          }
        }
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response('not found', { status: 404, headers: cors });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const { listActiveUsers, bumpKick } = await import('./store/users');
        const cutoff = Date.now() - 30_000;
        const users = await listActiveUsers(env.DB, cutoff, 50);
        for (const u of users) {
          try {
            await doStub(env, u.doId).kick();
            await bumpKick(env.DB, u.doId);
          } catch (e) {
            console.error('[cron] kick failed', u.doId, e);
          }
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
