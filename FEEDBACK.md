# Uniswap API Feedback (Hydra)

## Context

Hydra is a multi-agent LP coordinator deployed entirely on Cloudflare
(Workers + Durable Object + D1 + Pages). This file logs DX observations
as we integrate the Uniswap API and v4 SDK.

## What we built on the Uniswap API surface

- **Hosted Pool API** — used for live pool state polling (tick, sqrtPriceX96, liquidity, fee, tickSpacing, token0/token1) on Unichain Sepolia. Polled every 10 seconds from the Durable Object alarm.
- **`@uniswap/v4-sdk`** — pulled in for tick-math types and `Pool` / `Position` references.
- **PositionManager ABI** — read `getPositionLiquidity` directly via viem.

## Discoverability

- Finding the right endpoint for v4 pool state on Unichain Sepolia required digging through release notes — the docs index didn't surface it. A `chainId=1301` worked, but the discovery felt incidental.
- We wished there was a single page that says: "for v4 on chain X, here is the pool endpoint, here is the position endpoint, here is the PositionManager address."

## v4 SDK ergonomics

- The biggest friction is building the `modifyLiquidities` calldata: the path from `Position` / `Pool` objects to the encoded `(actions, params[])` is not surfaced by the v4 SDK in any obvious way. We hand-rolled it from the periphery source — see `packages/worker/src/chain/actions.ts`. A `buildRebalance(poolKey, tokenId, newRange, recipient)` helper that returned `{ to, data, value }` would have saved a half day.
- `PositionInfo` is bit-packed in `getPoolAndPositionInfo` — the SDK should expose `decodePositionInfo(info)` returning `{ tickLower, tickUpper, hasSubscriber, poolId }`. We re-implemented this at `packages/worker/src/chain/position.ts:readPositionMetadata`.
- Fees-owed for a position requires reading both `StateView.getFeeGrowthInside(poolId, ...)` AND `StateView.getPositionInfo(poolId, positionManager, ...)` and computing `(insideNow - insideLast) * liquidity / Q128` with care for unchecked subtraction wrap. A first-class `getFeesOwed(positionManager, tokenId)` view (or SDK helper) would remove a lot of footgun surface.

## Endpoint coverage

- We needed: pool state by id, position state by tokenId, recommended new range for tightening/widening, and a pre-built calldata for rebalance. We had a clean path for the first two; the latter two we hand-rolled.

## Type / SDK quality

- Pool API JSON shape was predictable; no surprises. `BigInt` parsing of `sqrtPriceX96` and `liquidity` was a few lines.
- viem's `PublicClient` / `WalletClient` integrate cleanly with the Workers runtime when `compatibility_flags = ["nodejs_compat"]` is set.

## Error behaviour

- The Pool API returns standard HTTP semantics — easy to surface in the dashboard.
- v4 SDK type errors at install time required pinning. Once pinned everything ran clean inside Workers.

## What we wish existed

1. **One-page chain matrix** for v4 — per chain: pool API base, PositionManager address, hooks deployment status.
2. **`buildRebalance` / `buildHarvest` / `buildExit` helpers** that take a `Position` and target range and return `{ to, data, value }`.
3. **TypeScript types for the Pool API responses** published as `@uniswap/api-types` or similar — would remove 30 lines of casting.
4. **Webhook or websocket feed** for pool tick changes, so polling agents can be replaced with push-driven ones in serverless runtimes.
