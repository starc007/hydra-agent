# Uniswap API + v4 SDK Feedback (Hydra)

## Context

Hydra is a multi-agent LP coordinator deployed entirely on Cloudflare (Workers
+ Durable Objects + D1 + Pages). This file logs DX observations that came out
of building it against the Uniswap API and v4 SDK on Unichain Sepolia.

---

## What we ended up integrating

- **No hosted Uniswap API.** We initially tried `https://api.uniswap.org/v2/pools/{poolId}?chainId=1301`. The endpoint does not exist; `api.uniswap.org` returns `403 Forbidden` for cross-origin callers and `409 ACCESS_DENIED` for direct calls **even with a developer-dashboard API key**. We probed every plausible path (`/v1/quote`, `/v1/pools`, `/v1/lp/positions`, `/v1/portfolio`, `wallet.gateway.uniswap.org/v1/check_approval`, `interface.gateway.uniswap.org/v1/quote`) and got the same 403/409 across the board.
- **`StateView` lens contract** (`v4-periphery/src/lens/StateView.sol`) — became our primary read surface. `getSlot0(poolId)`, `getLiquidity(poolId)`, `getFeeGrowthInside(poolId, tickLower, tickUpper)`, `getPositionInfo(poolId, owner, tickLower, tickUpper, salt)`. No auth, no rate limit, works on every chain with v4 deployed.
- **`PositionManager`** — `getPositionLiquidity`, `getPoolAndPositionInfo`, `modifyLiquidities` read/written directly via viem.
- **`@uniswap/v4-sdk`** — pulled in for tick-math types and `Pool` / `Position` references; we did **not** use it for `modifyLiquidities` encoding (path was unclear — see below).
- **ERC20 metadata** — read directly from token contracts on first boot, cached in DO memory.

---

## Sharpest pain points

### 1. There's no documented public read API for v4 pool state

The hosted Trading API is for swap quoting, not pool state reads. The Subgraph requires a paid Graph Gateway API key and has sparse Unichain Sepolia coverage. `api.uniswap.org` rejects all cross-origin and direct calls regardless of API key — apparently it's whitelisted to first-party callers only. So every off-chain LP-management tool ends up reading via on-chain RPC, which is one round-trip per poll per user. At 10 s tick × 1000 users that's 100 RPS to the chain just for pool state — wasteful given the data is the same for everyone in a pool.

**Wish**: a documented hosted endpoint for pool state by `poolId` per chain — even if rate-limited or cache-fronted.

### 2. The developer dashboard issues keys that don't unlock anything

We registered on cloud.reown.com for AppKit and at developers.uniswap.org for an API key. The Uniswap key returns `409 ACCESS_DENIED` on every Trading API path we tried. There's no clear page that says "your key gives you access to product X but not Y." We spent ~30 minutes thinking we had a misconfiguration before realizing the keys are gated to specific partner programs.

**Wish**: in the developer dashboard, after generating a key, show a list of products it can actually call. Or default-grant it Trading API access if that's the public surface.

### 3. v4 `modifyLiquidities` encoding is hand-rolled territory

The biggest engineering sink. Going from `Position` / `Pool` SDK objects to the encoded `(actions, params[])` byte string isn't surfaced anywhere in the v4 SDK. We hand-rolled it from periphery source — see `packages/worker/src/chain/actions.ts`. Specifically:

- `Actions.sol` constants (`INCREASE_LIQUIDITY = 0x00`, `DECREASE_LIQUIDITY = 0x01`, `MINT_POSITION = 0x02`, `BURN_POSITION = 0x03`, `SETTLE_PAIR = 0x0d`, `TAKE_PAIR = 0x11`) — discoverable only by reading the periphery source.
- Per-action ABI tuples — same. We had to read `_dispatch(uint256 action, bytes calldata params)` and trace each `params.decode*Params()` call to figure out the layout.
- `unlockData = abi.encode(bytes actions, bytes[] params)` where `actions` is a packed concatenation of single-byte action codes — figure out from the same trace.

A `buildRebalance(poolKey, tokenId, newRange, recipient)` helper that returned `{ to, data, value }` would have saved us a half day. Same for `buildHarvest` and `buildExit`.

### 4. `PositionInfo` is bit-packed and the SDK doesn't decode it

`getPoolAndPositionInfo(tokenId)` returns a `PoolKey` struct AND a packed `uint256` `info`. The bit layout is:

```
bits 0-7   hasSubscriber (uint8)
bits 8-31  tickLower    (int24, sign-extended)
bits 32-55 tickUpper    (int24, sign-extended)
bits 56-255 poolId       (bytes25, upper 200 bits, truncated)
```

The SDK doesn't expose a `decodePositionInfo(info)` helper. We re-implemented at `packages/worker/src/chain/position.ts:readPositionMetadata`. Note: the truncated 200-bit poolId is **not** recoverable from `info` alone — we recompute `keccak256(abi.encode(PoolKey))` to get the full 32-byte poolId.

**Wish**: `PositionInfoLibrary.decode(info)` exposed via the SDK as `{ tickLower, tickUpper, hasSubscriber }`. Alternatively, return the unpacked struct from `getPoolAndPositionInfo` directly and skip the bit packing.

### 5. Fees-owed reads need a math danger note

Computing fees-owed for a position requires:

1. `StateView.getFeeGrowthInside(poolId, tickLower, tickUpper)` → `(insideNow0, insideNow1)`
2. `StateView.getPositionInfo(poolId, positionManager, tickLower, tickUpper, bytes32(tokenId))` → `(liquidity, insideLast0, insideLast1)`
3. Compute `fees0 = ((insideNow0 - insideLast0) * liquidity) / Q128`
4. **The subtraction wraps in Solidity unchecked math** — naive JS `bigint - bigint` may go negative for positions that haven't been touched in a while. Use `BigInt.asUintN(256, a - b)` to mimic.

Step 4 is a footgun. We hit it once. A first-class `getFeesOwed(positionManager, tokenId)` view (or SDK helper) that handles the wrap correctly would save everyone discovering this the hard way.

### 6. PositionManager isn't ERC721Enumerable

`balanceOf(owner)` works, but `tokenOfOwnerByIndex(owner, i)` and `totalSupply()` revert. So enumerating "my positions" client-side requires scanning Transfer events, which is expensive without an indexer. Most LP-management UIs need this — so most end up paying for The Graph or rolling their own indexer.

**Wish**: implement Enumerable on PositionManager. Or expose `getOwnerTokenIds(owner) → uint256[]` as a lens function.

### 7. `Permit2.approve` expiration semantics

When we hit `AllowanceExpired (0xd81b2f2e)` on our first mint, the actual issue was a stale Permit2 record from an earlier failed transaction that left an expiration in the past. Permit2 docs are good, but the error doesn't tell you whether it's the ERC20→Permit2 allowance or the Permit2→spender allowance that's the problem. The `expiration` value in the revert would help.

---

## What worked nicely

- **viem + Workers compatibility** — `compatibility_flags = ["nodejs_compat"]` is enough. `createPublicClient` / `createWalletClient` serialize cleanly across Worker requests.
- **Vercel AI SDK + Anthropic prompt caching** — `cache_control: ephemeral` on the system message via `providerOptions.anthropic.cacheControl` works exactly as documented. Saved us ~50 % on tokens in our Strategy agent.
- **v4 actions are composable** — once you have the encoder, `[DECREASE, MINT, SETTLE_PAIR, TAKE_PAIR]` for rebalance, `[DECREASE(0), TAKE_PAIR]` for harvest, `[DECREASE(all), BURN, TAKE_PAIR]` for exit. Clean primitives, just under-documented.
- **StateView is the right abstraction** — single contract, all the lens reads, no special permissions. The right design pattern for off-chain consumers.

---

## Consolidated wishlist

1. **Documented public read API for v4 pool state** — even if rate-limited / cache-fronted via Cloudflare/Vercel.
2. **`buildRebalance` / `buildHarvest` / `buildExit` SDK helpers** — accept `Position` + new range, return `{ to, data, value }`.
3. **`decodePositionInfo(info)` SDK helper** — expose the bit-packed `PositionInfo` as a typed object.
4. **`getFeesOwed(positionManager, tokenId)` view helper** — encapsulates the unchecked-subtraction wrap.
5. **One-page chain matrix** — per chain: pool API base (when available), `PoolManager`, `PositionManager`, `StateView`, `Permit2`, `Universal Router`, `V4Quoter`, hooks deployment status. Today this is scattered across release notes.
6. **TypeScript types for hosted API responses** published as `@uniswap/api-types` — would remove ~30 lines of casting we wrote.
7. **PositionManager ERC721Enumerable** OR a dedicated `getOwnerTokenIds(owner)` lens — so multi-tenant UIs can enumerate user positions without an indexer.
8. **Webhook / WebSocket feed for pool tick changes** — push-driven instead of polling. Polling 1000 users × every 10 s is wasteful when pool state is shared.
9. **Better error messages on developer-dashboard API keys** — specifically which products a given key unlocks. Currently the only feedback is `409 ACCESS_DENIED` on every endpoint.
