# Agent Learning Loop — Design Spec

**Date:** 2026-04-27
**Scope:** Cross-user outcome scoring, Vectorize RAG, preference learning, threshold calibration

---

## Goal

Make the agents genuinely better over time by closing the feedback loop: score every decision against real outcomes, retrieve similar past situations at decision time, learn personal approval style from Telegram feedback, and auto-calibrate coordinator thresholds from outcome data.

---

## Architecture

```
Decision made
     │
     ├─► Context Snapshot → D1 decision_contexts
     │
     ├─► +4h alarm  ─► Outcome Scorer ─► D1 outcomes (score_4h)
     │
     └─► +24h alarm ─► Outcome Scorer ─► D1 outcomes (score_24h) ─► Vectorize upsert
                                                                          │
                                                ┌────────────────────────┘
                                                │  (cross-user, all DOs)
Next decision                                   │
     │                                          ▼
     ├─► Retrieval ──────► Vectorize query (top-5 similar) ─► D1 fetch full examples
     │        │
     │        └─► Preference Profile (per-user, from Telegram feedback)
     │
     └─► Augmented Prompt ─► LLM agents

Daily alarm ─► Threshold Calibrator ─► D1 outcomes ─► adapted thresholds in DO storage
```

Four subsystems: Outcome Scorer, Experience Store (Vectorize + D1), Retrieval + Prompt Assembler, Threshold Calibrator. All run inside existing Workers/DO/D1/alarms infra. Vectorize is the only new infrastructure.

---

## Data Model

### New D1 Tables

```sql
-- Full snapshot at the moment an APPROVED decision is made.
CREATE TABLE decision_contexts (
  id TEXT PRIMARY KEY,             -- same as decision id
  do_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  action TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  feature_vector TEXT NOT NULL,    -- JSON float[6]: see Feature Vector section
  context_snapshot TEXT NOT NULL   -- full JSON: price, range, fees, agent verdicts
);
CREATE INDEX idx_dc_do_id ON decision_contexts(do_id);

-- Outcome scores written by the scorer at +4h and +24h.
CREATE TABLE outcomes (
  decision_id TEXT PRIMARY KEY,
  do_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  fee_delta_usd REAL,
  il_delta_pct REAL,
  range_adherence_4h REAL,
  range_adherence_24h REAL,
  net_pnl_vs_hold REAL,
  score_4h REAL,                   -- composite -1..1
  score_24h REAL,                  -- composite -1..1 (final)
  vectorized INTEGER DEFAULT 0     -- 1 once upserted to Vectorize; -1 if permanently failed
);
CREATE INDEX idx_outcomes_do_id ON outcomes(do_id);
CREATE INDEX idx_outcomes_vectorized ON outcomes(vectorized);

-- One row per Telegram approve/reject. Personal style signal.
CREATE TABLE preferences (
  id TEXT PRIMARY KEY,
  do_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  feature_vector TEXT NOT NULL,    -- same 6-dim vector
  decision TEXT NOT NULL,          -- 'approve' | 'reject'
  correlates_to TEXT NOT NULL      -- decision_id
);
CREATE INDEX idx_prefs_do_id ON preferences(do_id);

-- Audit trail of threshold changes made by the calibrator.
CREATE TABLE calibration_log (
  id TEXT PRIMARY KEY,
  do_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  old_thresholds TEXT NOT NULL,    -- JSON
  new_thresholds TEXT NOT NULL,    -- JSON
  outcome_sample_size INTEGER NOT NULL,
  avg_score REAL NOT NULL
);
```

### Feature Vector

6-dimensional float32 vector, all values normalized 0..1:

| Index | Field | Normalization |
|-------|-------|---------------|
| 0 | priceTrend | linear regression slope over last 30 price ticks from PriceAgent buffer, clamped to -1..1 then shifted to 0..1 |
| 1 | ilPct | clamped 0..20% → 0..1 |
| 2 | confidence | already 0..1 from LLM output |
| 3 | volatility | rolling std of last 30 ticks, clamped → 0..1 |
| 4 | timeInRange | already 0..1 |
| 5 | tickDistNorm | abs(currentTick - midpoint) / halfRange, clamped 0..1 |

### Vectorize Index

- **Name:** `hydra-experience`
- **Dimensions:** 6
- **Metric:** cosine
- **Metadata per vector:** `{ decision_id, do_id, action, score_4h, score_24h }`
- **Scope:** cross-user — all DOs write to the same index

---

## Components

### 1. Outcome Scorer (`src/chain/scoring.ts`)

Triggered by two DO alarms scheduled on each `APPROVED` event:
- `score-4h:{decisionId}` at `ts + 4 * 3600 * 1000`
- `score-24h:{decisionId}` at `ts + 24 * 3600 * 1000`

Each alarm:
1. Reads current position state (fees, IL, tick) from chain
2. Loads the `decision_contexts` snapshot for this decision
3. Computes metrics:
   - `fee_delta_usd` — fees accrued since snapshot
   - `il_delta_pct` — IL change (positive = worse)
   - `range_adherence` — point-in-time check: is currentTick between tickLower and tickUpper at scoring time? 1.0 if yes, 0.0 if no. Simple proxy; stored separately for 4h and 24h windows.
   - `net_pnl_vs_hold` — actual outcome minus estimated hold P&L using snapshot price
4. Composite score formula:
   ```
   score = 0.4 * fee_delta_norm + 0.3 * (1 - il_delta_norm) + 0.2 * range_adherence + 0.1 * pnl_norm
   ```
   where each component is clamped and normalized to 0..1 before weighting. Final score mapped to -1..1.
5. Upserts to `outcomes`. After 24h score: upserts vector to Vectorize, sets `vectorized=1`.

**Position changed before scoring window:** detected by comparing `activeTokenId` in snapshot vs current DO state. If changed, score only the fees/IL up to the next rebalance tx timestamp — still valid signal.

### 2. Experience Store (`src/store/vectorize.ts` + `src/store/learning.ts`)

`vectorize.ts` — thin wrapper around the Cloudflare Vectorize binding:
- `upsertExperience(vector, metadata)` — insert/update after 24h score
- `queryExperiences(vector, topK)` — returns `{decision_id, score_4h, score_24h, action}[]`

`learning.ts` — D1 operations for all four new tables:
- `saveDecisionContext(ctx)`, `getDecisionContext(id)`
- `saveOutcome(o)`, `updateOutcome(id, partial)`, `listOutcomes(doId, limit)`
- `savePreference(p)`, `listPreferences(doId)`
- `saveCalibrationLog(entry)`, `getLatestCalibration(doId)`

### 3. Retrieval + Prompt Assembler (`src/llm/retrieval.ts`)

Called by `LLMClient` before each `generateObject`. Steps:
1. Build feature vector from current context
2. Query Vectorize for top-5 nearest neighbors (minimum `score_24h > 0` filter)
3. Fetch full `context_snapshot` + outcome rows from D1 for those IDs
4. Format as few-shot block:

```
## Past situations similar to now
[1] Price trend: up | IL: 3.2% | confidence: 0.84 → REBALANCE
    4h: +$12 fees, 91% in-range | 24h score: 0.82  (good call)
[2] Price trend: flat | IL: 5.1% | confidence: 0.71 → HOLD
    4h: -$2 fees vs expected, 44% in-range | 24h score: -0.31  (wrong call)
```

5. Prepends block to system prompt. Falls back to static prompt if Vectorize returns no results (cold start).

Applied to: strategy agent, risk agent, coordinator agent. Price and macro agents get raw market data — few-shot examples add less value there.

### 4. Preference Model (in `src/do.ts` + `src/store/learning.ts`)

On every Telegram approve/reject:
1. Write row to `preferences` with current feature vector + decision label
2. Recompute `preferenceProfile` in DO storage:
   - `approvedCentroid` = mean of all approved feature vectors for this `do_id`
   - `rejectedCentroid` = mean of all rejected feature vectors
   - Profile = `{ approvedCentroid, rejectedCentroid, approveCount, rejectCount }`
3. Inject into coordinator system prompt as natural language:
   ```
   User preference profile (from X past decisions):
   Tends to approve: high confidence (>0.85), low IL (<4%), low volatility
   Tends to reject: near daily cap, volatility spike, confidence <0.75
   ```

Profile is empty for new users — coordinator runs with default behavior until first Telegram feedback.

### 5. Threshold Calibrator (`src/agents/calibrator.ts`)

Daily DO alarm (`calibrate:{doId}`):
1. Fetch last 30 days of `outcomes` for this `do_id` — requires minimum 10 rows, else skip
2. Grid search over:
   - `minConfidence`: [0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90]
   - `cooldownSec`: [300, 600, 900, 1800, 3600]
   - `dailyTxCap`: [3, 5, 7, 10]
3. For each combination: simulate which past decisions would have been approved vs blocked, compute mean `score_24h` of approved decisions
4. Pick combination with highest mean score
5. Write to `calibration_log`, update `adaptedThresholds` in DO storage
6. Applied on next `boot()` when wiring the `Coordinator`

**Auto-revert:** a second alarm fires 48h after each calibration. If mean `score_24h` over that window is lower than the previous calibration period's mean, revert to the previous thresholds from `calibration_log`.

---

## New Files

| File | Purpose |
|------|---------|
| `src/chain/scoring.ts` | Outcome computation logic |
| `src/store/learning.ts` | D1 operations for 4 new tables |
| `src/store/vectorize.ts` | Vectorize upsert/query wrapper |
| `src/llm/retrieval.ts` | Feature vector builder, Vectorize retrieval, prompt assembler |
| `src/agents/calibrator.ts` | Daily threshold calibration |
| `migrations/0004_learning.sql` | 4 new D1 tables |

## Modified Files

| File | Change |
|------|--------|
| `src/do.ts` | Schedule scoring alarms on APPROVED; wire calibrator; update preference profile on HUMAN_DECISION; pass adapted thresholds to Coordinator |
| `src/llm/client.ts` | Accept optional retrieval context; prepend few-shot block to system prompts for strategy, risk, coordinator |
| `src/config.ts` | Add `VECTORIZE` binding type |
| `wrangler.toml` | Add `[[vectorize]]` binding for `hydra-experience` index |

---

## Error Handling

| Failure | Handling |
|---------|---------|
| RPC failure at scoring time | Retry 3x with 30s backoff via alarm reschedule. On total failure write null score, mark `vectorized=-1`, exclude from calibration |
| Position changed before scoring window | Score only fees/IL up to next rebalance tx — detected by `activeTokenId` change in snapshot |
| Vectorize upsert fails | Keep `vectorized=0`, reschedule single retry at +1h |
| Retrieval returns no results | Fall back to static system prompt — retrieval is additive |
| Preference profile empty | Coordinator runs with default thresholds until first Telegram feedback |
| Calibration sample too small | Require minimum 10 scored decisions before first calibration |
| Calibration produces worse thresholds | Auto-revert check at +48h; revert to previous `calibration_log` entry if mean score dropped |

---

## Open Questions

None — all decisions made during design session.
