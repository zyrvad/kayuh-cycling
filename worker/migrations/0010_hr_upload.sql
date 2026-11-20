-- Heart rate from Apple Health, sent by an iOS Shortcut. Owner only: nothing here is ever shown to anyone else.
-- A token is minted by the signed-in owner for one ride; only its SHA-256 hash is stored. It expires after 24 hours.
CREATE TABLE hr_tokens (
  token_hash TEXT PRIMARY KEY,
  ride_id    TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX hr_tokens_ride ON hr_tokens (ride_id);
CREATE INDEX hr_tokens_expiry ON hr_tokens (expires_at);

-- Samples a Shortcut uploaded, waiting for the app to merge them onto the ride. One row per ride (a new upload replaces it).
CREATE TABLE ride_hr_pending (
  ride_id    TEXT PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  samples    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
