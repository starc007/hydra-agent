import { DurableObject } from "cloudflare:workers";
import type { PublicClient } from "viem";
import type { Env, Config } from "./config";
import { loadConfig } from "./config";
import { Bus } from "./bus";
import { newEvent } from "./ids";
import type { HydraEvent } from "./events";
import {
  attachArchiver,
  listEvents,
  listDecisions,
  writeDecision,
} from "./store/d1";
import { fetchPoolState, priceFromSqrtX96, type PoolState } from "./chain/pool";
import { readErc20Metadata, type TokenMetadata } from "./chain/erc20";
import { makeClients } from "./chain/client";
import { readPositionMetadata } from "./chain/position";
import { readPositionFees } from "./chain/state-view";
import { LLMClient } from "./llm/client";
import { PriceAgent } from "./agents/price";
import { RiskAgent } from "./agents/risk";
import { StrategyAgent } from "./agents/strategy";
import { Coordinator } from "./agents/coordinator";
import { ExecutionAgent } from "./agents/execution";
import { makeSubmit } from "./chain/submit";
import { attachTelegramSender } from "./bot/telegram";

type Range = { tickLower: number; tickUpper: number };

export class HydraDO extends DurableObject<Env> {
  private bus = new Bus();
  private cfg: Config;
  private booted = false;
  private range: Range = { tickLower: -887200, tickUpper: 887200 };
  private latestPool?: PoolState;
  private entryPrice?: number;
  private positionMeta?: import('./chain/position').PositionMetadata;
  private tokenMeta?: { token0: TokenMetadata; token1: TokenMetadata };
  // Active LP NFT id. Defaults to cfg.TOKEN_ID; replaced (and persisted) after each rebalance mint.
  private activeTokenId!: bigint;
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

    const stored = await this.ctx.storage.get<Range>("range");
    this.range = stored ?? {
      tickLower: this.cfg.POSITION_TICK_LOWER,
      tickUpper: this.cfg.POSITION_TICK_UPPER,
    };

    this.entryPrice = await this.ctx.storage.get<number>("entryPrice");

    const storedTokenId = await this.ctx.storage.get<string>("activeTokenId");
    this.activeTokenId = storedTokenId ? BigInt(storedTokenId) : this.cfg.TOKEN_ID;

    const { publicClient, walletClient, account } = makeClients(this.cfg);

    // Read the real position metadata once on boot — overrides POSITION_TICK_* defaults.
    try {
      this.positionMeta = await readPositionMetadata(publicClient, this.cfg.positionManager, this.activeTokenId);
      if (!stored) {
        this.range = { tickLower: this.positionMeta.tickLower, tickUpper: this.positionMeta.tickUpper };
      }
      const [token0, token1] = await Promise.all([
        readErc20Metadata(publicClient, this.positionMeta.poolKey.currency0),
        readErc20Metadata(publicClient, this.positionMeta.poolKey.currency1),
      ]);
      this.tokenMeta = { token0, token1 };
    } catch (err) {
      console.error('[do] failed to read position metadata; pool reads will fail until fixed', err);
    }
    const claude = new LLMClient(this.cfg);

    const priceOf = (s: PoolState) =>
      priceFromSqrtX96(s.sqrtPriceX96, s.token0.decimals, s.token1.decimals);
    const price = new PriceAgent(this.bus, {
      range: () => this.range,
      fetcher: async () => {
        if (!this.positionMeta || !this.tokenMeta) {
          throw new Error('position metadata not loaded; cannot fetch pool state');
        }
        this.latestPool = await fetchPoolState({
          client: publicClient,
          stateView: this.cfg.stateView,
          poolId: this.positionMeta.poolId,
          tickSpacing: this.positionMeta.poolKey.tickSpacing,
          token0: this.tokenMeta.token0,
          token1: this.tokenMeta.token1,
        });
        if (this.entryPrice == null) {
          this.entryPrice = priceOf(this.latestPool);
          await this.ctx.storage.put("entryPrice", this.entryPrice);
        }
        return this.latestPool;
      },
      priceOf,
    });
    const risk = new RiskAgent(this.bus, {
      thresholdPct: this.cfg.IL_THRESHOLD_PCT,
      sample: async () => {
        if (!this.positionMeta || !this.tokenMeta) {
          throw new Error('position metadata not loaded; cannot sample risk');
        }
        const pool = this.latestPool ?? (await fetchPoolState({
          client: publicClient,
          stateView: this.cfg.stateView,
          poolId: this.positionMeta.poolId,
          tickSpacing: this.positionMeta.poolKey.tickSpacing,
          token0: this.tokenMeta.token0,
          token1: this.tokenMeta.token1,
        }));
        this.latestPool = pool;
        const priceNow = priceFromSqrtX96(pool.sqrtPriceX96, pool.token0.decimals, pool.token1.decimals);
        const priceEntry = this.entryPrice ?? priceNow;
        let feesEarnedUsd = 0;
        try {
          const { fees0, fees1 } = await readPositionFees({
            client: publicClient,
            stateView: this.cfg.stateView,
            poolId: this.positionMeta.poolId,
            positionManager: this.cfg.positionManager,
            tokenId: this.activeTokenId,
            tickLower: this.positionMeta.tickLower,
            tickUpper: this.positionMeta.tickUpper,
          });
          const fees0Float = Number(fees0) / 10 ** pool.token0.decimals;
          const fees1Float = Number(fees1) / 10 ** pool.token1.decimals;
          const stable = (this.cfg.STABLE_CURRENCY ?? '').toLowerCase();
          const isToken0Stable = stable && pool.token0.address.toLowerCase() === stable;
          const isToken1Stable = stable && pool.token1.address.toLowerCase() === stable;
          if (isToken0Stable) {
            // priceNow = token0 / token1, so 1 token1 = 1/priceNow USD
            feesEarnedUsd = fees0Float + fees1Float / priceNow;
          } else if (isToken1Stable || !stable) {
            // back-compat: assume token1 is stable. priceNow = token0 in token1 terms.
            feesEarnedUsd = fees0Float * priceNow + fees1Float;
          } else {
            // STABLE_CURRENCY set but matches neither side — skip USD conversion.
            feesEarnedUsd = 0;
          }
        } catch (err) {
          console.error('[risk] fee read failed', err);
        }
        return { priceEntry, priceNow, feesEarnedUsd };
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
      requireSignals: [
        "OUT_OF_RANGE",
        "IL_THRESHOLD_BREACH",
        "FEE_HARVEST_READY",
      ],
    });

    const submit = makeSubmit({
      publicClient,
      walletClient,
      positionManager: this.cfg.positionManager,
      stateView: this.cfg.stateView,
      poolKey: this.positionMeta?.poolKey ?? {
        currency0: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        currency1: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        fee: 500,
        tickSpacing: 60,
        hooks: '0x0000000000000000000000000000000000000000' as `0x${string}`,
      },
      poolId: this.positionMeta?.poolId ?? ('0x' + '00'.repeat(32)) as `0x${string}`,
      tokenId: () => this.activeTokenId,
      recipient: account.address,
      slippageBps: this.cfg.SLIPPAGE_BPS,
      onPositionMinted: async (newTokenId) => { await this.handleNewPosition(newTokenId, publicClient); },
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

    this.bus.on("APPROVED", (e) => {
      void writeDecision(this.env.DB, {
        id: e.id,
        ts: e.ts,
        action: e.payload.action,
        reason: e.payload.reason,
        approved: true,
        recommendation: {
          action: e.payload.action,
          confidence: 1,
          rationale: e.payload.reason,
        },
      });
    });
    this.bus.on("ESCALATE", (e) => {
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
      console.error("[do] tick failed", err);
    }
    await this.ctx.storage.setAlarm(Date.now() + this.cfg.TICK_INTERVAL_MS);
  }

  // ────── RPC entrypoints ──────

  async kick(): Promise<void> {
    await this.boot();
    const next = await this.ctx.storage.getAlarm();
    if (next == null) await this.ctx.storage.setAlarm(Date.now() + 1000);
  }

  async injectHumanDecision(
    decision: "approve" | "override",
    correlatesTo: string,
  ): Promise<void> {
    await this.boot();
    this.bus.emit(
      newEvent({
        source: "bot",
        type: "HUMAN_DECISION",
        payload: { decision, correlatesTo },
      }),
    );
  }

  async forceAction(action: "REBALANCE" | "HARVEST" | "EXIT"): Promise<void> {
    await this.boot();
    this.bus.emit(
      newEvent({
        source: "coordinator",
        type: "APPROVED",
        payload: { action, reason: "admin force" },
      }),
    );
  }

  async snapshot() {
    await this.boot();
    const events = await listEvents(this.env.DB, 100);
    const decisions = await listDecisions(this.env.DB, 50);
    return {
      range: this.range,
      entryPrice: this.entryPrice,
      latestPool: this.latestPool,
      activeTokenId: this.activeTokenId,
      events,
      decisions,
    };
  }

  async setRange(range: Range): Promise<void> {
    this.range = range;
    await this.ctx.storage.put("range", range);
  }

  /**
   * Called from the Execution Agent when a REBALANCE tx mints a fresh LP NFT.
   * Repoints the worker at the new tokenId, refreshes positionMeta + range, and
   * resets the entry price so the Risk Agent's IL math restarts from the rebalance moment.
   *
   * NOTE: Unichain Sepolia's "latest" RPC view can lag the mined block by a few hundred
   * milliseconds even after waitForTransactionReceipt resolves. PositionInfo for a freshly
   * minted tokenId may briefly read as all zeros. We retry the read with backoff until we
   * see a non-degenerate result (or give up after a few attempts).
   */
  private async handleNewPosition(newTokenId: bigint, publicClient: PublicClient): Promise<void> {
    this.activeTokenId = newTokenId;
    await this.ctx.storage.put("activeTokenId", newTokenId.toString());

    this.entryPrice = undefined;
    await this.ctx.storage.delete("entryPrice");

    let meta: import('./chain/position').PositionMetadata | undefined;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const m = await readPositionMetadata(publicClient, this.cfg.positionManager, newTokenId);
        // Reject degenerate state where the RPC hasn't caught up yet.
        if (m.tickLower !== 0 || m.tickUpper !== 0) {
          meta = m;
          break;
        }
      } catch (err) {
        console.error(`[do] readPositionMetadata attempt ${attempt + 1} threw`, err);
      }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); // 0.5s, 1s, 1.5s, ...
    }

    if (!meta) {
      console.error(`[do] gave up refreshing positionMeta for tokenId=${newTokenId} after retries`);
      return;
    }

    this.positionMeta = meta;
    this.range = { tickLower: meta.tickLower, tickUpper: meta.tickUpper };
    await this.ctx.storage.put("range", this.range);
    console.log(`[do] active position is now tokenId=${newTokenId} range=${this.range.tickLower}..${this.range.tickUpper}`);
  }

  // ────── WebSocket ──────

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const upgrade = req.headers.get("upgrade");
      if (upgrade !== "websocket")
        return new Response("expected websocket", { status: 400 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      await this.boot();
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("not found", { status: 404 });
  }

  override webSocketMessage(_ws: WebSocket, _msg: ArrayBuffer | string): void {}

  override webSocketClose(_ws: WebSocket): void {}

  private broadcast(e: HydraEvent): void {
    const msg = JSON.stringify(e);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        /* hibernated client may throw; ignore */
      }
    }
  }
}
