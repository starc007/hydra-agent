import { DurableObject } from 'cloudflare:workers';
import type { Env, Config } from './config';
import { loadConfig } from './config';
import { Bus } from './bus';
import { newEvent } from './ids';
import type { HydraEvent } from './events';
import { attachArchiver, listEvents, listDecisions, writeDecision } from './store/d1';
import { fetchPoolState, priceFromSqrtX96, type PoolState } from './chain/pool';
import { makeClients } from './chain/client';
import { ClaudeClient } from './llm/claude';
import { PriceAgent } from './agents/price';
import { RiskAgent } from './agents/risk';
import { StrategyAgent } from './agents/strategy';
import { Coordinator } from './agents/coordinator';
import { ExecutionAgent } from './agents/execution';
import { makeSubmit } from './chain/submit';
import { attachTelegramSender } from './bot/telegram';

type Range = { tickLower: number; tickUpper: number };

export class HydraDO extends DurableObject<Env> {
  private bus = new Bus();
  private cfg: Config;
  private booted = false;
  private range: Range = { tickLower: -887200, tickUpper: 887200 };
  private latestPool?: PoolState;
  private entryPrice?: number;
  private agents: {
    price: PriceAgent;
    risk: RiskAgent;
    strategy: StrategyAgent;
    coordinator: Coordinator;
    execution: ExecutionAgent;
  } | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.cfg = loadConfig(env);
  }

  // ────── lifecycle ──────

  private async boot(): Promise<void> {
    if (this.booted) return;
    this.booted = true;

    attachArchiver(this.bus, this.env.DB);

    const stored = await this.ctx.storage.get<Range>('range');
    if (stored) this.range = stored;

    this.entryPrice = await this.ctx.storage.get<number>('entryPrice');

    const { publicClient, walletClient, account } = makeClients(this.cfg);
    const claude = new ClaudeClient(this.cfg.ANTHROPIC_API_KEY);

    const priceOf = (s: PoolState) => priceFromSqrtX96(s.sqrtPriceX96, s.token0.decimals, s.token1.decimals);
    const price = new PriceAgent(this.bus, {
      range: () => this.range,
      fetcher: async () => {
        this.latestPool = await fetchPoolState(this.cfg);
        if (this.entryPrice == null) {
          this.entryPrice = priceOf(this.latestPool);
          await this.ctx.storage.put('entryPrice', this.entryPrice);
        }
        return this.latestPool;
      },
      priceOf,
    });
    const risk = new RiskAgent(this.bus, {
      thresholdPct: this.cfg.IL_THRESHOLD_PCT,
      sample: async () => {
        const pool = this.latestPool ?? (await fetchPoolState(this.cfg));
        this.latestPool = pool;
        const priceNow = priceFromSqrtX96(pool.sqrtPriceX96, pool.token0.decimals, pool.token1.decimals);
        const priceEntry = this.entryPrice ?? priceNow;
        return { priceEntry, priceNow, feesEarnedUsd: 0 };
      },
    });
    const strategy = new StrategyAgent(this.bus, {
      client: claude,
      getPosition: () => ({ range: this.range, address: account.address }),
    });
    const coordinator = new Coordinator(this.bus, {
      dailyTxCap: this.cfg.DAILY_TX_CAP,
      cooldownSec: this.cfg.COOLDOWN_SEC,
      minConfidence: this.cfg.MIN_CONFIDENCE,
      requireSignals: ['OUT_OF_RANGE', 'IL_THRESHOLD_BREACH', 'FEE_HARVEST_READY'],
    });

    const submit = makeSubmit({
      publicClient,
      walletClient,
      positionManager: this.cfg.positionManager,
      poolKey: {
        currency0: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        currency1: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        fee: 500,
        tickSpacing: 60,
        hooks: '0x0000000000000000000000000000000000000000' as `0x${string}`,
      },
      tokenId: this.cfg.TOKEN_ID,
      currentTick: async () => (this.latestPool ?? (await fetchPoolState(this.cfg))).tick,
    });
    const execution = new ExecutionAgent(this.bus, submit);

    strategy.start();
    coordinator.start();
    execution.start();

    if (this.cfg.TELEGRAM_BOT_TOKEN && this.cfg.TELEGRAM_CHAT_ID) {
      attachTelegramSender(this.bus, {
        token: this.cfg.TELEGRAM_BOT_TOKEN,
        chatId: this.cfg.TELEGRAM_CHAT_ID,
      });
    }

    this.bus.on('APPROVED', (e) => {
      void writeDecision(this.env.DB, {
        id: e.id,
        ts: e.ts,
        action: e.payload.action,
        reason: e.payload.reason,
        approved: true,
        recommendation: { action: e.payload.action, confidence: 1, rationale: e.payload.reason },
      });
    });
    this.bus.on('ESCALATE', (e) => {
      void writeDecision(this.env.DB, {
        id: e.id,
        ts: e.ts,
        action: e.payload.recommendation.action,
        reason: e.payload.reason,
        approved: false,
        recommendation: e.payload.recommendation,
      });
    });

    this.bus.onAny((evt) => this.broadcast(evt));

    this.agents = { price, risk, strategy, coordinator, execution };

    await this.ctx.storage.setAlarm(Date.now() + this.cfg.TICK_INTERVAL_MS);
  }

  // ────── alarm tick ──────

  override async alarm(): Promise<void> {
    await this.boot();
    if (!this.agents) return;
    try {
      await Promise.all([this.agents.price.tick(), this.agents.risk.tick()]);
    } catch (err) {
      console.error('[do] tick failed', err);
    }
    await this.ctx.storage.setAlarm(Date.now() + this.cfg.TICK_INTERVAL_MS);
  }

  // ────── RPC entrypoints ──────

  async kick(): Promise<void> {
    await this.boot();
    const next = await this.ctx.storage.getAlarm();
    if (next == null) await this.ctx.storage.setAlarm(Date.now() + 1000);
  }

  async injectHumanDecision(decision: 'approve' | 'override', correlatesTo: string): Promise<void> {
    await this.boot();
    this.bus.emit(newEvent({ source: 'bot', type: 'HUMAN_DECISION', payload: { decision, correlatesTo } }));
  }

  async forceAction(action: 'REBALANCE' | 'HARVEST' | 'EXIT'): Promise<void> {
    await this.boot();
    this.bus.emit(newEvent({ source: 'coordinator', type: 'APPROVED', payload: { action, reason: 'admin force' } }));
  }

  async snapshot() {
    await this.boot();
    const events = await listEvents(this.env.DB, 100);
    const decisions = await listDecisions(this.env.DB, 50);
    return { range: this.range, entryPrice: this.entryPrice, latestPool: this.latestPool, events, decisions };
  }

  async setRange(range: Range): Promise<void> {
    this.range = range;
    await this.ctx.storage.put('range', range);
  }

  // ────── WebSocket ──────

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      const upgrade = req.headers.get('upgrade');
      if (upgrade !== 'websocket') return new Response('expected websocket', { status: 400 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      await this.boot();
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('not found', { status: 404 });
  }

  override webSocketMessage(_ws: WebSocket, _msg: ArrayBuffer | string): void {}

  override webSocketClose(_ws: WebSocket): void {}

  private broadcast(e: HydraEvent): void {
    const msg = JSON.stringify(e);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch { /* hibernated client may throw; ignore */ }
    }
  }
}
