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
                │           ├ Strategy (Claude)
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
                Uniswap API ─ pool state every 10s
                viem ───────── tx submit on Unichain Sepolia
                Anthropic ──── Claude Sonnet 4.6 (cached)
                Telegram ───── escalation messages
```

## The five agents

- **Price** — polls the Uniswap API every 10s. Emits `PRICE_UPDATE` and `OUT_OF_RANGE` when the tick crosses the position bounds.
- **Risk** — computes IL from `(priceEntry, priceNow)` each tick. Emits `IL_THRESHOLD_BREACH` / `POSITION_HEALTHY` / `FEE_HARVEST_READY`.
- **Strategy** — listens for trigger events (`OUT_OF_RANGE`, `IL_THRESHOLD_BREACH`, etc.), passes recent context to Claude Sonnet 4.6 with prompt caching + the `recommend_action` tool, emits a structured `STRATEGY_RECOMMENDATION`.
- **Coordinator** — applies deterministic rules (min confidence, supporting signal, daily tx cap, cooldown). Either emits `APPROVED` or `ESCALATE`.
- **Execution** — the only agent with access to the wallet. On `APPROVED` it submits a tx via viem and emits `TX_SUBMITTED` → `TX_CONFIRMED` (or `TX_FAILED`).

## Tech stack

| Layer | Tech |
|---|---|
| Agent runtime | Cloudflare Workers + 1 Durable Object (`HydraDO`) |
| Event bus | Tiny typed `EventEmitter` (no `node:events`) |
| LLM | `claude-sonnet-4-6` via `@anthropic-ai/sdk` with ephemeral prompt caching |
| Chain interaction | `viem` + `@uniswap/v4-sdk` + Uniswap Pool API |
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
│   │   │   ├── chain/{client,pool,position,il,plan,submit}.ts
│   │   │   ├── llm/{prompt,claude}.ts
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

### 3. Set the pool target

In `packages/worker/wrangler.toml`, replace `POOL_ID` and `POSITION_MANAGER` with the WETH/USDC v4 pool you want to manage on Unichain Sepolia (chainId 1301).

### 4. Create the D1 database

```bash
cd packages/worker
npx wrangler d1 create hydra
# copy the printed `database_id` into wrangler.toml's [[d1_databases]] block
npm run db:migrate:local
```

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
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put PRIVATE_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN     # optional
npx wrangler secret put TELEGRAM_CHAT_ID       # optional
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
   - Strategy agent calls Claude → emits `STRATEGY_RECOMMENDATION` with `REBALANCE`
   - Coordinator emits `APPROVED`
   - Execution agent emits `TX_SUBMITTED` → `TX_CONFIRMED`
4. Tx hash is visible at `https://sepolia.uniscan.xyz/tx/<hash>`.

## Why this design

- **Reliability** — five specialized agents with narrow scopes. Each can be reasoned about and replaced independently.
- **Transparency** — every agent emit is persisted to D1 and fanned out over WebSocket. The dashboard is a thin renderer of the same event stream.
- **Composability** — agents are constructed with dependency-injection-shaped deps (`fetcher`, `sample`, `submit`, `client`). Swap any of them without touching the others.
- **Cloudflare-native** — one Durable Object, one D1, one Pages deployment. No long-running boxes, no queues to babysit, free tier covers it.

See `FEEDBACK.md` for our notes on the Uniswap API + v4 SDK developer experience.
