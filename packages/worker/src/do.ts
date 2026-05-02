import { DurableObject } from 'cloudflare:workers';
import type { PublicClient } from 'viem';
import type { Env, Config } from './config';
import { loadConfig } from './config';
import { Bus } from './bus';
import { newEvent, newId } from './ids';
import type { HydraEvent } from './events';
import { attachArchiver, listEvents, listDecisions, writeDecision } from './store/d1';
import { deriveDoId } from './store/users';
import { fetchPoolState, priceFromSqrtX96, type PoolState } from './chain/pool';
import { readErc20Metadata, type TokenMetadata } from './chain/erc20';
import { makeClients } from './chain/client';
import { readPositionMetadata } from './chain/position';
import { readPositionFees } from './chain/state-view';
import { LLMClient, type PreferenceProfile } from './llm/client';
import { PriceAgent } from './agents/price';
import { RiskAgent } from './agents/risk';
import { StrategyAgent } from './agents/strategy';
import { Coordinator } from './agents/coordinator';
import { ExecutionAgent } from './agents/execution';
import { MacroAgent } from './agents/macro';
import { makeSubmit } from './chain/submit';
import { attachTelegramSender } from './bot/telegram';
import { privateKeyToAccount } from 'viem/accounts';
import { saveDecisionContext, saveOutcome, updateOutcome, savePreference, listPreferences, getDecisionContext } from './store/learning';
import { upsertExperience } from './store/vectorize';
import { buildRetrievalContext } from './llm/retrieval';
import { buildFeatureContextFromPool, buildFeatureVector } from './llm/feature-vector';
import { scoreDecision, type ScoringSnapshot } from './chain/scoring';
import { calibrateThresholds, computePreferenceProfile, type CoordinatorThresholds } from './agents/calibrator';

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

  // ── learning state ──
  private preferenceProfile?: PreferenceProfile;
  private adaptedThresholds?: CoordinatorThresholds;
  private lastCalibrationTs = 0;
  private pendingScoring: Record<string, {
    ts: number;
    score4hDue: number;
    score24hDue: number;
    scored4h: boolean;
    scored24h: boolean;
    snapshot: ScoringSnapshot;
  }> = {};

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.cfg = loadConfig(env);
  }

  // ────── registration ──────

  async register(args: {
    wallet: `0x${string}`;       // CONNECTED / SIGNER wallet — canonical identity
    tokenId: string;
    privateKey: `0x${string}`;
    telegramChatId?: string;
    stableCurrency?: string;
    sessionTokenHash: string;
  }): Promise<{ doId: string; range: Range }> {
    // Derive the owner from the supplied private key and validate it owns the NFT.
    const owner = privateKeyToAccount(args.privateKey).address.toLowerCase() as `0x${string}`;
    const { publicClient } = makeClients({ rpcUrl: this.cfg.RPC_URL, privateKey: args.privateKey });
    const tokenId = BigInt(args.tokenId);
    const onChainOwner = (await publicClient.readContract({
      address: this.cfg.positionManager,
      abi: [{ type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] }],
      functionName: 'ownerOf',
      args: [tokenId],
    })) as `0x${string}`;
    if (onChainOwner.toLowerCase() !== owner) {
      throw new Error(`tokenId ${args.tokenId} is owned by ${onChainOwner}, not ${owner} (derived from PK)`);
    }

    // doId is keyed by the SIGNER (connected) wallet — canonical identity.
    this.doId = deriveDoId(args.wallet, tokenId);
    this.activeTokenId = tokenId;

    // Best-effort metadata read — gives the dashboard the real range immediately.
    let initialRange: Range = { tickLower: -887200, tickUpper: 887200 };
    try {
      const meta = await readPositionMetadata(publicClient, this.cfg.positionManager, tokenId);
      initialRange = { tickLower: meta.tickLower, tickUpper: meta.tickUpper };
    } catch (err) {
      console.warn('[do.register] positionMeta read failed; will retry in alarm', err);
    }

    // Store user record. wallet here is the OWNER (PK-derived) — kept for re-validation on resume.
    const user: StoredUser = {
      wallet: owner,
      tokenId: args.tokenId,
      privateKey: args.privateKey,
      telegramChatId: args.telegramChatId,
      stableCurrency: args.stableCurrency,
      sessionTokenHash: args.sessionTokenHash,
    };
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

    // Load adapted thresholds + preference profile from storage.
    this.adaptedThresholds = await this.ctx.storage.get<CoordinatorThresholds>('adaptedThresholds');
    this.lastCalibrationTs = (await this.ctx.storage.get<number>('lastCalibrationTs')) ?? 0;
    this.pendingScoring = (await this.ctx.storage.get<typeof this.pendingScoring>('pendingScoring')) ?? {};
    const storedProfile = await this.ctx.storage.get<PreferenceProfile>('preferenceProfile');
    if (storedProfile) this.preferenceProfile = storedProfile;

    // Wire retrieval context provider so LLM calls get few-shot examples + preference.
    claude.setContextProvider(async () => {
      const pool = this.latestPool;
      if (!pool || !this.positionMeta) return {};
      try {
        const priceTicks = price.getRecentTicks().map((t) => t.tick);
        const featureCtx = buildFeatureContextFromPool(
          pool, priceTicks, 0, 0.75,
          price.getTimeInRangePct(),
          this.range.tickLower, this.range.tickUpper,
        );
        const retrieval = await buildRetrievalContext({
          vectorize: this.env.VECTORIZE,
          db: this.env.DB,
          featureCtx,
        });
        return { fewShotBlock: retrieval.fewShotBlock || undefined, preferenceProfile: this.preferenceProfile };
      } catch {
        return { preferenceProfile: this.preferenceProfile };
      }
    });

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
      dailyTxCap: this.adaptedThresholds?.dailyTxCap ?? this.cfg.DAILY_TX_CAP,
      cooldownSec: this.adaptedThresholds?.cooldownSec ?? this.cfg.COOLDOWN_SEC,
      minConfidence: this.adaptedThresholds?.minConfidence ?? this.cfg.MIN_CONFIDENCE,
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
      // Queue scoring if we have enough state.
      void this.queueScoring(e.id, e.ts, e.payload.action);
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

    // Preference learning: log Telegram approve/reject to build personal style profile.
    this.bus.on('HUMAN_DECISION', (e) => {
      void this.recordPreference(e.payload.decision === 'approve' ? 'approve' : 'reject', e.payload.correlatesTo);
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
    // Process pending scoring jobs (4h / 24h windows).
    await this.processPendingScoring();
    // Daily calibration check.
    if (Date.now() - this.lastCalibrationTs > 24 * 3600 * 1000) {
      void this.runCalibration();
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

  async simulateEscalation(): Promise<void> {
    await this.boot();
    this.bus.emit(
      newEvent({
        source: 'coordinator',
        type: 'ESCALATE',
        payload: {
          reason: 'Demo escalation triggered manually.',
          correlatesTo: newId(),
          recommendation: {
            action: 'REBALANCE',
            confidence: 0.72,
            rationale: 'Demo escalation — simulated for testing.',
          },
        },
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

  /** Re-authenticate after localStorage was cleared. Validates the new PK derives a wallet
   *  that currently owns the position on-chain, then rotates the session token and stored PK. */
  async resume(args: { privateKey: `0x${string}`; sessionTokenHash: string }): Promise<{ doId: string }> {
    this.user = (await this.ctx.storage.get<StoredUser>('user')) ?? this.user;
    if (!this.user) throw new Error('not_registered');

    const newOwner = privateKeyToAccount(args.privateKey).address.toLowerCase() as `0x${string}`;
    const { publicClient } = makeClients({ rpcUrl: this.cfg.RPC_URL, privateKey: args.privateKey });
    const onChainOwner = (await publicClient.readContract({
      address: this.cfg.positionManager,
      abi: [{ type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] }],
      functionName: 'ownerOf',
      args: [BigInt(this.user.tokenId)],
    })) as `0x${string}`;
    if (onChainOwner.toLowerCase() !== newOwner) {
      throw new Error('PK does not derive a wallet that owns this position');
    }

    // Update stored owner + PK + session token. doId is unchanged (keyed by signer wallet).
    this.user = {
      ...this.user,
      wallet: newOwner,           // owner can change if user rotated keys
      privateKey: args.privateKey,
      sessionTokenHash: args.sessionTokenHash,
    };
    await this.ctx.storage.put('user', this.user);
    await this.ctx.storage.setAlarm(Date.now() + 1000);

    this.doId = (await this.ctx.storage.get<string>('doId')) ?? this.doId;
    return { doId: this.doId };
  }

  /** Update mutable per-user settings without unregistering. Validates session before applying. */
  async updateSettings(args: {
    sessionTokenHash: string;
    telegramChatId?: string | null;
    stableCurrency?: string | null;
    tokenId?: string;           // rotate to a different LP position
    privateKey?: `0x${string}`; // rotate to a different signing key (may change owner)
  }): Promise<{ ok: true; ownerWallet?: `0x${string}`; tokenId?: string }> {
    this.user = (await this.ctx.storage.get<StoredUser>('user')) ?? this.user;
    if (!this.user) throw new Error('not_registered');
    if (this.user.sessionTokenHash !== args.sessionTokenHash) throw new Error('forbidden');

    const nextPrivateKey = args.privateKey ?? this.user.privateKey;
    const nextTokenId = args.tokenId ?? this.user.tokenId;
    const newOwner = privateKeyToAccount(nextPrivateKey).address.toLowerCase() as `0x${string}`;

    const pkChanged = args.privateKey != null;
    const tokenChanged = args.tokenId != null && args.tokenId !== this.user.tokenId;

    // Re-validate ownership when PK or tokenId changes.
    if (pkChanged || tokenChanged) {
      const { publicClient } = makeClients({ rpcUrl: this.cfg.RPC_URL, privateKey: nextPrivateKey });
      const owner = (await publicClient.readContract({
        address: this.cfg.positionManager,
        abi: [{ type: 'function', name: 'ownerOf', stateMutability: 'view',
          inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] }],
        functionName: 'ownerOf',
        args: [BigInt(nextTokenId)],
      })) as `0x${string}`;
      if (owner.toLowerCase() !== newOwner) {
        throw new Error(`tokenId ${nextTokenId} is owned by ${owner}, not ${newOwner} (derived from PK)`);
      }
    }

    const next: StoredUser = {
      ...this.user,
      privateKey: nextPrivateKey,
      tokenId: nextTokenId,
      wallet: newOwner,
      telegramChatId: args.telegramChatId === null ? undefined : args.telegramChatId ?? this.user.telegramChatId,
      stableCurrency: args.stableCurrency === null ? undefined : args.stableCurrency ?? this.user.stableCurrency,
    };

    // Capture tokenChanged before we mutate this.user.
    if (tokenChanged) {
      this.activeTokenId = BigInt(nextTokenId);
      await this.ctx.storage.delete('range');
      await this.ctx.storage.delete('entryPrice');
      await this.ctx.storage.put({ user: next, activeTokenId: nextTokenId });
    } else {
      await this.ctx.storage.put('user', next);
    }
    this.user = next;

    // Force re-boot so agents pick up new keys / chat id / stable currency.
    this.booted = false;
    this.agents = null;
    await this.ctx.storage.setAlarm(Date.now() + 1000);

    return (pkChanged || tokenChanged)
      ? { ok: true, ownerWallet: newOwner, tokenId: nextTokenId }
      : { ok: true };
  }

  // ────── learning helpers ──────

  private async queueScoring(decisionId: string, ts: number, action: string): Promise<void> {
    if (!this.positionMeta || !this.tokenMeta || !this.latestPool) return;
    const pool = this.latestPool;
    const priceNow = priceFromSqrtX96(pool.sqrtPriceX96, pool.token0.decimals, pool.token1.decimals);
    let feesNow = 0;
    try {
      const { fees0, fees1 } = await readPositionFees({
        client: makeClients({ rpcUrl: this.cfg.RPC_URL, privateKey: this.user!.privateKey }).publicClient,
        stateView: this.cfg.stateView,
        poolId: this.positionMeta.poolId,
        positionManager: this.cfg.positionManager,
        tokenId: this.activeTokenId,
        tickLower: this.positionMeta.tickLower,
        tickUpper: this.positionMeta.tickUpper,
      });
      const f0 = Number(fees0) / 10 ** pool.token0.decimals;
      const f1 = Number(fees1) / 10 ** pool.token1.decimals;
      feesNow = f0 * priceNow + f1;
    } catch { /* ignore */ }

    const snapshot: ScoringSnapshot = {
      priceEntry: this.entryPrice ?? priceNow,
      feesEarnedUsdAtDecision: feesNow,
      tickLower: this.positionMeta.tickLower,
      tickUpper: this.positionMeta.tickUpper,
      poolId: this.positionMeta.poolId,
      tokenId: this.activeTokenId,
      stableCurrency: this.user?.stableCurrency,
      token0: this.tokenMeta.token0,
      token1: this.tokenMeta.token1,
      tickSpacing: this.positionMeta.poolKey.tickSpacing,
      poolKey: this.positionMeta.poolKey,
    };

    // Build feature vector for the decision context.
    const priceTicks = this.agents?.price.getRecentTicks().map((t) => t.tick) ?? [];
    const featureCtx = buildFeatureContextFromPool(pool, priceTicks, 0, 0.75, this.agents?.price.getTimeInRangePct() ?? 0, snapshot.tickLower, snapshot.tickUpper);
    const featureVector = buildFeatureVector(featureCtx);

    await saveDecisionContext(this.env.DB, {
      id: decisionId,
      doId: this.doId,
      ts,
      action,
      poolId: this.positionMeta.poolId,
      featureVector,
      contextSnapshot: {
        price: priceNow,
        range: { tickLower: snapshot.tickLower, tickUpper: snapshot.tickUpper },
        feesEarnedUsd: feesNow,
        tick: pool.tick,
      },
    });

    await saveOutcome(this.env.DB, {
      decisionId,
      doId: this.doId,
      ts,
      vectorized: 0,
    });

    this.pendingScoring[decisionId] = {
      ts,
      score4hDue: ts + 4 * 3600 * 1000,
      score24hDue: ts + 24 * 3600 * 1000,
      scored4h: false,
      scored24h: false,
      snapshot,
    };
    await this.ctx.storage.put('pendingScoring', this.pendingScoring);
  }

  private async processPendingScoring(): Promise<void> {
    const now = Date.now();
    const toScore = Object.entries(this.pendingScoring).filter(
      ([, job]) => (!job.scored4h && now >= job.score4hDue) || (!job.scored24h && now >= job.score24hDue),
    );
    if (!toScore.length) return;

    const { publicClient } = makeClients({ rpcUrl: this.cfg.RPC_URL, privateKey: this.user!.privateKey });

    for (const [decisionId, job] of toScore) {
      try {
        const result = await scoreDecision({
          client: publicClient,
          stateView: this.cfg.stateView,
          positionManager: this.cfg.positionManager,
          snapshot: job.snapshot,
        });

        const is4h = !job.scored4h && now >= job.score4hDue;
        const is24h = !job.scored24h && now >= job.score24hDue;

        const patch: Parameters<typeof updateOutcome>[2] = {};
        if (is4h) {
          patch.score4h = result.score;
          patch.feeDeltaUsd = result.feeDeltaUsd;
          patch.ilDeltaPct = result.ilDeltaPct;
          patch.rangeAdherence4h = result.rangeAdherence;
          job.scored4h = true;
        }
        if (is24h) {
          patch.score24h = result.score;
          patch.rangeAdherence24h = result.rangeAdherence;
          patch.netPnlVsHold = result.netPnlVsHold;
          job.scored24h = true;
        }
        await updateOutcome(this.env.DB, decisionId, patch);

        // After 24h score: upsert to Vectorize for cross-user retrieval.
        if (is24h && this.env.VECTORIZE) {
          const ctx = await getDecisionContext(this.env.DB, decisionId);
          if (ctx) {
            try {
              await upsertExperience(this.env.VECTORIZE, decisionId, ctx.featureVector, {
                decision_id: decisionId,
                do_id: this.doId,
                action: ctx.action,
                score_4h: result.score,
                score_24h: result.score,
              });
              await updateOutcome(this.env.DB, decisionId, { vectorized: 1 });
            } catch {
              await updateOutcome(this.env.DB, decisionId, { vectorized: 0 });
            }
          }
        }

        // Remove from pending once both windows scored.
        if (job.scored4h && job.scored24h) {
          delete this.pendingScoring[decisionId];
        }
      } catch (err) {
        console.error(`[do] scoring failed for ${decisionId}`, err);
      }
    }
    await this.ctx.storage.put('pendingScoring', this.pendingScoring);
  }

  private async recordPreference(decision: 'approve' | 'reject', correlatesTo: string): Promise<void> {
    if (!this.latestPool || !this.positionMeta) return;
    const pool = this.latestPool;
    const priceTicks = this.agents?.price.getRecentTicks().map((t) => t.tick) ?? [];
    const featureCtx = buildFeatureContextFromPool(pool, priceTicks, 0, 0.75, this.agents?.price.getTimeInRangePct() ?? 0, this.range.tickLower, this.range.tickUpper);
    const featureVector = buildFeatureVector(featureCtx);

    await savePreference(this.env.DB, {
      id: newId(),
      doId: this.doId,
      ts: Date.now(),
      featureVector,
      decision,
      correlatesTo,
    });

    // Recompute preference profile and cache in DO storage.
    const all = await listPreferences(this.env.DB, this.doId);
    this.preferenceProfile = computePreferenceProfile(all);
    await this.ctx.storage.put('preferenceProfile', this.preferenceProfile);
  }

  private async runCalibration(): Promise<void> {
    const current: CoordinatorThresholds = {
      minConfidence: this.adaptedThresholds?.minConfidence ?? this.cfg.MIN_CONFIDENCE,
      cooldownSec: this.adaptedThresholds?.cooldownSec ?? this.cfg.COOLDOWN_SEC,
      dailyTxCap: this.adaptedThresholds?.dailyTxCap ?? this.cfg.DAILY_TX_CAP,
    };
    try {
      const best = await calibrateThresholds(this.env.DB, this.doId, current);
      if (best) {
        this.adaptedThresholds = best;
        await this.ctx.storage.put('adaptedThresholds', best);
        console.log('[do] calibrated thresholds', best);
      }
    } catch (err) {
      console.error('[do] calibration failed', err);
    }
    this.lastCalibrationTs = Date.now();
    await this.ctx.storage.put('lastCalibrationTs', this.lastCalibrationTs);
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
