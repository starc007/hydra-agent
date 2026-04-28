# Hydra

**Autonomous Uniswap v4 LP management — a multi-agent system on Cloudflare.**

Live: **https://hydra-dashboard-81h.pages.dev** · Worker: **https://hydra.saurabh10102.workers.dev**

Six specialized agents collaboratively monitor and manage a Uniswap v4 LP position on Unichain Sepolia. Five of them reason via LLM (Anthropic / Google / OpenAI, configurable); one stays deterministic for tx execution. They communicate over an in-process event bus inside a single Durable Object **per registered position**, archive every event to D1, and stream live state to a Twitter-style dashboard via WebSocket. When a recommendation requires human judgment, a Telegram bot escalates with inline ✅/❌ buttons.

Agents improve continuously through a four-layer learning loop: past decisions are scored against real outcomes (4h + 24h), similar situations are retrieved from a cross-user Vectorize index to prime LLM prompts, individual Telegram approve/reject signals shape a per-user preference model, and thresholds (`MIN_CONFIDENCE`, `COOLDOWN_SEC`, `DAILY_TX_CAP`) are recalibrated daily via grid search against historical scores.

---

## Architecture

```
                Cloudflare Worker
                       │
            ┌──────────┴──────────┐
            ▼                     ▼
      fetch / scheduled     /telegram webhook
            │                     │
            │ (per-user routing by ?do=<id>)
            ▼
   ┌──────────────────────┐
   │ HydraDO              │   one DO per (signerWallet, tokenId)
   │ ┌──────────────────┐ │
   │ │   Event Bus      │ │
   │ └────────┬─────────┘ │
   │          │           │
   │  Price   │   Macro   │   ← polling agents (driven by alarm)
   │  Risk    │   Strategy│
   │          │           │
   │  Coordinator (LLM    │   ← reactive agents (driven by bus events)
   │  second-opinion)     │
   │          │           │
   │  Execution           │   ← only deterministic agent;
   │   (viem + v4 actions │     signs txs with the user's PK
   │    encoding)         │
   └────┬────────────┬────┘
        │            │
        ▼            ▼
     D1 (sql)   WebSocket → Cloudflare Pages dashboard

                Outbound
        ────────────────────────────────────────
        StateView ───── pool state every 10s (on-chain, no key)
        viem ────────── tx submit on Unichain Sepolia
        LLM ─────────── Anthropic / Google / OpenAI (configurable)
        Telegram ────── escalation messages
```

Multi-tenancy: every registered position gets its own Durable Object, addressed by `keccak256(signerWallet || tokenId)`. State, alarm chain, agents, and WebSocket fan-out are isolated per user. The cron trigger (`* * * * *`) iterates the `users` table and `kick()`s up to 50 stale DOs each minute as a backup wakeup.

---

## The six agents

Five reason via LLM (with aggressive throttling — see "Cost discipline"); one is deliberately deterministic.

| Agent | LLM | Role | Throttle | Emits |
|---|---|---|---|---|
| **Price** | ✓ | Polls `StateView.getSlot0` every 10s, maintains a 30-tick rolling buffer, classifies the pattern | std-dev change >20% OR every 2 min | `PRICE_UPDATE`, `OUT_OF_RANGE`, `PRICE_PATTERN`, `VOLATILITY_SPIKE` |
| **Risk** | ✓ | Computes IL deterministically; LLM gives a verdict on health vs. fees | IL change ≥0.3pp OR every 5 min | `POSITION_HEALTHY`, `IL_THRESHOLD_BREACH`, `FEE_HARVEST_READY`, `RISK_ANALYSIS` |
| **Strategy** | ✓ | Triggered by Price/Risk events; recommends `HOLD` / `REBALANCE` / `HARVEST` / `EXIT` | Event-driven only | `STRATEGY_RECOMMENDATION` |
| **Coordinator** | ✓ | Rule-based gate (caps, cooldown, confidence). For marginal cases, LLM second-opinion can override | One LLM call per recommendation, only if marginal | `APPROVED`, `ESCALATE`, `COORDINATOR_REVIEW` |
| **Execution** | — | Encodes v4 `modifyLiquidities` calldata, applies slippage bands, pre-flights via `simulateContract`, submits, waits for receipt, rolls `activeTokenId` forward on rebalance mints | n/a | `TX_SUBMITTED`, `TX_CONFIRMED`, `TX_FAILED` |
| **Macro** | ✓ | Reads pool stats, characterizes broader market vibe | Every 5 min | `MARKET_CONTEXT` |

**Steady-state cost** (Gemini Flash): ~1 LLM call/min baseline + event-driven bursts ≈ **<$0.10/day per user**.

---

## Tech stack

| Layer | Tech |
|---|---|
| Agent runtime | Cloudflare Worker + 1 Durable Object per user (`HydraDO`) |
| Event bus | Tiny typed `EventEmitter` (no `node:events`) |
| LLM | Vercel AI SDK with Anthropic / Google / OpenAI (default `gemini-3.1-pro-preview`, configurable via `LLM_PROVIDER`) |
| Chain | viem + on-chain reads via Uniswap v4 `StateView`, `PositionManager`, raw `modifyLiquidities` action encoding |
| Network | Unichain Sepolia (chainId 1301) |
| Storage | D1 (SQLite) — events/decisions; users registry; escalation correlation; learning tables (decision contexts, outcomes, preferences, calibration log) |
| Vector store | Cloudflare Vectorize — 32-dim cosine index (`hydra-experience`), shared cross-user for few-shot retrieval |
| Real-time | Durable Object WebSocket Hibernation API |
| Periodic ticks | DO alarms self-rescheduling every 10s + Cron `* * * * *` kicker |
| Escalation | Telegram Bot API (webhook mode) |
| Dashboard | Next.js 15 static export → Cloudflare Pages |
| Wallet | Reown AppKit + wagmi v2 (WalletConnect, MetaMask, Coinbase, Rainbow, …) |
| UI | shadcn-style modular components, Tailwind, Inter, Uniswap docs palette (`#131313` / `#E501A5`) |
| Animations | `motion/react` (formerly framer-motion) |

---

## Identity model

Hydra separates **signer wallet** from **owner wallet**:

- **Signer wallet** — the wallet you connect via Reown. Canonical identity for sign-in. Used as the lookup key in `/api/lookup` and as the doId derivation: `keccak256(signerWallet || tokenId)`.
- **Owner wallet** — the wallet whose private key you paste during registration. Must own the LP NFT (validated via `PositionManager.ownerOf`). The agents sign rebalance txs as this wallet.

The two can be the same (typical) or different (the **burner-wallet pattern**: connect your hardware-wallet-protected main wallet for identity, paste a separate hot wallet's PK whose only job is to own the testnet NFT). The same private key can be registered under multiple signer wallets — each gets its own isolated DO instance.

> **Custodial, testnet only.** Private keys are stored in Cloudflare Durable Object storage so the agents can sign rebalances autonomously. **Use only on Unichain Sepolia testnet wallets.** Mainnet would require account abstraction (session keys, ERC-4337) — out of scope here.

---

## API surface

```
POST /api/register          { wallet, tokenId, privateKey, telegramChatId?, stableCurrency? }
                            → { doId, sessionToken, range }
POST /api/resume            { wallet, tokenId, privateKey }
                            → { doId, sessionToken }
POST /api/unregister        { doId } + x-hydra-session
POST /api/update            { doId, telegramChatId?, stableCurrency?, tokenId?, privateKey? }
                            + x-hydra-session
GET  /api/lookup?wallet=<a> → [{ doId, wallet, tokenId, registeredAt }]
GET  /api/preview-position?wallet=<a>&tokenId=<t>
                            → { owner, poolKey, poolId, tickLower, tickUpper, token0, token1, liquidity }
GET  /api/users             → [{ doId, wallet, tokenId }]
GET  /api/snapshot?do=<id>  → DO state + recent events + decisions
GET  /api/events?do=<id>    → archived events
GET  /api/decisions?do=<id> → archived APPROVED + ESCALATE
GET  /ws?do=<id>            → live event stream
POST /admin/force?do=<id>   { action } + x-hydra-session
POST /admin/range?do=<id>   { tickLower, tickUpper } + x-hydra-session
POST /telegram              ← Telegram webhook
GET  /health                → ok
```

`x-hydra-session` is the bearer-style session token returned at register/resume time. SHA-256 hash stored in DO storage.

---

## Project layout

```
hydra-agent/
├── packages/
│   ├── worker/                    # Cloudflare Worker + HydraDO
│   │   ├── src/
│   │   │   ├── index.ts                # routing, session auth, /api/*, /admin/*, cron fanout, /telegram webhook
│   │   │   ├── do.ts                   # HydraDO — per-user state, agents, alarms, WS broadcast
│   │   │   ├── bus.ts                  # tiny typed event emitter
│   │   │   ├── events.ts               # event type union (single source of truth)
│   │   │   ├── ids.ts                  # uuid + event factory
│   │   │   ├── config.ts               # zod-validated worker env
│   │   │   ├── agents/                 # base, price, risk, strategy, coordinator, execution, macro,
│   │   │   │                           # calibrator (threshold grid search)
│   │   │   ├── chain/                  # client, pool, position, il, plan, submit, actions,
│   │   │   │                           # state-view, tick-math, liquidity-amounts, erc20, scoring
│   │   │   ├── llm/                    # client (Vercel AI SDK + context provider), prompt (strategy),
│   │   │   │                           # prompts (per-agent), feature-vector, retrieval (Vectorize RAG)
│   │   │   ├── store/                  # d1 (events/decisions), users (registry + escalations),
│   │   │   │                           # learning (D1 CRUD for 4 learning tables), vectorize
│   │   │   └── bot/telegram.ts         # send/edit/parseCallback + escalation->doId D1 mapping
│   │   ├── migrations/                 # 0001 init, 0002 multi-tenant, 0003 signer_wallet,
│   │   │                               # 0004 learning (decision_contexts, outcomes, preferences, calibration_log)
│   │   ├── scripts/                    # set-webhook, list-positions, create-position
│   │   ├── contracts/MockToken.sol     # ERC20 used to deploy demo TKA/TKB pair
│   │   ├── foundry.toml
│   │   └── wrangler.toml
│   └── dashboard/                 # Next.js 15 static-export → Cloudflare Pages
│       ├── app/                        # page (orchestrator), layout, providers, globals.css
│       ├── components/
│       │   ├── ui/                     # button, card, input, select, badge, separator
│       │   ├── layout/                 # app-shell (3-col), brand-card
│       │   ├── agents/                 # agent-card, agent-list (LLM verdicts surfaced)
│       │   ├── feed/                   # live-feed, feed-row (motion entry, tx-link icons), filter pill
│       │   ├── position/               # position-panel, decision-log, actions-panel
│       │   ├── onboarding/             # connect-wallet, register-form, welcome-back, preview-card
│       │   └── settings/               # settings-dialog (edit telegram, stable, tokenId, PK)
│       ├── lib/                        # api, ws, wallet (wagmi hooks), wagmi, appkit, format,
│       │                               # event-format (friendly labels), storage, cn
│       └── wrangler.toml
├── FEEDBACK.md                    # Uniswap API + v4 SDK DX notes (required for prize)
└── README.md
```

---

## Quickstart (local)

### 1. Install

```bash
git clone <this-repo>
cd hydra-agent
npm install
```

### 2. Worker secrets

```bash
cp .dev.vars.example packages/worker/.dev.vars
# fill in:
#   ANTHROPIC_API_KEY    # if you'll use LLM_PROVIDER=anthropic
#   GOOGLE_GENERATIVE_AI_API_KEY  # if google (default)
#   OPENAI_API_KEY       # if openai
#   TELEGRAM_BOT_TOKEN   # optional — escalation
#   UNISWAP_API_KEY      # optional
```

### 3. Worker chain config (`packages/worker/wrangler.toml`)

These are deployment-wide (chain-level), not per-user:

| Var | Meaning |
|---|---|
| `LLM_PROVIDER` | `anthropic` / `google` / `openai` |
| `RPC_URL` | Unichain Sepolia RPC |
| `POSITION_MANAGER` | `0xf969aee60879c54baaed9f3ed26147db216fd664` |
| `STATE_VIEW` | `0xc199f1072a74d4e905aba1a84d9a45e2546b6222` |
| `SLIPPAGE_BPS` | basis points (default `50` = 0.5%) |
| `IL_THRESHOLD_PCT`, `DAILY_TX_CAP`, `COOLDOWN_SEC`, `MIN_CONFIDENCE`, `TICK_INTERVAL_MS` | Coordinator + risk knobs |

### 4. D1 database + Vectorize index

```bash
cd packages/worker
npx wrangler d1 create hydra
# copy the printed `database_id` into wrangler.toml's [[d1_databases]] block
npm run db:migrate:local

# Vectorize is remote-only — create the index once (skip for pure local dev)
npx wrangler vectorize create hydra-experience --dimensions=32 --metric=cosine
```

### 5. (Optional) Helper scripts — mint a demo position

If you don't already own a v4 LP NFT on Unichain Sepolia:

```bash
cd packages/worker

# enumerate your existing positions
npm run position:list

# deploy mock ERC20s + create a TKA/TKB pool + mint a position
forge build
forge create contracts/MockToken.sol:MockToken --rpc-url https://sepolia.unichain.org \
  --private-key $(grep PRIVATE_KEY .dev.vars | cut -d= -f2) --broadcast \
  --constructor-args "Hydra Token A" "TKA" 1000000000000000000000000000

forge create contracts/MockToken.sol:MockToken --rpc-url https://sepolia.unichain.org \
  --private-key $(grep PRIVATE_KEY .dev.vars | cut -d= -f2) --broadcast \
  --constructor-args "Hydra Token B" "TKB" 1000000000000000000000000000

npm run position:create -- \
  --tokenA <TKA_ADDR> --tokenB <TKB_ADDR> \
  --fee 3000 --tickSpacing 60 \
  --tickLower -300 --tickUpper 300 \
  --amount0 1000000000000000000 --amount1 1000000 \
  --initialPriceX96 79228162514264337593543950336
```

`position:create` handles pool initialization (if needed), Permit2 setup, and prints the new `tokenId`.

### 6. Dashboard env

```bash
# packages/dashboard/.env.local
NEXT_PUBLIC_BACKEND=http://localhost:8787
NEXT_PUBLIC_REOWN_PROJECT_ID=<your-projectId-from-cloud.reown.com>
```

### 7. Run

```bash
# terminal 1 — the worker
cd packages/worker
npm run dev

# terminal 2 — the dashboard
cd packages/dashboard
npm run dev
```

Open `http://localhost:3000`. Click **Connect wallet** → AppKit modal → register your position (paste PK + tokenId).

---

## Deploy to Cloudflare

### Worker

```bash
cd packages/worker
# one-time secrets
npx wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY   # or ANTHROPIC_API_KEY / OPENAI_API_KEY per LLM_PROVIDER
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put UNISWAP_API_KEY                # optional

# one-time: create Vectorize index (32-dim cosine for learning RAG)
npx wrangler vectorize create hydra-experience --dimensions=32 --metric=cosine

npm run db:migrate:remote
npm run deploy
```

### Telegram webhook (one-time after deploy)

```bash
WORKER_URL=https://hydra.<account>.workers.dev TELEGRAM_BOT_TOKEN=<token> npm run telegram:setwebhook
```

### Dashboard

```bash
cd packages/dashboard
NEXT_PUBLIC_BACKEND=https://hydra.<account>.workers.dev \
NEXT_PUBLIC_REOWN_PROJECT_ID=<projectId> \
  npm run build
npx wrangler pages deploy out --project-name=hydra-dashboard --branch=main
```

For Cloudflare Pages dashboard env vars: Settings → Environment variables → set `NEXT_PUBLIC_BACKEND` and `NEXT_PUBLIC_REOWN_PROJECT_ID` for both Production and Preview.

---

## Demo flow

1. Open the dashboard, connect a wallet via the Reown modal
2. Register a position — paste the private key for the wallet that owns your v4 LP NFT, plus the tokenId. Telegram chat ID is optional. The form previews ownership + liquidity before allowing submit
3. Watch the live feed start streaming events within ~10 s
4. Force a rebalance to exercise the full agentic chain:
   ```bash
   curl -X POST https://hydra.<acct>.workers.dev/admin/range \
     -H "x-hydra-session: <token>" -H "content-type: application/json" \
     -d '{"tickLower": <T-30>, "tickUpper": <T+30>}'
   ```
5. Observe the chain in the feed:
   ```
   PRICE_PATTERN          Price's LLM characterizes the move
   OUT_OF_RANGE           deterministic threshold trip
   RISK_ANALYSIS          Risk's LLM verdict
   STRATEGY_RECOMMENDATION Strategy's LLM picks an action
   COORDINATOR_REVIEW     Coordinator's LLM second-opinion (if marginal)
   APPROVED  /  ESCALATE  → Telegram if escalated
   TX_SUBMITTED → TX_CONFIRMED   real on-chain tx, hash clickable to Uniscan
   MARKET_CONTEXT         next 5-min Macro tick
   ```

The "All / LLM only" filter pill in the feed header switches between the firehose and just the 6 LLM-driven event types.

---

## Why this design

- **Multi-agent with deterministic guardrails** — the LLM proposes, deterministic rules dispose. Strategy can recommend anything; Coordinator's hard rules (daily tx cap, cooldown, min confidence) enforce safety. The LLM second-opinion only fires for marginal cases, not as a primary gate. You don't want Gemini deciding whether the daily tx cap is a good idea.
- **One DO per user** — isolated state, isolated alarm, isolated WebSocket. Cloudflare's free tier scales to thousands of users at zero ops cost.
- **Signer ≠ Owner** — connect your hardware-protected main wallet for identity, paste a burner's PK for signing. Hydra never touches the main key.
- **Observable end to end** — every agent decision is archived to D1 and broadcast over WebSocket. You can audit in real time which LLM said what and why.
- **No hosted-API dependency** — pool state reads via on-chain `StateView`. No Uniswap API key, no rate limits, works on any chain with v4 deployed.

See `FEEDBACK.md` for the Uniswap API + v4 SDK DX notes that came out of building this.

---

## Learning loop

Agents get better the longer they run. Four mechanisms cooperate:

### 1. Outcome scoring
Every `APPROVED` decision is queued for evaluation at two horizons — **4 h** and **24 h**. On each 10 s alarm tick the DO checks pending scoring jobs and, when a window is due, reads current on-chain state to compute a composite score:

```
score = 0.4 × feeDeltaNorm + 0.3 × ilDeltaNorm + 0.2 × rangeAdherence + 0.1 × pnlNorm
```

Mapped to `[-1, 1]` and written to the `outcomes` D1 table.

### 2. Vectorize RAG (cross-user few-shot retrieval)
At decision time a **32-dim feature vector** is built from the current pool state:

```
[priceTrend, ilPct, confidence, volatility, timeInRange, tickDistNorm, 0×26]
```

This is used to query `hydra-experience` (Cloudflare Vectorize, cosine, 32-dim) for the top-5 most similar past decisions that already have a positive 24 h score. Those decisions are formatted as few-shot examples and prepended to the system prompt for Strategy, Risk, and Coordinator LLM calls.

After the 24 h score is written, the vector is upserted to Vectorize so future users benefit from the outcome.

### 3. Preference model
Each Telegram ✅/❌ button press is logged to the `preferences` D1 table. After every feedback event the DO recomputes a per-user **preference profile**: the centroid of all approved feature vectors and the centroid of all rejected ones. This is injected into the Coordinator's system prompt as a natural-language hint, e.g.:

> User tends to approve when: priceTrend=0.62, ilPct=0.12 …  
> User tends to reject when: priceTrend=0.31, ilPct=0.48 …

### 4. Threshold calibration
Once at least 10 scored decisions have accumulated, a **daily grid search** runs over `{minConfidence, cooldownSec, dailyTxCap}` × recent `score_24h` history to find the parameter combination that would have produced the highest mean outcome. The winning thresholds are stored in DO state and used by the Coordinator in place of the static `wrangler.toml` defaults.

### Storage schema additions (migration `0004_learning.sql`)

| Table | Purpose |
|---|---|
| `decision_contexts` | Feature vector + pool snapshot at decision time |
| `outcomes` | 4 h / 24 h composite scores per decision |
| `preferences` | Per-user Telegram feedback log |
| `calibration_log` | Daily grid-search results per user |
