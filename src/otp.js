// Envio e verificação do código por SMS.
//
// Produção: Twilio Verify (o Twilio gera, entrega e confere o código).
//   Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SID
// Desenvolvimento: OTP_DEV_MODE="true" em .dev.vars. O código é gerado aqui,
//   aparece no terminal e é devolvido para o app mostrar na tela. Nenhum SMS é enviado.

import { HttpError, sha256 } from "./util.js";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_DEV_ATTEMPTS = 5;

// Limites de envio de código
const LIMITS = [
  { key: "phone", windowMs: 60 * 1000, max: 1, message: "Espere um minuto para pedir outro código." },
  { key: "phone", windowMs: 60 * 60 * 1000, max: 5, message: "Muitos códigos pedidos para este número. Tente mais tarde." },
  { key: "ip", windowMs: 60 * 60 * 1000, max: 20, message: "Muitas tentativas a partir desta rede. Tente mais tarde." },
];

/** Normaliza para E.164. Números sem DDI são tratados como do Brasil (+55). */
export function normalizePhone(input) {
  const raw = String(input || "").trim();
  let digits = raw.replace(/\D/g, "");
  if (!raw.startsWith("+")) {
    if (digits.length === 10 || digits.length === 11) digits = "55" + digits; // DDD + número
  }
  const e164 = "+" + digits;
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) throw new HttpError(400, "Número de telefone inválido. Use DDD + número.");
  if (e164.startsWith("+55") && !/^\+55[1-9]{2}9\d{8}$/.test(e164)) {
    throw new HttpError(400, "Use um número de celular com DDD, por exemplo (41) 99999-9999.");
  }
  return e164;
}

export const isDevMode = (env) => env.OTP_DEV_MODE === "true";
const hasTwilio = (env) => env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SID;

async function enforceLimits(env, phone, ip) {
  const now = Date.now();
  for (const l of LIMITS) {
    const value = l.key === "phone" ? phone : ip;
    if (!value) continue;
    const r = await env.DB.prepare(`SELECT COUNT(*) AS n, MIN(created_at) AS first FROM otp_requests WHERE ${l.key} = ? AND created_at > ?`)
      .bind(value, now - l.windowMs).first();
    if (r.n >= l.max) {
      const retryAfter = Math.max(1, Math.ceil((r.first + l.windowMs - now) / 1000));
      throw new HttpError(429, l.message, { retryAfter });
    }
  }
  await env.DB.batch([
    env.DB.prepare("INSERT INTO otp_requests (phone, ip, created_at) VALUES (?, ?, ?)").bind(phone, ip, now),
    env.DB.prepare("DELETE FROM otp_requests WHERE created_at < ?").bind(now - 24 * 60 * 60 * 1000),
  ]);
}

async function twilio(env, path, params) {
  const res = await fetch(`https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SID}/${path}`, {
    method: "POST",
    headers: {
      authorization: "Basic " + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** Envia o código. Devolve { devCode } apenas no modo de desenvolvimento. */
export async function sendCode(env, phone, ip) {
  if (!isDevMode(env) && !hasTwilio(env)) {
    throw new HttpError(503, "O envio de SMS ainda não foi configurado no servidor.");
  }
  await enforceLimits(env, phone, ip);

  if (isDevMode(env)) {
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
    await env.DB.prepare(`INSERT INTO otp_codes (phone, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)
        ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0`)
      .bind(phone, await sha256(phone + ":" + code), Date.now() + CODE_TTL_MS).run();
    console.log(`[OTP modo dev] código para ${phone}: ${code}`);
    return { devCode: code };
  }

  const r = await twilio(env, "Verifications", { To: phone, Channel: "sms", Locale: "pt-BR" });
  if (!r.ok) {
    console.error("Twilio Verify (envio):", r.status, JSON.stringify(r.data));
    if (r.data.code === 60200 || r.data.code === 21608 || r.data.code === 21614) throw new HttpError(400, "Não conseguimos enviar SMS para este número.");
    if (r.data.code === 60203) throw new HttpError(429, "Muitos códigos pedidos para este número. Tente mais tarde.");
    throw new HttpError(502, "Não foi possível enviar o SMS agora. Tente de novo.");
  }
  return {};
}

/** Confere o código. Lança HttpError se estiver errado ou vencido. */
export async function checkCode(env, phone, code) {
  if (!/^\d{4,8}$/.test(String(code || ""))) throw new HttpError(400, "Digite o código de 6 números.");

  if (isDevMode(env)) {
    const row = await env.DB.prepare("SELECT * FROM otp_codes WHERE phone = ?").bind(phone).first();
    if (!row || row.expires_at < Date.now()) throw new HttpError(400, "Código vencido. Peça um novo.");
    if (row.attempts >= MAX_DEV_ATTEMPTS) throw new HttpError(429, "Muitas tentativas. Peça um novo código.");
    if (row.code_hash !== (await sha256(phone + ":" + code))) {
      await env.DB.prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ?").bind(phone).run();
      throw new HttpError(400, "Código incorreto.");
    }
    await env.DB.prepare("DELETE FROM otp_codes WHERE phone = ?").bind(phone).run();
    return;
  }

  if (!hasTwilio(env)) throw new HttpError(503, "O envio de SMS ainda não foi configurado no servidor.");
  const r = await twilio(env, "VerificationCheck", { To: phone, Code: String(code) });
  if (r.ok && r.data.status === "approved") return;
  if (r.status === 404 || r.data.code === 20404) throw new HttpError(400, "Código vencido. Peça um novo.");
  if (r.data.code === 60202) throw new HttpError(429, "Muitas tentativas. Peça um novo código.");
  if (r.ok) throw new HttpError(400, "Código incorreto.");
  console.error("Twilio Verify (checagem):", r.status, JSON.stringify(r.data));
  throw new HttpError(502, "Não foi possível conferir o código agora. Tente de novo.");
}
