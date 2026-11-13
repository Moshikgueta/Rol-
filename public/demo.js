// Modo demonstração do Rolê: imita a API e a localização em tempo real dentro do
// navegador, sem servidor. Usado na versão publicada no GitHub Pages.
// Os dados ficam só neste aparelho (localStorage). Nada é enviado para ninguém.
(() => {
  "use strict";
  if (!(window.ROLE_CONFIG && window.ROLE_CONFIG.demo)) return;

  const DB_KEY = "role:demo-db:v1";
  const MIN = 60 * 1000;
  const photo = (seed) => `https://picsum.photos/seed/${seed}/720/960`;
  const face = (n) => `https://i.pravatar.cc/200?img=${n}`;
  const rid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

  class HttpError extends Error {
    constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
  }

  // ---------------- Banco local ----------------
  function seed() {
    const now = Date.now();
    const users = [
      ["u_petala", "Pétala", "petala", face(47)], ["u_caio", "Caio Martins", "caiom", face(12)],
      ["u_ju", "Juliana Reis", "ju.reis", face(45)], ["u_beto", "Beto Araújo", "betoaraujo", face(53)],
      ["u_nina", "Nina Souza", "ninasz", face(32)], ["u_rafa", "Rafa Lima", "rafalima", face(68)],
      ["u_novelas", "Teatro Novelas Curitibanas", "novelascuritibanas", photo("palco")],
      ["u_museu", "Museu Paranaense", "museupr", photo("museu")], ["u_feira", "Feirinha do Largo", "feiradolargo", photo("feira")],
    ].map(([id, name, handle, avatar]) => ({ id, name, handle, avatar, phone: null }));
    const P = (id, user_id, type, title, description, ph, lat, lng, place, rating, free, ago, dur) =>
      ({ id, user_id, type, title, description, photo: photo(ph), lat, lng, place, rating, free, postedAt: now - ago * MIN, expiresAt: now + (dur - ago) * MIN });
    const posts = [
      P("p1", "u_petala", "role", "Pretinhosidade saindo na Tiradentes", "Bloco afro já na concentração, bateria tá pesada! Chega mais 🥁", "bateria", -25.4286, -49.2706, "Pça. Tiradentes - Centro, Curitiba", 5, true, 38, 210),
      P("p2", "u_caio", "role", "Roda de samba no Largo", "Samba de raiz e cerveja gelada, ainda tem mesa.", "samba", -25.4278, -49.2738, "Largo da Ordem - São Francisco, Curitiba", 4, true, 75, 240),
      P("p3", "u_ju", "role", "Happy hour no Teatro Guaíra", "Saída da peça, galera reunida na frente.", "teatro", -25.4320, -49.2660, "R. XV de Novembro - Centro, Curitiba", 3, false, 15, 120),
      P("p4", "u_beto", "role", "Rap na Treze de Maio", "Batalha de rima começando agora!", "rap", -25.4262, -49.2686, "R. Treze de Maio - São Francisco, Curitiba", 5, true, 52, 180),
      P("p5", "u_nina", "role", "Sunset no Passeio Público", "Piquenique tranquilo, traz sua canga.", "piquenique", -25.4250, -49.2660, "Passeio Público - Centro, Curitiba", 4, true, 95, 180),
      P("e1", "u_novelas", "event", "Peça: Noites de Curitiba", "Sessão às 21h. Ingressos na bilheteria.", "palco", -25.4269, -49.2716, "Teatro Novelas Curitibanas - São Francisco", 5, false, 180, 420),
      P("e2", "u_museu", "event", "Noite no Museu", "Visita guiada noturna com DJ no pátio.", "museu", -25.4282, -49.2680, "Museu Paranaense - São Francisco", 4, true, 240, 480),
      P("e3", "u_feira", "event", "Feira de Artesanato", "Comida de rua, artesanato e música ao vivo.", "feira", -25.4295, -49.2745, "Largo da Ordem - São Francisco", 4, true, 120, 360),
    ];
    return {
      seededAt: now, users, posts,
      likes: [["p1", "u_caio"], ["p1", "u_ju"], ["p1", "u_beto"], ["p4", "u_nina"], ["e2", "u_petala"]].map(([post_id, user_id]) => ({ post_id, user_id, at: now })),
      comments: [
        { id: "c1", post_id: "p1", user_id: "u_caio", text: "Tô indo!!", at: now - 20 * MIN },
        { id: "c2", post_id: "p1", user_id: "u_ju", text: "Que energia 🔥", at: now - 12 * MIN },
        { id: "c3", post_id: "p4", user_id: "u_nina", text: "Melhor batalha da cidade", at: now - 30 * MIN },
      ],
      follows: [], notifications: [], sessions: {}, codes: {},
    };
  }

  let db;
  try { db = JSON.parse(localStorage.getItem(DB_KEY)); } catch { db = null; }
  // Renova os dados de exemplo a cada 6 horas para o mapa nunca ficar vazio
  if (!db || Date.now() - db.seededAt > 6 * 60 * MIN) {
    const fresh = seed();
    if (db) {
      const mine = (u) => !u.id.startsWith("u_") || u.phone;
      fresh.users.push(...db.users.filter(mine));
      fresh.posts.push(...db.posts.filter((p) => !p.user_id.startsWith("u_") || fresh.users.find((u) => u.id === p.user_id && u.phone)));
      Object.assign(fresh, { sessions: db.sessions, follows: db.follows, notifications: db.notifications });
    }
    db = fresh;
  }
  function save() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
    catch { throw new HttpError(507, "O armazenamento do navegador está cheio. Apague alguns check-ins."); }
  }
  save();

  // ---------------- Helpers ----------------
  const userById = (id) => db.users.find((u) => u.id === id);
  const pub = (u) => u && { id: u.id, name: u.name, handle: u.handle, avatar: u.avatar };
  const self = (u) => u && { ...pub(u), phone: u.phone };
  function me(token, required = true) {
    const u = token && userById(db.sessions[token]);
    if (!u && required) throw new HttpError(401, "Faça login para continuar.");
    return u || null;
  }
  function shape(p, viewer) {
    const a = userById(p.user_id);
    return {
      id: p.id, type: p.type, title: p.title, description: p.description, photo: p.photo,
      lat: p.lat, lng: p.lng, place: p.place, rating: p.rating, free: p.free,
      postedAt: p.postedAt, expiresAt: p.expiresAt, author: pub(a),
      likes: db.likes.filter((l) => l.post_id === p.id).length,
      liked: !!viewer && db.likes.some((l) => l.post_id === p.id && l.user_id === viewer.id),
      commentCount: db.comments.filter((c) => c.post_id === p.id).length,
      following: !!viewer && db.follows.some((f) => f.follower_id === viewer.id && f.followee_id === p.user_id),
      mine: !!viewer && viewer.id === p.user_id,
    };
  }
  function getPost(id) {
    const p = db.posts.find((x) => x.id === id);
    if (!p) throw new HttpError(404, "Rolê não encontrado.");
    return p;
  }
  function notify(userId, actorId, text, postId = null) {
    if (userId === actorId || !userById(userId)?.phone) return; // só para contas reais deste aparelho
    db.notifications.unshift({ id: rid("n"), user_id: userId, text, postId, read: false, at: Date.now() });
  }
  function normalizePhone(input) {
    let d = String(input || "").replace(/\D/g, "");
    if (d.length === 10 || d.length === 11) d = "55" + d;
    const e = "+" + d;
    if (!/^\+55[1-9]{2}9\d{8}$/.test(e)) throw new HttpError(400, "Use um número de celular com DDD, por exemplo (41) 99999-9999.");
    return e;
  }
  const normalizeHandle = (h) => {
    const s = String(h || "").toLowerCase().replace(/^@/, "").trim();
    if (!/^[a-z0-9_.]{2,20}$/.test(s)) throw new HttpError(400, "O @usuário deve ter de 2 a 20 letras minúsculas, números, _ ou .");
    return s;
  };
  const text = (v, field, min, max) => {
    const s = typeof v === "string" ? v.trim() : "";
    if (s.length < min) throw new HttpError(400, `Preencha o campo ${field}.`);
    if (s.length > max) throw new HttpError(400, `O campo ${field} aceita até ${max} caracteres.`);
    return s;
  };
  const blobToDataUrl = (blob) => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob);
  });

  async function geocode(lat, lng) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=pt-BR&zoom=18`);
      const j = await r.json();
      const a = j.address || {};
      const street = a.road || a.pedestrian || a.square || a.amenity || j.name;
      const hood = a.suburb || a.neighbourhood || a.quarter;
      const city = a.city || a.town || a.village;
      const parts = [street, [hood, city].filter(Boolean).join(", ")].filter(Boolean);
      if (parts.length) return parts.join(" - ");
    } catch { /* usa coordenadas */ }
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }

  // ---------------- Rotas ----------------
  const routes = [];
  const route = (method, pattern, fn) => {
    const keys = [];
    const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/?]+)")) + "(?:\\?.*)?$");
    routes.push({ method, re, keys, fn });
  };

  route("GET", "/auth/channels", () => ({ sms: true, whatsapp: true }));
  route("POST", "/auth/send", ({ body }) => {
    const phone = normalizePhone(body.phone);
    const last = db.codes[phone];
    if (last && Date.now() - last.sentAt < MIN) throw new HttpError(429, "Espere um minuto para pedir outro código.", { retryAfter: 60 });
    const code = String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
    db.codes[phone] = { code, sentAt: Date.now(), attempts: 0 };
    save();
    return { phone, channel: body.channel === "whatsapp" ? "whatsapp" : "sms", resendIn: 60, devCode: code };
  });
  route("POST", "/auth/verify", ({ body }) => {
    const phone = normalizePhone(body.phone);
    const c = db.codes[phone];
    if (!c || Date.now() - c.sentAt > 10 * MIN) throw new HttpError(400, "Código vencido. Peça um novo.");
    if (c.attempts >= 5) throw new HttpError(429, "Muitas tentativas. Peça um novo código.");
    if (String(body.code) !== c.code) { c.attempts++; save(); throw new HttpError(400, "Código incorreto."); }
    delete db.codes[phone];
    const u = db.users.find((x) => x.phone === phone);
    if (u) {
      const token = rid("t");
      db.sessions[token] = u.id; save();
      return { token, user: self(u) };
    }
    const ticket = rid("s");
    db.tickets = { ...(db.tickets || {}), [ticket]: { phone, exp: Date.now() + 15 * MIN } };
    save();
    return { signupTicket: ticket, phone };
  });
  route("POST", "/users", ({ body }) => {
    const t = (db.tickets || {})[body.signupTicket];
    if (!t || t.exp < Date.now()) throw new HttpError(401, "Confirme seu telefone de novo para criar a conta.");
    const name = text(body.name, "nome", 1, 40);
    const handle = normalizeHandle(body.handle);
    if (db.users.some((u) => u.handle === handle)) throw new HttpError(409, `O @${handle} já está em uso. Escolha outro.`);
    const u = { id: rid("me"), name, handle, avatar: null, phone: t.phone };
    db.users.push(u);
    delete db.tickets[body.signupTicket];
    const token = rid("t");
    db.sessions[token] = u.id;
    notify(u.id, null, `Bem-vindo ao Rolê, ${name.split(" ")[0]}! Faça seu primeiro check-in.`);
    save();
    return { user: self(u), token };
  });
  route("DELETE", "/auth/session", ({ token }) => { delete db.sessions[token]; save(); return { ok: true }; });
  route("DELETE", "/auth/sessions", ({ token }) => {
    const u = me(token);
    for (const [k, v] of Object.entries(db.sessions)) if (v === u.id) delete db.sessions[k];
    save(); return { ok: true };
  });

  route("GET", "/me", ({ token }) => ({ user: self(me(token)) }));
  route("PATCH", "/me", ({ token, body }) => {
    const u = me(token);
    if (body.name !== undefined) u.name = text(body.name, "nome", 1, 40);
    if (body.handle !== undefined) {
      const h = normalizeHandle(body.handle);
      if (db.users.some((x) => x.handle === h && x.id !== u.id)) throw new HttpError(409, `O @${h} já está em uso. Escolha outro.`);
      u.handle = h;
    }
    if (body.avatar !== undefined) u.avatar = body.avatar;
    save();
    return { user: self(u) };
  });
  route("GET", "/me/summary", ({ token }) => {
    const u = me(token);
    const mine = db.posts.filter((p) => p.user_id === u.id).sort((a, b) => b.postedAt - a.postedAt);
    const likedIds = db.likes.filter((l) => l.user_id === u.id).sort((a, b) => b.at - a.at).map((l) => l.post_id);
    return {
      user: self(u),
      stats: {
        checkins: mine.length,
        likesReceived: db.likes.filter((l) => mine.some((p) => p.id === l.post_id)).length,
        comments: db.comments.filter((c) => c.user_id === u.id).length,
        following: db.follows.filter((f) => f.follower_id === u.id).length,
        followers: db.follows.filter((f) => f.followee_id === u.id).length,
      },
      posts: mine.map((p) => shape(p, u)),
      liked: likedIds.map((id) => db.posts.find((p) => p.id === id)).filter(Boolean).map((p) => shape(p, u)),
    };
  });

  route("POST", "/uploads", async ({ token, raw }) => {
    me(token);
    if (!raw || raw.size > 5 * 1024 * 1024) throw new HttpError(413, "A foto deve ter até 5 MB.");
    return { url: await blobToDataUrl(raw) };
  });
  route("GET", "/geocode", async ({ query }) => ({ place: await geocode(Number(query.get("lat")), Number(query.get("lng"))) }));

  route("GET", "/posts", ({ token }) => {
    const v = me(token, false);
    return { posts: db.posts.filter((p) => p.expiresAt > Date.now()).sort((a, b) => b.postedAt - a.postedAt).map((p) => shape(p, v)) };
  });
  route("POST", "/posts", async ({ token, body }) => {
    const u = me(token);
    const rating = Number(body.rating);
    if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, "Dê uma nota de 1 a 5 estrelas.");
    const dur = Number(body.durationMin);
    if (![60, 180, 360].includes(dur)) throw new HttpError(400, "Duração inválida.");
    const lat = Number(body.lat), lng = Number(body.lng);
    const now = Date.now();
    const p = {
      id: rid("p"), user_id: u.id, type: "role",
      title: text(body.title, "nome do rolê", 1, 60), description: text(body.description ?? "", "descrição", 0, 280),
      photo: body.photo, lat, lng, place: await geocode(lat, lng),
      rating, free: body.free !== false, postedAt: now, expiresAt: now + dur * MIN,
    };
    db.posts.unshift(p);
    save();
    return { post: shape(p, u) };
  });
  route("GET", "/posts/:id", ({ token, id }) => ({ post: shape(getPost(id), me(token, false)) }));
  route("DELETE", "/posts/:id", ({ token, id }) => {
    const u = me(token);
    const p = getPost(id);
    if (p.user_id !== u.id) throw new HttpError(403, "Você só pode apagar seus próprios check-ins.");
    db.posts = db.posts.filter((x) => x.id !== id);
    db.likes = db.likes.filter((l) => l.post_id !== id);
    db.comments = db.comments.filter((c) => c.post_id !== id);
    save();
    return { ok: true };
  });
  route("POST", "/posts/:id/like", ({ token, id }) => {
    const u = me(token);
    const p = getPost(id);
    if (!db.likes.some((l) => l.post_id === id && l.user_id === u.id)) {
      db.likes.push({ post_id: id, user_id: u.id, at: Date.now() });
      notify(p.user_id, u.id, `@${u.handle} curtiu seu rolê “${p.title}”`, id);
      save();
    }
    return { post: shape(p, u) };
  });
  route("DELETE", "/posts/:id/like", ({ token, id }) => {
    const u = me(token);
    db.likes = db.likes.filter((l) => !(l.post_id === id && l.user_id === u.id));
    save();
    return { post: shape(getPost(id), u) };
  });
  route("GET", "/posts/:id/comments", ({ id }) => ({
    comments: db.comments.filter((c) => c.post_id === id).sort((a, b) => a.at - b.at)
      .map((c) => ({ id: c.id, text: c.text, at: c.at, author: pub(userById(c.user_id)) })),
  }));
  route("POST", "/posts/:id/comments", ({ token, id, body }) => {
    const u = me(token);
    const p = getPost(id);
    const c = { id: rid("c"), post_id: id, user_id: u.id, text: text(body.text, "comentário", 1, 200), at: Date.now() };
    db.comments.push(c);
    notify(p.user_id, u.id, `@${u.handle} comentou: “${c.text.slice(0, 60)}”`, id);
    save();
    return { comment: { id: c.id, text: c.text, at: c.at, author: pub(u) } };
  });
  route("POST", "/users/:id/follow", ({ token, id }) => {
    const u = me(token);
    if (!db.follows.some((f) => f.follower_id === u.id && f.followee_id === id)) {
      db.follows.push({ follower_id: u.id, followee_id: id, at: Date.now() });
      save();
    }
    return { following: true };
  });
  route("DELETE", "/users/:id/follow", ({ token, id }) => {
    const u = me(token);
    db.follows = db.follows.filter((f) => !(f.follower_id === u.id && f.followee_id === id));
    save();
    return { following: false };
  });
  route("GET", "/notifications", ({ token }) => {
    const u = me(token);
    return { notifications: db.notifications.filter((n) => n.user_id === u.id).slice(0, 50) };
  });
  route("POST", "/notifications/read", ({ token }) => {
    const u = me(token);
    db.notifications.forEach((n) => { if (n.user_id === u.id) n.read = true; });
    save();
    return { ok: true };
  });

  async function request(path, { method = "GET", body, raw, token } = {}) {
    await new Promise((r) => setTimeout(r, 120)); // simula a rede
    const url = new URL(path, "https://demo.local");
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = path.match(r.re);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      try {
        return await r.fn({ ...params, token, body: body || {}, raw, query: url.searchParams });
      } catch (e) {
        if (e instanceof HttpError) {
          const err = new Error(e.message);
          err.status = e.status;
          throw err;
        }
        throw e;
      }
    }
    const err = new Error("Rota não encontrada.");
    err.status = 404;
    throw err;
  }

  // ---------------- Localização em tempo real (simulada) ----------------
  // Dois amigos fictícios andando pelo Centro, mais você quando liga o compartilhamento.
  class DemoLive {
    constructor(token) {
      this.readyState = 0;
      this.viewer = token ? userById(db.sessions[token]) : null;
      this.friends = [
        { user: pub(userById("u_rafa")), lat: -25.4305, lng: -49.2700 },
        { user: pub(userById("u_ju")), lat: -25.4318, lng: -49.2668 },
      ];
      this.mine = null;
      setTimeout(() => {
        this.readyState = 1;
        this.onopen && this.onopen();
        this.emit({ type: "snapshot", sharers: this.friends.map((f) => ({ ...f, updatedAt: Date.now(), until: 0 })) });
        this.timer = setInterval(() => this.tick(), 3000);
      }, 50);
    }
    tick() {
      for (const f of this.friends) {
        f.lat += (Math.random() - 0.5) * 0.00015;
        f.lng += (Math.random() - 0.5) * 0.00015;
        this.emit({ type: "update", sharer: { ...f, updatedAt: Date.now(), until: 0 } });
      }
    }
    emit(m) { this.onmessage && this.onmessage({ data: JSON.stringify(m) }); }
    send(raw) {
      const m = JSON.parse(raw);
      if (!this.viewer) return this.emit({ type: "error", message: "Crie sua conta para compartilhar a localização." });
      if (m.type === "start") this.mine = { user: pub(this.viewer), until: m.until || 0 };
      if (m.type === "pos" && this.mine) {
        Object.assign(this.mine, { lat: m.lat, lng: m.lng, updatedAt: Date.now() });
        this.emit({ type: "update", sharer: this.mine });
      }
      if (m.type === "stop" && this.mine) { this.mine = null; this.emit({ type: "remove", userId: this.viewer.id }); }
    }
    close() { clearInterval(this.timer); this.readyState = 3; }
  }

  window.RoleDemo = { request, DemoLive };
})();
