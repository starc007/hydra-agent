import { DurableObject } from 'cloudflare:workers';
import type { PublicClient } from 'viem';
import type { Env, Config } from './config';
import { loadConfig } from './config';
import { Bus } from './bus';
import { newEvent } from './ids';
import type { HydraEvent } from './events';
import { attachArchiver, listEvents, listDecisions, writeDecision } from './store/d1';
import { deriveDoId } from './store/users';
import { fetchPoolState, priceFromSqrtX96, type PoolState } from './chain/pool';
import { readErc20Metadata, type TokenMetadata } from './chain/erc20';
import { makeClients } from './chain/client';
import { readPositionMetadata } from './chain/position';
import { readPositionFees } from './chain/state-view';
import { LLMClient } from './llm/client';
import { PriceAgent } from './agents/price';
import { RiskAgent } from './agents/risk';
import { StrategyAgent } from './agents/strategy';
import { Coordinator } from './agents/coordinator';
import { ExecutionAgent } from './agents/execution';
import { MacroAgent } from './agents/macro';
import { makeSubmit } from './chain/submit';
import { attachTelegramSender } from './bot/telegram';
import { privateKeyToAccount } from 'viem/accounts';

type Range = { tickLower: number; tickUpper: number };

type StoredUser = {
  wallet: `0x${string}`;
  tokenId: string;             // bigint as string
  privateKey: `0x${string}`;
  telegramChatId?: string;
  stableCurrency?: string;     // hex address
  sessionTokenHash: string;    // sha256 hex
};

const NOT_REGISTERED = 'not_registered';

export class HydraDO extends DurableObject<Env> {
  private bus = new Bus();
  private cfg: Config;
  private booted = false;
  private user?: StoredUser;
  private doId: string = '';
  private range: Range = { tickLower: -887200, tickUpper: 887200 };
  private latestPool?: PoolState;
  private entryPrice?: number;
  private positionMeta?: import('./chain/position').PositionMetadata;
  private tokenMeta?: { token0: TokenMetadata; token1: TokenMetadata };
  private activeTokenId!: bigint;
  private agents: {
    price: PriceAgent;
    risk: RiskAgent;
    strategy: StrategyAgent;
    coordinator: Coordinator;
    execution: ExecutionAgent;
    macro: MacroAgent;
  } | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.cfg = loadConfig(env);
  }

  // ────── registration ──────

  async register(args: {
    wallet: `0x${string}`;
    tokenId: string;
    privateKey: `0x${string}`;
    telegramChatId?: string;
    stableCurrency?: string;
    sessionTokenHash: string;
  }): Promise<{ doId: string; range: Range }> {
    // Validate that the private key derives the wallet
    const derived = privateKeyToAccount(args.privateKey).address.toLowerCase();
    if (derived !== args.wallet.toLowerCase()) {
      throw new Error('private key does not match wallet address');
    }

    // Validate ownership and read position metadata in one pass.
    const { publicClient } = makeClients({ rpcUrl: this.cfg.RPC_URL, privateKey: args.privateKey });
    const tokenId = BigInt(args.tokenId);
    const ownerOf = (await publicClient.readContract({
      address: this.cfg.positionManager,
      abi: [{ type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] }],
      functionName: 'ownerOf',
      args: [tokenId],
    })) as `0x${string}`;
    if (ownerOf.toLowerCase() !== args.wallet.toLowerCase()) {
      throw new Error('wallet does not own this LP NFT');
    }

    // Best-effort metadata read — gives the dashboard the real range immediately.
    // Tolerated; alarm() will retry the read when it boots.
    let initialRange: Range = { tickLower: -887200, tickUpper: 887200 };
    try {
      const meta = await readPositionMetadata(publicClient, this.cfg.positionManager, tokenId);
      initialRange = { tickLower: meta.tickLower, tickUpper: meta.tickUpper };
    } catch (err) {
      console.warn('[do.register] positionMeta read failed; will retry in alarm', err);
    }

    const user: StoredUser = {
      wallet: args.wallet,
      tokenId: args.tokenId,
      privateKey: args.privateKey,
      telegramChatId: args.telegramChatId,
      stableCurrency: args.stableCurrency,
      sessionTokenHash: args.sessionTokenHash,
    };
    this.doId = deriveDoId(args.wallet, tokenId);
    this.activeTokenId = tokenId;
    this.user = user;
    this.range = initialRange;

    // Single batched write — atomic, single transaction, fast.
    await this.ctx.storage.put({
      user,
      doId: this.doId,
      activeTokenId: args.tokenId,
      range: initialRange,
    });
    await this.ctx.storage.delete('entryPrice');

    // Defer the heavy boot (RPC + agent wiring + alarm chain) to the alarm handler.
    // We schedule it to fire ~1s from now; alarm() calls boot() on its first run.
    this.booted = false;
    this.agents = null;
    await this.ctx.storage.setAlarm(Date.now() + 1000);

    return { doId: this.doId, range: initialRange };
  }

  async unregister(): Promise<void> {
    this.booted = false;
    this.agents = null;
    this.user = undefined;
    await this.ctx.storage.deleteAll();
  }

  async verifySession(sessionTokenHash: string): Promise<boolean> {
    if (!this.user) {
      this.user = await this.ctx.storage.get<StoredUser>('user');
    }
    if (!this.user) return false;
    return this.user.sessionTokenHash === sessionTokenHash;
  }

  // ────── lifecycle ──────

  private async boot(): Promise<void> {
    if (this.booted) return;

    this.user = await this.ctx.storage.get<StoredUser>('user');
    if (!this.user) {
      throw new Error(NOT_REGISTERED);
    }
    this.doId =
      (await this.ctx.storage.get<string>('doId')) ??
      deriveDoId(this.user.wallet, BigInt(this.user.tokenId));

    this.booted = true;

    attachArchiver(this.bus, this.env.DB, this.doId);

    const stored = await this.ctx.storage.get<Range>('range');
    this.range = stored ?? { tickLower: -887200, tickUpper: 887200 };

    this.entryPrice = await this.ctx.storage.get<number>('entryPrice');

    const storedTokenId = await this.ctx.storage.get<string>('activeTokenId');
    this.activeTokenId = BigInt(storedTokenId ?? this.user.tokenId);

    const { publicClient, walletClient, account } = makeClients({
      rpcUrl: this.cfg.RPC_URL,
      privateKey: this.user.privateKey,
    });

    // Read position metadata on boot — overrides default range if not already stored.
    try {
      this.positionMeta = await readPositionMetadata(
        publicClient,
        this.cfg.positionManager,
        this.activeTokenId,
      );
      if (!stored) {
        this.range = { tickLower: this.positionMeta.tickLower, tickUpper: this.positionMeta.tickUpper };
        await this.ctx.storage.put('range', this.range);
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
          await this.ctx.storage.put('entryPrice', this.entryPrice);
        }
        return this.latestPool;
      },
      priceOf,
      client: claude,
    });

    const risk = new RiskAgent(this.bus, {
      thresholdPct: this.cfg.IL_THRESHOLD_PCT,
      client: claude,
      getRecentTicks: () => price.getRecentTicks(10),
      getTimeInRange: () => price.getTimeInRangePct(),
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
          const stable = (this.user!.stableCurrency ?? '').toLowerCase();
          const isToken0Stable = stable && pool.token0.address.toLowerCase() === stable;
          const isToken1Stable = stable && pool.token1.address.toLowerCase() === stable;
          if (isToken0Stable) {
            feesEarnedUsd = fees0Float + fees1Float / priceNow;
          } else if (isToken1Stable || !stable) {
            feesEarnedUsd = fees0Float * priceNow + fees1Float;
          } else {
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
      getPosition: () => ({
        range: this.range,
        tokenId: this.activeTokenId.toString(),
        wallet: this.user!.wallet,
      }),
    });

    const coordinator = new Coordinator(this.bus, {
      dailyTxCap: this.cfg.DAILY_TX_CAP,
      cooldownSec: this.cfg.COOLDOWN_SEC,
      minConfidence: this.cfg.MIN_CONFIDENCE,
      requireSignals: ['OUT_OF_RANGE', 'IL_THRESHOLD_BREACH', 'FEE_HARVEST_READY'],
      client: claude,
    });

    const macro = new MacroAgent(this.bus, {
      client: claude,
      getPoolStats: async () => {
        if (!this.positionMeta || !this.tokenMeta) {
          throw new Error('position metadata not loaded; cannot get pool stats for macro');
        }
        const pool = this.latestPool ?? (await fetchPoolState({
          client: publicClient,
          stateView: this.cfg.stateView,
          poolId: this.positionMeta.poolId,
          tickSpacing: this.positionMeta.poolKey.tickSpacing,
          token0: this.tokenMeta.token0,
          token1: this.tokenMeta.token1,
        }));
        const ticks = price.getRecentTicks();
        const tickValues = ticks.map((t) => t.tick);
        const minTick = tickValues.length ? Math.min(...tickValues) : pool.tick;
        const maxTick = tickValues.length ? Math.max(...tickValues) : pool.tick;
        let stdDev = 0;
        if (tickValues.length > 1) {
          const mean = tickValues.reduce((a, b) => a + b, 0) / tickValues.length;
          stdDev = Math.sqrt(tickValues.reduce((s, t) => s + (t - mean) ** 2, 0) / tickValues.length);
        }
        const drift = tickValues.length > 1 ? tickValues[tickValues.length - 1] - tickValues[0] : 0;
        return {
          sqrtPriceX96: pool.sqrtPriceX96,
          liquidity: pool.liquidity,
          tick: pool.tick,
          recentTickRange: { min: minTick, max: maxTick },
          stdDev,
          drift,
        };
      },
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
      poolId: this.positionMeta?.poolId ?? (('0x' + '00'.repeat(32)) as `0x${string}`),
      tokenId: () => this.activeTokenId,
      recipient: account.address,
      slippageBps: this.cfg.SLIPPAGE_BPS,
      onPositionMinted: async (newTokenId) => {
        await this.handleNewPosition(newTokenId, publicClient);
      },
    });
    const execution = new ExecutionAgent(this.bus, submit);

    strategy.start();
    coordinator.start();
    execution.start();

    if (this.cfg.TELEGRAM_BOT_TOKEN && this.user.telegramChatId) {
      attachTelegramSender(
        this.bus,
        { token: this.cfg.TELEGRAM_BOT_TOKEN, chatId: this.user.telegramChatId },
        this.doId,
        this.env.DB,
      );
    }

    this.bus.on('APPROVED', (e) => {
      void writeDecision(this.env.DB, this.doId, {
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
    this.bus.on('ESCALATE', (e) => {
      void writeDecision(this.env.DB, this.doId, {
        id: e.id,
        ts: e.ts,
        action: e.payload.recommendation.action,
        reason: e.payload.reason,
        approved: false,
        recommendation: e.payload.recommendation,
      });
    });

    this.bus.onAny((evt) => this.broadcast(evt));

    this.agents = { price, risk, strategy, coordinator, execution, macro };
    await this.ctx.storage.setAlarm(Date.now() + this.cfg.TICK_INTERVAL_MS);
  }

  // ────── alarm tick ──────

  override async alarm(): Promise<void> {
    try {
      await this.boot();
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err);
      if (msg.includes(NOT_REGISTERED)) return; // silently skip unregistered DOs
      console.error('[do] boot failed in alarm', err);
      return;
    }
    if (!this.agents) return;
    try {
      await Promise.all([
        this.agents.price.tick(),
        this.agents.risk.tick(),
        this.agents.macro.tick(),
      ]);
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

  async injectHumanDecision(
    decision: 'approve' | 'override',
    correlatesTo: string,
  ): Promise<void> {
    await this.boot();
    this.bus.emit(
      newEvent({
        source: 'bot',
        type: 'HUMAN_DECISION',
        payload: { decision, correlatesTo },
      }),
    );
  }

  async forceAction(action: 'REBALANCE' | 'HARVEST' | 'EXIT'): Promise<void> {
    await this.boot();
    this.bus.emit(
      newEvent({
        source: 'coordinator',
        type: 'APPROVED',
        payload: { action, reason: 'admin force' },
      }),
    );
  }

  async snapshot() {
    await this.boot();
    const events = await listEvents(this.env.DB, this.doId, 100);
    const decisions = await listDecisions(this.env.DB, this.doId, 50);
    return {
      doId: this.doId,
      wallet: this.user?.wallet,
      tokenId: this.user?.tokenId,
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
    await this.ctx.storage.put('range', range);
  }

  /** Re-authenticate after localStorage was cleared. Validates the PK still derives the stored
   *  wallet, validates the wallet still owns the position, and rotates the session token. */
  async resume(args: { privateKey: `0x${string}`; sessionTokenHash: string }): Promise<{ doId: string }> {
    this.user = (await this.ctx.storage.get<StoredUser>('user')) ?? this.user;
    if (!this.user) throw new Error('not_registered');

    const derived = privateKeyToAccount(args.privateKey).address.toLowerCase();
    if (derived !== this.user.wallet.toLowerCase()) {
      throw new Error('private key does not match registered wallet');
    }

    // Re-validate ownership in case the NFT was transferred away.
    const { publicClient } = makeClients({ rpcUrl: this.cfg.RPC_URL, privateKey: args.privateKey });
    const owner = (await publicClient.readContract({
      address: this.cfg.positionManager,
      abi: [{ type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] }],
      functionName: 'ownerOf',
      args: [BigInt(this.user.tokenId)],
    })) as `0x${string}`;
    if (owner.toLowerCase() !== this.user.wallet.toLowerCase()) {
      throw new Error('wallet no longer owns the registered position');
    }

    // Rotate session token + persist new PK.
    this.user = { ...this.user, privateKey: args.privateKey, sessionTokenHash: args.sessionTokenHash };
    await this.ctx.storage.put('user', this.user);

    // Ensure agents are alive.
    await this.ctx.storage.setAlarm(Date.now() + 1000);

    this.doId =
      (await this.ctx.storage.get<string>('doId')) ??
      deriveDoId(this.user.wallet, BigInt(this.user.tokenId));
    return { doId: this.doId };
  }

  /** Update mutable per-user settings without unregistering. Validates session before applying. */
  async updateSettings(args: {
    sessionTokenHash: string;
    telegramChatId?: string | null;
    stableCurrency?: string | null;
  }): Promise<{ ok: true }> {
    this.user = (await this.ctx.storage.get<StoredUser>('user')) ?? this.user;
    if (!this.user) throw new Error('not_registered');
    if (this.user.sessionTokenHash !== args.sessionTokenHash) throw new Error('forbidden');

    const next: StoredUser = {
      ...this.user,
      telegramChatId: args.telegramChatId === null ? undefined : args.telegramChatId ?? this.user.telegramChatId,
      stableCurrency: args.stableCurrency === null ? undefined : args.stableCurrency ?? this.user.stableCurrency,
    };
    this.user = next;
    await this.ctx.storage.put('user', next);

    // Force re-boot so Telegram listener and stable-currency wiring pick up new values on next alarm.
    this.booted = false;
    this.agents = null;
    await this.ctx.storage.setAlarm(Date.now() + 1000);

    return { ok: true };
  }

  /**
   * Called from the Execution Agent when a REBALANCE tx mints a fresh LP NFT.
   * Repoints the worker at the new tokenId, refreshes positionMeta + range, and
   * resets the entry price so the Risk Agent's IL math restarts from the rebalance moment.
   */
  private async handleNewPosition(newTokenId: bigint, publicClient: PublicClient): Promise<void> {
    this.activeTokenId = newTokenId;
    await this.ctx.storage.put('activeTokenId', newTokenId.toString());

    this.entryPrice = undefined;
    await this.ctx.storage.delete('entryPrice');

    let meta: import('./chain/position').PositionMetadata | undefined;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const m = await readPositionMetadata(publicClient, this.cfg.positionManager, newTokenId);
        if (m.tickLower !== 0 || m.tickUpper !== 0) {
          meta = m;
          break;
        }
      } catch (err) {
        console.error(`[do] readPositionMetadata attempt ${attempt + 1} threw`, err);
      }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }

    if (!meta) {
      console.error(`[do] gave up refreshing positionMeta for tokenId=${newTokenId} after retries`);
      return;
    }

    this.positionMeta = meta;
    this.range = { tickLower: meta.tickLower, tickUpper: meta.tickUpper };
    await this.ctx.storage.put('range', this.range);
    console.log(
      `[do] active position is now tokenId=${newTokenId} range=${this.range.tickLower}..${this.range.tickUpper}`,
    );
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
      try {
        await this.boot();
      } catch (err) {
        const msg = String(err instanceof Error ? err.message : err);
        if (msg.includes(NOT_REGISTERED)) {
          return new Response('not registered', { status: 404 });
        }
        throw err;
      }
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('not found', { status: 404 });
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
