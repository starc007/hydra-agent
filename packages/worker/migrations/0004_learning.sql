CREATE TABLE IF NOT EXISTS decision_contexts (
  id TEXT PRIMARY KEY,
  do_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  action TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  feature_vector TEXT NOT NULL,
  context_snapshot TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dc_do_id ON decision_contexts(do_id);

CREATE TABLE IF NOT EXISTS outcomes (
  decision_id TEXT PRIMARY KEY,
  do_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  fee_delta_usd REAL,
  il_delta_pct REAL,
  range_adherence_4h REAL,
  range_adherence_24h REAL,
  net_pnl_vs_hold REAL,
  score_4h REAL,
  score_24h REAL,
  vectorized INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_outcomes_do_id ON outcomes(do_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_vectorized ON outcomes(vectorized);

CREATE TABLE IF NOT EXISTS preferences (
  id TEXT PRIMARY KEY,
  do_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  feature_vector TEXT NOT NULL,
  decision TEXT NOT NULL,
  correlates_to TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prefs_do_id ON preferences(do_id);

CREATE TABLE IF NOT EXISTS calibration_log (
  id TEXT PRIMARY KEY,
  do_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  old_thresholds TEXT NOT NULL,
  new_thresholds TEXT NOT NULL,
  outcome_sample_size INTEGER NOT NULL,
  avg_score REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cal_do_id ON calibration_log(do_id);
