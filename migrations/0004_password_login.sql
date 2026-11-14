-- Login com @ e senha (grátis, sem SMS nem Google).

-- Formato: pbkdf2$<iterações>$<salt base64>$<hash base64>
ALTER TABLE users ADD COLUMN password_hash TEXT;

-- Tentativas de login e de cadastro, para limitar abuso (por @ e por IP).
CREATE TABLE auth_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,      -- 'login_fail' ou 'register'
  key         TEXT NOT NULL,      -- '@usuario' ou 'ip:1.2.3.4'
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_auth_attempts ON auth_attempts(kind, key, created_at);
