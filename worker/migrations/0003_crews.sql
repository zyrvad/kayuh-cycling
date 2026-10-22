-- Accounts, crews and group rides.
-- Accounts come from Cloudflare Access: the Worker verifies the Access token and finds or creates
-- a users row (kind = 'account') by email. Device users from before sign-in are merged into it.

CREATE INDEX IF NOT EXISTS users_email ON users (email);

CREATE TABLE crews (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE crew_members (
  crew_id   TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (crew_id, user_id)
);
CREATE INDEX crew_members_user ON crew_members (user_id);

-- A planned ride for a crew. The route is a snapshot, so later edits to anyone's saved route
-- don't change what the crew agreed to ride.
CREATE TABLE group_rides (
  id          TEXT PRIMARY KEY,
  crew_id     TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  created_by  TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  starts_at   TEXT NOT NULL,  -- ISO 8601 with offset
  notes       TEXT,
  meet_lon    REAL NOT NULL,
  meet_lat    REAL NOT NULL,
  meet_name   TEXT NOT NULL,
  route_name  TEXT NOT NULL,
  points      TEXT NOT NULL,  -- JSON [[lon, lat], ...]
  prefs       TEXT NOT NULL,
  distance_m  REAL NOT NULL,
  time_s      REAL NOT NULL,
  tier_m      TEXT NOT NULL,
  legs        INTEGER NOT NULL,
  polyline    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX group_rides_crew ON group_rides (crew_id, starts_at);

CREATE TABLE rsvps (
  ride_id    TEXT NOT NULL REFERENCES group_rides(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('going', 'maybe', 'no')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (ride_id, user_id)
);
