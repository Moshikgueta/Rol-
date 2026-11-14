// Confere o "ID token" que o botão Entrar com Google entrega ao app.
// O token é um JWT assinado pelo Google (RS256). Conferimos a assinatura com as
// chaves públicas do Google, o emissor, o público (nosso Client ID), a validade
// e se o e-mail foi verificado. Não precisa de client secret.

import { HttpError } from "./util.js";

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
const decodeJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function loadKeys(env) {
  const r = await fetch(env.GOOGLE_JWKS_URL || JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!r.ok) throw new HttpError(502, "Não foi possível falar com o Google agora. Tente de novo.");
  return (await r.json()).keys || [];
}

export async function verifyGoogleIdToken(env, token) {
  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new HttpError(503, "O login com Google ainda não foi configurado no servidor.");
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new HttpError(400, "Login com Google inválido. Tente de novo.");

  let header, payload;
  try { header = decodeJson(parts[0]); payload = decodeJson(parts[1]); }
  catch { throw new HttpError(400, "Login com Google inválido. Tente de novo."); }
  if (header.alg !== "RS256") throw new HttpError(400, "Login com Google inválido. Tente de novo.");

  const jwk = (await loadKeys(env)).find((k) => k.kid === header.kid);
  if (!jwk) throw new HttpError(401, "Login com Google expirado. Tente de novo.");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!ok) throw new HttpError(401, "Login com Google inválido. Tente de novo.");

  const now = Math.floor(Date.now() / 1000);
  if (!ISSUERS.includes(payload.iss)) throw new HttpError(401, "Login com Google inválido. Tente de novo.");
  if (payload.aud !== clientId) throw new HttpError(401, "Login com Google inválido para este app.");
  if (!payload.exp || payload.exp < now - 60) throw new HttpError(401, "Login com Google expirado. Tente de novo.");
  if (!payload.sub) throw new HttpError(401, "Login com Google inválido. Tente de novo.");
  if (payload.email && payload.email_verified === false) {
    throw new HttpError(401, "Confirme seu e-mail no Google antes de entrar.");
  }
  return { sub: String(payload.sub), email: payload.email || null, name: payload.name || "", picture: payload.picture || null };
}
