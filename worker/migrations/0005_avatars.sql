-- Profile pictures: a small JPEG/WebP/PNG the app has already cropped and shrunk (about 20 KB),
-- kept apart from users so member lists stay light. Only accounts have one.
CREATE TABLE avatars (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/webp', 'image/png')),
  data       TEXT NOT NULL, -- base64
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
