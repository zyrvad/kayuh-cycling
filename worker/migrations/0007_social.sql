-- Social: share a ride with chosen crews and/or your followers, follows (approval needed for
-- private accounts, the default), kudos and comments.

-- Accounts are private by default: someone following you needs your approval first.
ALTER TABLE users ADD COLUMN private_account INTEGER NOT NULL DEFAULT 1;
-- Your follow link (/follow/<code>), made the first time you ask for it.
ALTER TABLE users ADD COLUMN follow_code TEXT;
CREATE UNIQUE INDEX users_follow_code ON users (follow_code);

-- Accounts used to get their email's name part as a display name. Strangers can now see names
-- (feed, comments, follows), so clear those; people pick their own name in the app.
UPDATE users SET display_name = NULL
 WHERE kind = 'account' AND display_name = substr(email, 1, instr(email, '@') - 1);

-- Ride times as ISO UTC, so sorting the text sorts by time (new rides are saved that way).
UPDATE rides SET ridden_at = COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', ridden_at), ridden_at);

-- Whether a ride is shared with the rider's (accepted) followers.
ALTER TABLE rides ADD COLUMN share_followers INTEGER NOT NULL DEFAULT 0;

-- Which crews a ride is shared with. rides.visibility stays as a summary: 'crew' when the ride is
-- shared anywhere (a row here or share_followers = 1), else 'private'.
CREATE TABLE ride_shares (
  ride_id TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  PRIMARY KEY (ride_id, crew_id)
);
CREATE INDEX ride_shares_crew ON ride_shares (crew_id);

-- Before this, "shared" meant every crew the rider is in: keep that for existing rides.
INSERT OR IGNORE INTO ride_shares (ride_id, crew_id)
  SELECT r.id, m.crew_id FROM rides r JOIN crew_members m ON m.user_id = r.user_id WHERE r.visibility = 'crew';

CREATE TABLE follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX follows_followee ON follows (followee_id, status);

CREATE TABLE kudos (
  ride_id    TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (ride_id, user_id)
);

CREATE TABLE comments (
  id         TEXT PRIMARY KEY,
  ride_id    TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX comments_ride ON comments (ride_id, created_at);
