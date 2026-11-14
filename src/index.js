// Rolê — API (Cloudflare Workers + D1 + R2 + Durable Objects)
export { LiveHub } from "./live.js";
import { HttpError, json, sha256, randomToken } from "./util.js";
import { normalizePhone, sendCode, checkCode, availableChannels } from "./otp.js";
import { verifyGoogleIdToken } from "./google.js";

const MIN = 60 * 1000;
const DURATIONS = [60, 180, 360];
const MAX_UPLOAD = 5 * 1024 * 1024;
const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const HANDLE_RE = /^[a-z0-9_.]{2,20}$/;

// ---------------- Utilidades ----------------
const uid = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

async function body(req) {
  try { return await req.json(); } catch { throw new HttpError(400, "JSON inválido."); }
}
function str(v, field, { min = 0, max = 280 } = {}) {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length < min) throw new HttpError(400, `Preencha o campo ${field}.`);
  if (s.length > max) throw new HttpError(400, `O campo ${field} aceita até ${max} caracteres.`);
  return s;
}
function coord(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new HttpError(400, "Localização inválida.");
  return n;
}
function normalizeHandle(h) {
  const s = String(h || "").toLowerCase().replace(/^@/, "").trim();
  if (!HANDLE_RE.test(s)) throw new HttpError(400, "O @usuário deve ter de 2 a 20 letras minúsculas, números, _ ou .");
  return s;
}
// Só aceitamos fotos que o próprio usuário enviou para o R2.
function ownMediaUrl(url, user, { optional = false } = {}) {
  if (optional && (url === null || url === undefined || url === "")) return null;
  if (typeof url !== "string" || !url.startsWith(`/api/media/u/${user.id}/`)) throw new HttpError(400, "Foto inválida. Envie a foto novamente.");
  return url;
}

const publicUser = (u) => u && { id: u.id, name: u.name, handle: u.handle, avatar: u.avatar_url };
// Dados que só a própria pessoa vê
const selfUser = (u) => u && { ...publicUser(u), phone: u.phone || null, email: u.email || null };

function bearer(req) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : new URL(req.url).searchParams.get("token");
}

async function authUser(req, env, { required = true } = {}) {
  const token = bearer(req);
  if (token) {
    const u = await env.DB.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?")
      .bind(await sha256(token)).first();
    if (u) return u;
  }
  if (required) throw new HttpError(401, "Faça login para continuar.");
  return null;
}

async function createSession(env, userId) {
  const token = randomToken();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, Date.now()).run();
  return token;
}

async function notify(env, userId, actorId, text, postId = null) {
  if (userId === actorId) return;
  await env.DB.prepare("INSERT INTO notifications (id, user_id, text, post_id, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(uid("n"), userId, text, postId, Date.now()).run();
}

// ---------------- Geocodificação reversa ----------------
export async function reverseGeocode(lat, lng, ctx) {
  const rl = lat.toFixed(4), rg = lng.toFixed(4);
  const cacheKey = new Request(`https://role-geocode.cache/${rl},${rg}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return (await hit.json()).place;

  let place = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=pt-BR&zoom=18`,
      { headers: { "user-agent": "Role-App/1.0 (Cloudflare Worker)" } }
    );
    if (r.ok) {
      const j = await r.json();
      const a = j.address || {};
      const street = a.road || a.pedestrian || a.square || a.amenity || j.name;
      const hood = a.suburb || a.neighbourhood || a.quarter;
      const city = a.city || a.town || a.village;
      const parts = [street, [hood, city].filter(Boolean).join(", ")].filter(Boolean);
      if (parts.length) place = parts.join(" - ");
    }
  } catch { /* mantém coordenadas */ }

  const res = json({ place }, 200, { "cache-control": "public, max-age=604800" });
  ctx?.waitUntil(cache.put(cacheKey, res));
  return place;
}

// ---------------- Posts ----------------
const POST_SELECT = `
  SELECT p.*, u.name AS author_name, u.handle AS author_handle, u.avatar_url AS author_avatar,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
    (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
    EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?1) AS liked,
    EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ?1 AND f.followee_id = p.user_id) AS following
  FROM posts p JOIN users u ON u.id = p.user_id`;

function shapePost(r, viewer) {
  return {
    id: r.id, type: r.type, title: r.title, description: r.description,
    photo: r.photo_url, lat: r.lat, lng: r.lng, place: r.place,
    rating: r.rating, free: !!r.free, postedAt: r.posted_at, expiresAt: r.expires_at,
    author: { id: r.user_id, name: r.author_name, handle: r.author_handle, avatar: r.author_avatar },
    likes: r.like_count, liked: !!r.liked, commentCount: r.comment_count,
    following: !!r.following, mine: !!viewer && viewer.id === r.user_id,
  };
}

async function getPost(env, id, viewer) {
  const r = await env.DB.prepare(`${POST_SELECT} WHERE p.id = ?2`).bind(viewer?.id || "", id).first();
  if (!r) throw new HttpError(404, "Rolê não encontrado.");
  return shapePost(r, viewer);
}

// ---------------- Rotas ----------------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")).replace(/\*$/, "(.*)") + "$");
  routes.push({ method, re, keys, handler, wildcard: pattern.endsWith("*") });
};

// ---- Login por telefone ----
// 0) GET  /api/auth/channels               -> { sms, whatsapp } disponíveis
// 1) POST /api/auth/send   { phone, channel } -> envia o código por SMS ou WhatsApp
// 2) POST /api/auth/verify { phone, code }  -> conta existente: { token, user }
//                                            -> número novo: { signupTicket }
// 3) POST /api/users { signupTicket, name, handle } -> cria a conta: { token, user }
// Formas de login disponíveis neste servidor.
route("GET", "/api/auth/channels", async (req, env) =>
  json({ ...availableChannels(env), googleClientId: env.GOOGLE_CLIENT_ID || null }));

// ---- Login com Google ----
// POST /api/auth/google { credential } -> conta existente: { token, user }
//                                      -> conta nova: { signupTicket, suggested: { name, handle, avatar } }
route("POST", "/api/auth/google", async (req, env) => {
  const g = await verifyGoogleIdToken(env, (await body(req)).credential);
  const user = await env.DB.prepare("SELECT * FROM users WHERE google_sub = ?").bind(g.sub).first();
  if (user) return json({ token: await createSession(env, user.id), user: selfUser(user) });
  const ticket = randomToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM pending_signups WHERE expires_at < ?").bind(Date.now()),
    env.DB.prepare(`INSERT INTO pending_signups (token_hash, provider, subject, email, name, picture, expires_at)
        VALUES (?, 'google', ?, ?, ?, ?, ?)`)
      .bind(await sha256(ticket), g.sub, g.email, g.name, g.picture, Date.now() + 15 * MIN),
  ]);
  const base = (g.email || g.name || "").split("@")[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 20);
  return json({ signupTicket: ticket, suggested: { name: g.name.slice(0, 40), handle: base.length >= 2 ? base : "", avatar: g.picture } });
});

route("POST", "/api/auth/send", async (req, env) => {
  const b = await body(req);
  const phone = normalizePhone(b.phone);
  const channel = b.channel === "whatsapp" ? "whatsapp" : "sms";
  const ip = req.headers.get("cf-connecting-ip");
  const { devCode } = await sendCode(env, phone, ip, channel);
  return json({ phone, channel, resendIn: 60, ...(devCode ? { devCode } : {}) });
});

route("POST", "/api/auth/verify", async (req, env) => {
  const b = await body(req);
  const phone = normalizePhone(b.phone);
  await checkCode(env, phone, String(b.code || "").trim());
  const user = await env.DB.prepare("SELECT * FROM users WHERE phone = ?").bind(phone).first();
  if (user) return json({ token: await createSession(env, user.id), user: selfUser(user) });
  const ticket = randomToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM signup_tickets WHERE expires_at < ?").bind(Date.now()),
    env.DB.prepare("INSERT INTO signup_tickets (token_hash, phone, expires_at) VALUES (?, ?, ?)")
      .bind(await sha256(ticket), phone, Date.now() + 15 * MIN),
  ]);
  return json({ signupTicket: ticket, phone });
});

route("DELETE", "/api/auth/session", async (req, env) => {
  const token = bearer(req);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true });
});

route("DELETE", "/api/auth/sessions", async (req, env) => {
  const me = await authUser(req, env);
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(me.id).run();
  return json({ ok: true });
});

route("POST", "/api/users", async (req, env) => {
  const b = await body(req);
  const ticketHash = await sha256(String(b.signupTicket || ""));
  const now = Date.now();
  // O ticket vem do login por telefone ou do login com Google.
  const phoneTicket = await env.DB.prepare("SELECT phone FROM signup_tickets WHERE token_hash = ? AND expires_at > ?")
    .bind(ticketHash, now).first();
  const googleTicket = phoneTicket ? null : await env.DB
    .prepare("SELECT subject, email, picture FROM pending_signups WHERE token_hash = ? AND provider = 'google' AND expires_at > ?")
    .bind(ticketHash, now).first();
  if (!phoneTicket && !googleTicket) throw new HttpError(401, "Entre de novo para criar a conta.");
  const name = str(b.name, "nome", { min: 1, max: 40 });
  const handle = normalizeHandle(b.handle);
  const user = {
    id: uid("u"), name, handle,
    avatar_url: googleTicket?.picture || null,
    phone: phoneTicket?.phone || null,
    email: googleTicket?.email || null,
    google_sub: googleTicket?.subject || null,
  };
  try {
    // users.token_hash é legado (antes do login por telefone); guardamos um valor aleatório.
    await env.DB.prepare(`INSERT INTO users (id, name, handle, avatar_url, token_hash, phone, email, google_sub, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(user.id, name, handle, user.avatar_url, "legacy-" + randomToken(), user.phone, user.email, user.google_sub, now).run();
  } catch (e) {
    const m = String(e.message);
    if (m.includes("users.handle")) throw new HttpError(409, `O @${handle} já está em uso. Escolha outro.`);
    if (m.includes("google")) throw new HttpError(409, "Esta conta Google já tem cadastro. Entre com ela.");
    if (m.includes("phone")) throw new HttpError(409, "Este telefone já tem conta. Entre com ele.");
    throw e;
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM signup_tickets WHERE token_hash = ?").bind(ticketHash),
    env.DB.prepare("DELETE FROM pending_signups WHERE token_hash = ?").bind(ticketHash),
  ]);
  await notify(env, user.id, null, `Bem-vindo ao Rolê, ${name.split(" ")[0]}! Faça seu primeiro check-in.`);
  return json({ user: selfUser(user), token: await createSession(env, user.id) }, 201);
});

route("GET", "/api/me", async (req, env) => json({ user: selfUser(await authUser(req, env)) }));

route("PATCH", "/api/me", async (req, env) => {
  const me = await authUser(req, env);
  const b = await body(req);
  const name = b.name !== undefined ? str(b.name, "nome", { min: 1, max: 40 }) : me.name;
  const handle = b.handle !== undefined ? normalizeHandle(b.handle) : me.handle;
  const avatar = b.avatar !== undefined ? ownMediaUrl(b.avatar, me, { optional: true }) : me.avatar_url;
  try {
    await env.DB.prepare("UPDATE users SET name = ?, handle = ?, avatar_url = ? WHERE id = ?").bind(name, handle, avatar, me.id).run();
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) throw new HttpError(409, `O @${handle} já está em uso. Escolha outro.`);
    throw e;
  }
  return json({ user: selfUser({ ...me, name, handle, avatar_url: avatar }) });
});

route("GET", "/api/me/summary", async (req, env) => {
  const me = await authUser(req, env);
  const db = env.DB;
  const [stats, mine, liked] = await db.batch([
    db.prepare(`SELECT
        (SELECT COUNT(*) FROM posts WHERE user_id = ?1) AS checkins,
        (SELECT COUNT(*) FROM likes l JOIN posts p ON p.id = l.post_id WHERE p.user_id = ?1) AS likes_received,
        (SELECT COUNT(*) FROM comments WHERE user_id = ?1) AS comments,
        (SELECT COUNT(*) FROM follows WHERE follower_id = ?1) AS following,
        (SELECT COUNT(*) FROM follows WHERE followee_id = ?1) AS followers`).bind(me.id),
    db.prepare(`${POST_SELECT} WHERE p.user_id = ?1 ORDER BY p.posted_at DESC LIMIT 50`).bind(me.id),
    db.prepare(`${POST_SELECT} JOIN likes ml ON ml.post_id = p.id AND ml.user_id = ?1 ORDER BY ml.created_at DESC LIMIT 50`).bind(me.id),
  ]);
  const s = stats.results[0];
  return json({
    user: selfUser(me),
    stats: { checkins: s.checkins, likesReceived: s.likes_received, comments: s.comments, following: s.following, followers: s.followers },
    posts: mine.results.map((r) => shapePost(r, me)),
    liked: liked.results.map((r) => shapePost(r, me)),
  });
});

route("POST", "/api/uploads", async (req, env) => {
  const me = await authUser(req, env);
  const type = (req.headers.get("content-type") || "").split(";")[0].trim();
  const ext = IMAGE_TYPES[type];
  if (!ext) throw new HttpError(415, "Envie uma imagem JPG, PNG ou WebP.");
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_UPLOAD) throw new HttpError(413, "A foto deve ter até 5 MB.");
  const data = await req.arrayBuffer();
  if (!data.byteLength) throw new HttpError(400, "Foto vazia.");
  if (data.byteLength > MAX_UPLOAD) throw new HttpError(413, "A foto deve ter até 5 MB.");
  const key = `u/${me.id}/${crypto.randomUUID()}.${ext}`;
  await env.MEDIA.put(key, data, { httpMetadata: { contentType: type } });
  return json({ url: `/api/media/${key}` }, 201);
});

route("GET", "/api/media/*", async (req, env, { rest }) => {
  const obj = await env.MEDIA.get(rest);
  if (!obj) return new Response("Não encontrado", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType || "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
      etag: obj.httpEtag,
    },
  });
});

route("GET", "/api/geocode", async (req, env, _p, ctx) => {
  const u = new URL(req.url);
  const lat = coord(u.searchParams.get("lat"), -90, 90);
  const lng = coord(u.searchParams.get("lng"), -180, 180);
  return json({ place: await reverseGeocode(lat, lng, ctx) });
});

route("GET", "/api/posts", async (req, env) => {
  const viewer = await authUser(req, env, { required: false });
  const { results } = await env.DB.prepare(`${POST_SELECT} WHERE p.expires_at > ?2 ORDER BY p.posted_at DESC LIMIT 300`)
    .bind(viewer?.id || "", Date.now()).all();
  return json({ posts: results.map((r) => shapePost(r, viewer)) });
});

// Check-in: a localização vem do GPS do aparelho e o endereço é calculado aqui no servidor.
route("POST", "/api/posts", async (req, env, _p, ctx) => {
  const me = await authUser(req, env);
  const b = await body(req);
  const title = str(b.title, "nome do rolê", { min: 1, max: 60 });
  const description = str(b.description ?? "", "descrição", { max: 280 });
  const photo = ownMediaUrl(b.photo, me);
  const lat = coord(b.lat, -90, 90);
  const lng = coord(b.lng, -180, 180);
  const rating = Number(b.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, "Dê uma nota de 1 a 5 estrelas.");
  const durationMin = Number(b.durationMin);
  if (!DURATIONS.includes(durationMin)) throw new HttpError(400, "Duração inválida.");
  const place = await reverseGeocode(lat, lng, ctx);
  const now = Date.now();
  const id = uid("p");
  await env.DB.prepare(`INSERT INTO posts (id, user_id, type, title, description, photo_url, lat, lng, place, rating, free, posted_at, expires_at)
      VALUES (?, ?, 'role', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, me.id, title, description, photo, lat, lng, place, rating, b.free === false ? 0 : 1, now, now + durationMin * MIN).run();
  return json({ post: await getPost(env, id, me) }, 201);
});

route("GET", "/api/posts/:id", async (req, env, { id }) => {
  const viewer = await authUser(req, env, { required: false });
  return json({ post: await getPost(env, id, viewer) });
});

route("DELETE", "/api/posts/:id", async (req, env, { id }) => {
  const me = await authUser(req, env);
  const post = await env.DB.prepare("SELECT user_id, photo_url FROM posts WHERE id = ?").bind(id).first();
  if (!post) throw new HttpError(404, "Rolê não encontrado.");
  if (post.user_id !== me.id) throw new HttpError(403, "Você só pode apagar seus próprios check-ins.");
  await env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id).run();
  if (post.photo_url.startsWith("/api/media/")) await env.MEDIA.delete(post.photo_url.slice("/api/media/".length));
  return json({ ok: true });
});

route("POST", "/api/posts/:id/like", async (req, env, { id }) => {
  const me = await authUser(req, env);
  const post = await env.DB.prepare("SELECT user_id, title FROM posts WHERE id = ?").bind(id).first();
  if (!post) throw new HttpError(404, "Rolê não encontrado.");
  const r = await env.DB.prepare("INSERT OR IGNORE INTO likes (post_id, user_id, created_at) VALUES (?, ?, ?)").bind(id, me.id, Date.now()).run();
  if (r.meta.changes) await notify(env, post.user_id, me.id, `@${me.handle} curtiu seu rolê “${post.title}”`, id);
  return json({ post: await getPost(env, id, me) });
});

route("DELETE", "/api/posts/:id/like", async (req, env, { id }) => {
  const me = await authUser(req, env);
  await env.DB.prepare("DELETE FROM likes WHERE post_id = ? AND user_id = ?").bind(id, me.id).run();
  return json({ post: await getPost(env, id, me) });
});

route("GET", "/api/posts/:id/comments", async (req, env, { id }) => {
  const { results } = await env.DB.prepare(`SELECT c.id, c.text, c.created_at, u.id AS uid, u.name, u.handle, u.avatar_url
      FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.created_at LIMIT 200`).bind(id).all();
  return json({
    comments: results.map((r) => ({ id: r.id, text: r.text, at: r.created_at, author: { id: r.uid, name: r.name, handle: r.handle, avatar: r.avatar_url } })),
  });
});

route("POST", "/api/posts/:id/comments", async (req, env, { id }) => {
  const me = await authUser(req, env);
  const text = str((await body(req)).text, "comentário", { min: 1, max: 200 });
  const post = await env.DB.prepare("SELECT user_id FROM posts WHERE id = ?").bind(id).first();
  if (!post) throw new HttpError(404, "Rolê não encontrado.");
  const c = { id: uid("c"), text, at: Date.now(), author: publicUser(me) };
  await env.DB.prepare("INSERT INTO comments (id, post_id, user_id, text, created_at) VALUES (?, ?, ?, ?, ?)").bind(c.id, id, me.id, text, c.at).run();
  await notify(env, post.user_id, me.id, `@${me.handle} comentou: “${text.slice(0, 60)}”`, id);
  return json({ comment: c }, 201);
});

route("POST", "/api/users/:id/follow", async (req, env, { id }) => {
  const me = await authUser(req, env);
  if (id === me.id) throw new HttpError(400, "Você não pode seguir a si mesmo.");
  const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
  if (!target) throw new HttpError(404, "Pessoa não encontrada.");
  const r = await env.DB.prepare("INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)").bind(me.id, id, Date.now()).run();
  if (r.meta.changes) await notify(env, id, me.id, `@${me.handle} adicionou você como amigo`);
  return json({ following: true });
});

route("DELETE", "/api/users/:id/follow", async (req, env, { id }) => {
  const me = await authUser(req, env);
  await env.DB.prepare("DELETE FROM follows WHERE follower_id = ? AND followee_id = ?").bind(me.id, id).run();
  return json({ following: false });
});

route("GET", "/api/notifications", async (req, env) => {
  const me = await authUser(req, env);
  const { results } = await env.DB.prepare("SELECT id, text, post_id, read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50")
    .bind(me.id).all();
  return json({ notifications: results.map((n) => ({ id: n.id, text: n.text, postId: n.post_id, read: !!n.read, at: n.created_at })) });
});

route("POST", "/api/notifications/read", async (req, env) => {
  const me = await authUser(req, env);
  await env.DB.prepare("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0").bind(me.id).run();
  return json({ ok: true });
});

// Localização em tempo real: WebSocket atendido por um Durable Object.
route("GET", "/api/live", async (req, env) => {
  if (req.headers.get("upgrade") !== "websocket") throw new HttpError(426, "Use WebSocket.");
  const me = await authUser(req, env, { required: false });
  const headers = new Headers(req.headers);
  headers.delete("x-role-user");
  if (me) headers.set("x-role-user", JSON.stringify(publicUser(me)));
  const stub = env.LIVE.get(env.LIVE.idFromName("global"));
  return stub.fetch(new Request(req.url, { headers }));
});

// ---------------- Entrada ----------------
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        const params = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        if (r.wildcard) params.rest = decodeURIComponent(m[m.length - 1]);
        return await r.handler(req, env, params, ctx);
      }
      throw new HttpError(404, "Rota não encontrada.");
    } catch (e) {
      if (e instanceof HttpError) {
        const headers = e.extra.retryAfter ? { "retry-after": String(e.extra.retryAfter) } : {};
        return json({ error: e.message, ...e.extra }, e.status, headers);
      }
      console.error(e);
      return json({ error: "Erro interno. Tente novamente." }, 500);
    }
  },
};
