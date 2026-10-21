-- Kayuh initial schema.
-- Until sign-in lands (Phase 3), a "user" is a device: the app generates a UUID and sends it
-- as X-Kayuh-Device. Signing in later links that device user to a real account.

CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL DEFAULT 'device' CHECK (kind IN ('device', 'account')),
  display_name TEXT,
  email        TEXT UNIQUE,
  operator     TEXT NOT NULL DEFAULT 'helloride' CHECK (operator IN ('helloride', 'anywheel', 'own')),
  cap_minutes  INTEGER NOT NULL DEFAULT 30,
  speed_kmh    REAL NOT NULL DEFAULT 15,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Routes are stored as the points the user chose plus a snapshot of the result. Never as graph
-- edge ids: those change on every monthly data rebuild.
CREATE TABLE routes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('ab', 'loop', 'explore', 'freeform')),
  profile     TEXT NOT NULL CHECK (profile IN ('nicest', 'balanced', 'direct')),
  points      TEXT NOT NULL,  -- JSON [[lon, lat], ...]
  prefs       TEXT NOT NULL,  -- JSON Prefs
  distance_m  REAL NOT NULL,
  time_s      REAL NOT NULL,
  tier_m      TEXT NOT NULL,  -- JSON [pcn, cycleway, shared, footpath, quiet_road, road]
  legs        INTEGER NOT NULL,
  polyline    TEXT NOT NULL,  -- encoded polyline, precision 5
  share_token TEXT UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX routes_user ON routes (user_id, updated_at DESC);

-- Ride history. Private by default; sharing with a crew is opt-in per ride.
CREATE TABLE rides (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_id    TEXT REFERENCES routes(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  ridden_at   TEXT NOT NULL,
  distance_m  REAL NOT NULL,
  time_s      REAL NOT NULL,
  tier_m      TEXT NOT NULL,
  polyline    TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('planned', 'recorded', 'gpx')),
  visibility  TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'crew')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX rides_user ON rides (user_id, ridden_at DESC);

-- Personal segment marks, applied on top of the tiers. Stored as geometry.
CREATE TABLE segment_feedback (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     TEXT NOT NULL CHECK (rating IN ('great', 'avoid', 'closed')),
  lon        REAL NOT NULL,
  lat        REAL NOT NULL,
  note       TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX feedback_user ON segment_feedback (user_id);
