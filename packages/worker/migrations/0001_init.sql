CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  approved INTEGER NOT NULL,
  recommendation TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decisions_ts ON decisions(ts);
