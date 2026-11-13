// Durable Object que distribui a localização em tempo real por WebSocket.
//
// Mensagens do cliente:
//   { type: "start", visibility: "friends" | "all", until: <ms ou 0> }
//   { type: "pos", lat, lng }
//   { type: "stop" }
// Mensagens do servidor:
//   { type: "snapshot", sharers: [...] }   ao conectar
//   { type: "update", sharer }             alguém se moveu / começou
//   { type: "remove", userId }             alguém parou (ou você perdeu a permissão de ver)
//   { type: "error", message }

const MAX_LIVE_MS = 24 * 60 * 60 * 1000;
const MIN_POS_INTERVAL_MS = 1000;

export class LiveHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sessions = new Map(); // ws -> { user }
    this.sharers = new Map(); // userId -> { user, lat, lng, visibility, until, allowed:Set, updatedAt }
    this.sweeper = null;
  }

  async fetch(req) {
    let user = null;
    try { user = JSON.parse(req.headers.get("x-role-user") || "null"); } catch { /* visitante */ }

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const session = { user };
    this.sessions.set(server, session);
    this.ensureSweeper();

    this.send(server, {
      type: "snapshot",
      sharers: [...this.sharers.values()].filter((s) => s.lat !== undefined && this.canSee(user, s)).map((s) => this.view(s)),
    });

    server.addEventListener("message", (ev) => this.onMessage(server, session, ev.data).catch((e) => {
      console.error(e);
      this.send(server, { type: "error", message: "Erro ao processar a localização." });
    }));
    const close = () => this.onClose(server, session);
    server.addEventListener("close", close);
    server.addEventListener("error", close);

    return new Response(null, { status: 101, webSocket: client });
  }

  async onMessage(ws, session, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const me = session.user;

    if (msg.type === "start") {
      if (!me) return this.send(ws, { type: "error", message: "Crie sua conta para compartilhar a localização." });
      const now = Date.now();
      const until = Number(msg.until) || 0;
      if (until && (until <= now || until > now + MAX_LIVE_MS)) return this.send(ws, { type: "error", message: "Duração inválida." });
      const visibility = msg.visibility === "all" ? "all" : "friends";
      const prev = this.sharers.get(me.id);
      const sharer = { ...(prev || {}), user: me, visibility, until, allowed: await this.loadAllowed(me.id) };
      this.sharers.set(me.id, sharer);
      session.sharing = true;
      if (sharer.lat !== undefined) this.broadcast(sharer);
      return;
    }

    if (msg.type === "pos") {
      const s = me && this.sharers.get(me.id);
      if (!s) return;
      const lat = Number(msg.lat), lng = Number(msg.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
      const now = Date.now();
      if (s.updatedAt && now - s.updatedAt < MIN_POS_INTERVAL_MS) return;
      if (s.until && s.until <= now) return this.removeSharer(me.id);
      Object.assign(s, { lat, lng, updatedAt: now });
      this.broadcast(s);
      return;
    }

    if (msg.type === "stop" && me) {
      session.sharing = false;
      this.removeSharer(me.id);
    }
  }

  onClose(ws, session) {
    this.sessions.delete(ws);
    const me = session.user;
    // Se a pessoa fechou o app e não tem outra aba aberta compartilhando, ela some do mapa.
    if (me && session.sharing && ![...this.sessions.values()].some((s) => s.user?.id === me.id && s.sharing)) {
      this.removeSharer(me.id);
    }
    if (!this.sessions.size && this.sweeper) { clearInterval(this.sweeper); this.sweeper = null; }
  }

  // "Amigos" = pessoas que o dono da localização segue.
  async loadAllowed(userId) {
    const { results } = await this.env.DB.prepare("SELECT followee_id FROM follows WHERE follower_id = ?").bind(userId).all();
    return new Set(results.map((r) => r.followee_id));
  }

  canSee(viewer, s) {
    if (viewer && viewer.id === s.user.id) return true;
    if (s.visibility === "all") return true;
    return !!viewer && s.allowed.has(viewer.id);
  }

  view(s) {
    return { user: s.user, lat: s.lat, lng: s.lng, updatedAt: s.updatedAt, until: s.until };
  }

  broadcast(s) {
    for (const [ws, session] of this.sessions) {
      this.send(ws, this.canSee(session.user, s) ? { type: "update", sharer: this.view(s) } : { type: "remove", userId: s.user.id });
    }
  }

  removeSharer(userId) {
    if (!this.sharers.delete(userId)) return;
    for (const ws of this.sessions.keys()) this.send(ws, { type: "remove", userId });
  }

  // Encerra compartilhamentos vencidos e atualiza a lista de amigos periodicamente.
  ensureSweeper() {
    if (this.sweeper) return;
    this.sweeper = setInterval(async () => {
      const now = Date.now();
      for (const [id, s] of this.sharers) {
        if (s.until && s.until <= now) { this.removeSharer(id); continue; }
        try { s.allowed = await this.loadAllowed(id); } catch { /* tenta de novo depois */ }
      }
    }, 30 * 1000);
  }

  send(ws, data) {
    try { ws.send(JSON.stringify(data)); } catch { /* conexão fechada */ }
  }
}
