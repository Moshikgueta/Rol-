-- Login por telefone (código por SMS) e sessões por aparelho.

ALTER TABLE users ADD COLUMN phone TEXT;
CREATE UNIQUE INDEX idx_users_phone ON users(phone) WHERE phone IS NOT NULL;

-- Cada aparelho logado tem uma sessão. Sair da conta apaga só a sessão,
-- e a pessoa entra de novo com o mesmo telefone.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Mantém funcionando quem criou conta antes do login por telefone.
-- (users.token_hash não é mais usado para autenticar novas contas.)
INSERT INTO sessions (token_hash, user_id, created_at)
  SELECT token_hash, id, created_at FROM users WHERE token_hash NOT LIKE 'seed-%';

-- Limite de envio de códigos (por telefone e por IP).
CREATE TABLE otp_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone       TEXT NOT NULL,
  ip          TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_otp_requests_phone ON otp_requests(phone, created_at);
CREATE INDEX idx_otp_requests_ip ON otp_requests(ip, created_at);

-- Códigos gerados no modo de desenvolvimento (em produção quem guarda é o Twilio Verify).
CREATE TABLE otp_codes (
  phone       TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0
);

-- Telefone já verificado, aguardando a pessoa escolher nome e @ (vale 15 min).
CREATE TABLE signup_tickets (
  token_hash  TEXT PRIMARY KEY,
  phone       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
