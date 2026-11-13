-- Rolê: esquema inicial (Cloudflare D1 / SQLite). Datas em milissegundos (epoch).

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  handle      TEXT NOT NULL UNIQUE,
  avatar_url  TEXT,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);

CREATE TABLE posts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('role', 'event')),
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  photo_url    TEXT NOT NULL,
  lat          REAL NOT NULL,
  lng          REAL NOT NULL,
  place        TEXT NOT NULL,
  rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  free         INTEGER NOT NULL DEFAULT 1,
  posted_at    INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX idx_posts_expires ON posts(expires_at);
CREATE INDEX idx_posts_user ON posts(user_id, posted_at DESC);

CREATE TABLE likes (
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX idx_likes_user ON likes(user_id, created_at DESC);

CREATE TABLE comments (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_comments_post ON comments(post_id, created_at);

-- "Amigos": pessoas que você segue. Quem você segue pode ver sua localização
-- em tempo real quando a visibilidade for "Amigos".
CREATE TABLE follows (
  follower_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX idx_follows_followee ON follows(followee_id);

CREATE TABLE notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  post_id     TEXT,
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
