import type { Env } from './config';
import { listEvents, listDecisions } from './store/d1';
import { parseCallback, answerCallback } from './bot/telegram';
export { HydraDO } from './do';

function corsHeaders(env: Env): Record<string, string> {
  return {
    'access-control-allow-origin': env.DASHBOARD_ORIGIN || '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };
}

function singleton(env: Env): DurableObjectStub<import('./do').HydraDO> {
  const id = env.HYDRA.idFromName('singleton');
  return env.HYDRA.get(id) as DurableObjectStub<import('./do').HydraDO>;
}

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeaders(env);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    if (url.pathname === '/health') {
      return new Response('ok', { headers: cors });
    }

    if (url.pathname === '/ws') {
      return singleton(env).fetch(new Request(new URL('/ws', req.url), req));
    }

    if (url.pathname === '/api/events') {
      const evts = await listEvents(env.DB, 200);
      return Response.json(evts, { headers: cors });
    }

    if (url.pathname === '/api/decisions') {
      const decs = await listDecisions(env.DB, 200);
      return Response.json(decs, { headers: cors });
    }

    if (url.pathname === '/api/snapshot') {
      const snap = await singleton(env).snapshot();
      return Response.json(snap, { headers: cors });
    }

    if (url.pathname === '/admin/force' && req.method === 'POST') {
      const { action } = await req.json() as { action: 'REBALANCE' | 'HARVEST' | 'EXIT' };
      await singleton(env).forceAction(action);
      return Response.json({ ok: true }, { headers: cors });
    }

    if (url.pathname === '/admin/range' && req.method === 'POST') {
      const range = await req.json() as { tickLower: number; tickUpper: number };
      await singleton(env).setRange(range);
      return Response.json({ ok: true }, { headers: cors });
    }

    if (url.pathname === '/telegram' && req.method === 'POST') {
      const update = await req.json();
      const parsed = parseCallback(update);
      if (parsed && env.TELEGRAM_BOT_TOKEN) {
        await singleton(env).injectHumanDecision(parsed.decision, parsed.correlatesTo);
        await answerCallback(
          { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID ?? '' },
          parsed.cqId,
          `Recorded ${parsed.decision}`,
        );
      }
      return Response.json({ ok: true });
    }

    return new Response('not found', { status: 404, headers: cors });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(singleton(env).kick());
  },
} satisfies ExportedHandler<Env>;
