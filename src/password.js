// Senhas: PBKDF2-SHA256 com salt aleatório (Web Crypto, nativo no Workers).
// 100.000 iterações é o máximo que o Workers aceita para PBKDF2.
import { HttpError } from "./util.js";

const ITERATIONS = 100000;
const enc = new TextEncoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export function validatePassword(pw) {
  if (typeof pw !== "string" || pw.length < 8) throw new HttpError(400, "A senha precisa ter pelo menos 8 caracteres.");
  if (pw.length > 200) throw new HttpError(400, "A senha pode ter no máximo 200 caracteres.");
  return pw;
}

export async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await derive(pw, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(bits)}`;
}

export async function verifyPassword(pw, stored) {
  const [alg, it, salt, hash] = String(stored || "").split("$");
  if (alg !== "pbkdf2" || !it || !salt || !hash) return false;
  const bits = new Uint8Array(await derive(String(pw), fromB64(salt), Number(it)));
  const expected = fromB64(hash);
  if (bits.length !== expected.length) return false;
  let diff = 0; // comparação em tempo constante
  for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ expected[i];
  return diff === 0;
}

// Limites: 10 erros de senha por @ e 30 por IP a cada 15 min; 10 cadastros por IP por hora.
const LIMITS = {
  login_fail: [{ by: "handle", windowMs: 15 * 60 * 1000, max: 10 }, { by: "ip", windowMs: 15 * 60 * 1000, max: 30 }],
  register: [{ by: "ip", windowMs: 60 * 60 * 1000, max: 10 }],
};

export async function checkAttempts(env, kind, { handle, ip }) {
  const now = Date.now();
  for (const l of LIMITS[kind]) {
    const key = l.by === "handle" ? handle && "@" + handle : ip && "ip:" + ip;
    if (!key) continue;
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_attempts WHERE kind = ? AND key = ? AND created_at > ?")
      .bind(kind, key, now - l.windowMs).first();
    if (r.n >= l.max) {
      throw new HttpError(429, kind === "register"
        ? "Muitas contas criadas a partir desta rede. Tente mais tarde."
        : "Muitas tentativas de senha. Espere 15 minutos e tente de novo.", { retryAfter: Math.ceil(l.windowMs / 1000) });
    }
  }
}

export async function recordAttempt(env, kind, { handle, ip }) {
  const now = Date.now();
  const stmts = [env.DB.prepare("DELETE FROM auth_attempts WHERE created_at < ?").bind(now - 24 * 60 * 60 * 1000)];
  for (const key of [handle && "@" + handle, ip && "ip:" + ip].filter(Boolean)) {
    stmts.push(env.DB.prepare("INSERT INTO auth_attempts (kind, key, created_at) VALUES (?, ?, ?)").bind(kind, key, now));
  }
  await env.DB.batch(stmts);
}
