-- Login com Google.

ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX idx_users_google ON users(google_sub) WHERE google_sub IS NOT NULL;

-- Conta Google já verificada, aguardando a pessoa escolher o @ (vale 15 min).
CREATE TABLE pending_signups (
  token_hash  TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  email       TEXT,
  name        TEXT,
  picture     TEXT,
  expires_at  INTEGER NOT NULL
);
