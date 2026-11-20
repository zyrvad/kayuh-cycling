-- Training goals: a target for a week, month or year, in distance (km), moving time (hours) or ride count.
-- One goal per period and metric. Only the owner sees them.
CREATE TABLE goals (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period     TEXT NOT NULL CHECK (period IN ('week', 'month', 'year')),
  metric     TEXT NOT NULL CHECK (metric IN ('distance', 'time', 'rides')),
  target     REAL NOT NULL CHECK (target > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, period, metric)
);
