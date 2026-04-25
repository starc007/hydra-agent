-- Wipe single-tenant tables and recreate with do_id scoping.
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS decisions;

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  do_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX idx_events_do_ts ON events(do_id, ts);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  do_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  approved INTEGER NOT NULL,
  recommendation TEXT NOT NULL
);
CREATE INDEX idx_decisions_do_ts ON decisions(do_id, ts);

CREATE TABLE users (
  do_id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  token_id TEXT NOT NULL,
  registered_at INTEGER NOT NULL,
  last_kick INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_users_wallet ON users(wallet);
CREATE INDEX idx_users_last_kick ON users(last_kick);

CREATE TABLE escalations (
  correlates_to TEXT PRIMARY KEY,
  do_id TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_escalations_ts ON escalations(ts);
