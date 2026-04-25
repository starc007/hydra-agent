# Hydra

**Multi-agent liquidity coordination on Uniswap v4 — entirely on Cloudflare.**

Five specialized AI agents collaboratively manage a Uniswap v4 LP position on Unichain Sepolia. They communicate over an in-process event bus inside a single Durable Object, reach consensus, then execute on-chain via viem. When the agents disagree or threshold rules trip, a human gets pinged on Telegram.

---

## Architecture

```
                   Cloudflare Worker
                        │
            ┌───────────┴────────────┐
            ▼                        ▼
    fetch / scheduled         Telegram /telegram webhook
            │                        │
            └────────────┬───────────┘
                         ▼
                ┌─────────────────────┐
                │     HydraDO         │   (one Durable Object instance)
                │                     │
                │   ┌─────────────┐   │
                │   │  EventBus   │   │
                │   └──────┬──────┘   │
                │          │          │
                │  Price ─┤├─ Risk    │
                │           ├ Strategy (LLM)
                │           ├ Coordinator
                │           └ Execution
                └────┬────────────┬───┘
                     │            │
                     ▼            ▼
                  D1 (sql)   WS to dashboard
                                   │
                                   ▼
                          Cloudflare Pages
                          (Next.js static)

                Outbound:
                ──────────────────────────────────────────
                StateView ──── pool state every 10s (on-chain, no key)
                viem ───────── tx submit on Unichain Sepolia
                LLM ────────── Anthropic / Google / OpenAI (configurable)
                Telegram ───── escalation messages
```

## The five agents

- **Price** — polls the Uniswap API every 10s. Emits `PRICE_UPDATE` and `OUT_OF_RANGE` when the tick crosses the position bounds.
- **Risk** — computes IL from `(priceEntry, priceNow)` each tick. Emits `IL_THRESHOLD_BREACH` / `POSITION_HEALTHY` / `FEE_HARVEST_READY`.
- **Strategy** — listens for trigger events (`OUT_OF_RANGE`, `IL_THRESHOLD_BREACH`, etc.), passes recent context to the configured LLM (Anthropic / Google / OpenAI) with prompt caching (Anthropic only) via `generateObject`, emits a structured `STRATEGY_RECOMMENDATION`.
- **Coordinator** — applies deterministic rules (min confidence, supporting signal, daily tx cap, cooldown). Either emits `APPROVED` or `ESCALATE`.
- **Execution** — the only agent with access to the wallet. On `APPROVED` it submits a tx via viem and emits `TX_SUBMITTED` → `TX_CONFIRMED` (or `TX_FAILED`).

## Tech stack

| Layer | Tech |
|---|---|
| Agent runtime | Cloudflare Workers + 1 Durable Object (`HydraDO`) |
| Event bus | Tiny typed `EventEmitter` (no `node:events`) |
| LLM | Anthropic / Google / OpenAI via Vercel AI SDK (default `claude-sonnet-4-6`; switch via `LLM_PROVIDER`) — prompt caching on Anthropic |
| Chain interaction | `viem` + on-chain reads via Uniswap v4 `StateView` (no hosted API dependency) |
| Network | Unichain Sepolia (chainId 1301) |
| Storage | D1 (SQLite) — events + decisions persistence |
| Real-time | Durable Object WebSocket Hibernation API |
| Periodic ticks | DO alarms self-rescheduling every 10s + Cron `* * * * *` kicker |
| Escalation | Telegram Bot API (webhook mode) |
| Dashboard | Next.js 15 static export → Cloudflare Pages |

## Project layout

```
hydra-agent/
├── packages/
│   ├── worker/                 # Cloudflare Worker + HydraDO
│   │   ├── src/
│   │   │   ├── index.ts            # fetch + scheduled + telegram webhook
│   │   │   ├── do.ts               # HydraDO — boots bus, agents, alarms, WS
│   │   │   ├── bus.ts              # tiny typed event emitter
│   │   │   ├── events.ts           # event type union (single source of truth)
│   │   │   ├── ids.ts              # uuid + event factory
│   │   │   ├── config.ts           # zod-validated env -> Config
│   │   │   ├── agents/{base,price,risk,strategy,coordinator,execution}.ts
│   │   │   ├── chain/{client,pool,position,il,plan,submit,actions,state-view,tick-math,liquidity-amounts,erc20}.ts
│   │   │   ├── llm/{prompt,client}.ts
│   │   │   ├── store/d1.ts
│   │   │   └── bot/telegram.ts
│   │   ├── migrations/0001_init.sql
│   │   ├── scripts/set-webhook.ts
│   │   └── wrangler.toml
│   └── dashboard/              # Next.js static-export → Cloudflare Pages
│       ├── app/{layout,page,globals.css}
│       ├── components/{agent-status,live-feed,position-panel,decision-log}.tsx
│       ├── lib/ws.ts               # WS hook + snapshot fetch
│       └── wrangler.toml
├── FEEDBACK.md                 # Uniswap API + v4 SDK DX notes
└── README.md
```

## Quickstart (local)

### 1. Install

```bash
git clone <this-repo>
cd hydra-agent
npm install
```

### 2. Provision local secrets

```bash
cp .dev.vars.example packages/worker/.dev.vars
# fill in:
#   ANTHROPIC_API_KEY=sk-ant-...
#   PRIVATE_KEY=0x...                  # funded Unichain Sepolia wallet
#   TELEGRAM_BOT_TOKEN=...              # optional (escalation)
#   TELEGRAM_CHAT_ID=...                # optional
#   UNISWAP_API_KEY=                    # optional
```

### 3. Set the pool + position target

In `packages/worker/wrangler.toml`:
- `POOL_ID` and `POSITION_MANAGER` — the v4 pool you want to manage on Unichain Sepolia (chainId 1301).
- `STATE_VIEW` — the v4 `StateView` lens contract address on Unichain Sepolia (used for fee reads).
- `TOKEN_ID` — your LP NFT id from PositionManager.
- `POSITION_TICK_LOWER` / `POSITION_TICK_UPPER` — your position's range. The DO seeds `range` from these on first boot; afterwards the stored value wins (settable at runtime via `POST /admin/range`).
- `STABLE_CURRENCY` — address of the USD-stable token in the pool (used for fee USD conversion). Leave empty to fall back to "token1 is stable".
- `SLIPPAGE_BPS` — basis points of slippage tolerance for rebalances (default `50` = 0.5%).

### 4. Create the D1 database

```bash
cd packages/worker
npx wrangler d1 create hydra
# copy the printed `database_id` into wrangler.toml's [[d1_databases]] block
npm run db:migrate:local
```

### 4b. (optional) Helper scripts

If you need to mint a new v4 LP position or list the ones you already own:

```bash
cd packages/worker

# enumerate your v4 LP NFTs (auto-uses wallet from .dev.vars)
npm run position:list

# mint a new position (Unichain Sepolia, ERC20-ERC20 pair)
npm run position:create -- \
  --tokenA 0x... --tokenB 0x... \
  --fee 3000 --tickSpacing 60 \
  --tickLower -300 --tickUpper 300 \
  --amount0 1000000000000000000 --amount1 1000000 \
  [--initialPriceX96 79228162514264337593543950336]   # only if pool not yet initialized
```

`position:create` handles pool initialization (if needed), Permit2 setup (idempotent), and prints the new `tokenId` you should paste into `wrangler.toml`.

### 5. Run

```bash
# terminal 1 — the worker
cd packages/worker
npm run dev

# terminal 2 — the dashboard
cd packages/dashboard
NEXT_PUBLIC_BACKEND=http://localhost:8787 npm run dev
```

Open `http://localhost:3000`. Within ~10s the live feed should start showing `PRICE_UPDATE` events.

## Deploy to Cloudflare

### Worker

```bash
cd packages/worker
# wallet (required)
npx wrangler secret put PRIVATE_KEY

# LLM key — push the one matching wrangler.toml's LLM_PROVIDER
npx wrangler secret put ANTHROPIC_API_KEY            # if LLM_PROVIDER=anthropic
npx wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY # if LLM_PROVIDER=google
npx wrangler secret put OPENAI_API_KEY               # if LLM_PROVIDER=openai

# optional
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put UNISWAP_API_KEY

npm run db:migrate:remote
npm run deploy
# note the *.workers.dev URL
```

### Telegram webhook

```bash
WORKER_URL=https://hydra.<acct>.workers.dev TELEGRAM_BOT_TOKEN=<token> npm run telegram:setwebhook
```

### Dashboard

Edit `packages/dashboard/wrangler.toml`'s `NEXT_PUBLIC_BACKEND` to point at the worker URL, then:

```bash
cd packages/dashboard
npm run deploy
```

## Demo flow

1. Open the dashboard. Watch `PRICE_UPDATE` events stream in.
2. Force the position out of range:
   ```bash
   curl -X POST https://hydra.<acct>.workers.dev/admin/range \
     -H 'content-type: application/json' \
     -d '{"tickLower": <T-30>, "tickUpper": <T+30>}'
   ```
3. Within one alarm tick (≤10s):
   - Price agent emits `OUT_OF_RANGE`
   - Strategy agent calls the configured LLM → emits `STRATEGY_RECOMMENDATION` with `REBALANCE`
   - Coordinator emits `APPROVED`
   - Execution agent emits `TX_SUBMITTED` → `TX_CONFIRMED`
4. Tx hash is visible at `https://sepolia.uniscan.xyz/tx/<hash>`.

## Why this design

- **Reliability** — five specialized agents with narrow scopes. Each can be reasoned about and replaced independently.
- **Transparency** — every agent emit is persisted to D1 and fanned out over WebSocket. The dashboard is a thin renderer of the same event stream.
- **Composability** — agents are constructed with dependency-injection-shaped deps (`fetcher`, `sample`, `submit`, `client`). Swap any of them without touching the others.
- **Cloudflare-native** — one Durable Object, one D1, one Pages deployment. No long-running boxes, no queues to babysit, free tier covers it.

See `FEEDBACK.md` for our notes on the Uniswap API + v4 SDK developer experience.
