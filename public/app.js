(() => {
  "use strict";

  const TOKEN_KEY = "role:token";
  const LIVE_KEY = "role:live";
  const CENTER = [-25.4285, -49.2700]; // Centro de Curitiba
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const enc = encodeURIComponent;
  const MIN = 60 * 1000;

  // ---------------- Estado ----------------
  const state = {
    token: localStorage.getItem(TOKEN_KEY),
    user: null,
    posts: [],
    notifications: [],
    liveSettings: { visibility: "friends", duration: 60 },
    live: { active: false, until: 0 },
    sharers: new Map(), // userId -> { user, lat, lng, until }
    tab: "roles",
    search: "",
    selected: null,
    myPos: null,
    history: [],
  };
  try { Object.assign(state, JSON.parse(localStorage.getItem(LIVE_KEY)) || {}); } catch { /* ignora */ }
  const persistLive = () => localStorage.setItem(LIVE_KEY, JSON.stringify({ liveSettings: state.liveSettings, live: state.live }));

  // ---------------- API ----------------
  async function api(path, { method = "GET", body, raw, contentType } = {}) {
    if (window.RoleDemo) return window.RoleDemo.request(path, { method, body, raw, token: state.token });
    const headers = {};
    if (state.token) headers.authorization = "Bearer " + state.token;
    if (body !== undefined) headers["content-type"] = "application/json";
    if (raw) headers["content-type"] = contentType;
    let res;
    try {
      res = await fetch("/api" + path, { method, headers, body: raw || (body !== undefined ? JSON.stringify(body) : undefined) });
    } catch {
      throw new Error("Sem conexão. Verifique sua internet.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "Algo deu errado.");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const findPost = (id) => state.posts.find((p) => p.id === id);
  const isActive = (p) => p.expiresAt > Date.now();
  function upsertPost(p) {
    const i = state.posts.findIndex((x) => x.id === p.id);
    if (i >= 0) state.posts[i] = p; else state.posts.unshift(p);
  }

  async function loadPosts() {
    try {
      const { posts } = await api("/posts");
      state.posts = posts;
      renderMarkers();
      if (state.selected) {
        const p = findPost(state.selected);
        if (p) updatePostCounts(p);
      }
    } catch (e) { toast(e.message); }
  }

  async function loadNotifications() {
    if (!state.user) { state.notifications = []; syncNotifDot(); return; }
    try {
      state.notifications = (await api("/notifications")).notifications;
      syncNotifDot();
    } catch { /* silencioso */ }
  }

  // ---------------- Helpers ----------------
  function initials(name = "?") {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  }
  function esc(s = "") {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  // Avatar com fallback para iniciais se a imagem não carregar
  function faceHTML(person) {
    const img = person && person.avatar
      ? `<img src="${esc(person.avatar)}" alt="" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit">`
      : "";
    return `<span style="position:relative;display:grid;place-items:center;width:100%;height:100%;border-radius:inherit">${esc(initials(person && person.name))}${img}</span>`;
  }
  const setAvatar = (el, person) => { el.innerHTML = faceHTML(person); };

  function fmtClock(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}h${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function fmtRemaining(ms, withSeconds = false) {
    if (ms <= 0) return "00:00";
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const p = (n) => String(n).padStart(2, "0");
    return withSeconds ? (h ? `${p(h)}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`) : `${p(h)}:${p(m)}`;
  }
  function timeAgo(ts) {
    const m = Math.round((Date.now() - ts) / MIN);
    if (m < 1) return "agora";
    if (m < 60) return `há ${m} min`;
    const h = Math.round(m / 60);
    return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
  }
  function distanceKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  const fmtDist = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
  }

  // Redimensiona a foto no aparelho antes de enviar (economiza dados).
  function resizeImage(file, max = 1080) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Não foi possível ler a foto.")); };
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Não foi possível ler a foto."))), "image/jpeg", 0.82);
      };
      img.src = url;
    });
  }
  async function uploadPhoto(blob) {
    return (await api("/uploads", { method: "POST", raw: blob, contentType: "image/jpeg" })).url;
  }

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("Seu navegador não suporta GPS."));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve([p.coords.latitude, p.coords.longitude]),
        (e) => reject(new Error(e.code === 1 ? "Permita o acesso à localização para continuar." : "Não foi possível obter sua localização.")),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
      );
    });
  }

  // ---------------- Navegação ----------------
  function show(id) {
    const current = $(".screen.active");
    if (current && current.id !== id) state.history.push(current.id);
    $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    if (id === "screen-map") { initMap(); setTimeout(() => map.invalidateSize(), 50); }
    if (id === "screen-member") renderMember();
  }
  function back() {
    const prev = state.history.pop() || "screen-welcome";
    $$(".screen").forEach((s) => s.classList.toggle("active", s.id === prev));
    if (prev === "screen-map") setTimeout(() => map && map.invalidateSize(), 50);
  }

  function openSheet(id) {
    closeDrawer();
    $$(".sheet.open").forEach((s) => s.classList.remove("open"));
    $("#sheet-backdrop").classList.add("open");
    $("#" + id).classList.add("open");
  }
  function closeSheets() {
    $$(".sheet.open").forEach((s) => s.classList.remove("open"));
    $("#sheet-backdrop").classList.remove("open");
    stopCheckinLocation();
  }
  function openDrawer() { renderDrawer(); $("#drawer").classList.add("open"); }
  function closeDrawer() { $("#drawer").classList.remove("open"); }

  let pendingAfterSignup = null;
  function requireAccount(then) {
    if (state.user) return true;
    pendingAfterSignup = then || null;
    closeSheets(); closeDrawer();
    toast("Entre ou crie sua conta para continuar.");
    startAuth();
    return false;
  }

  // ---------------- Mapa ----------------
  let map, markersLayer, liveLayer;
  const liveMarkers = new Map();

  function initMap() {
    if (map) return;
    map = L.map("map", { zoomControl: false }).setView(CENTER, 17);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
    liveLayer = L.layerGroup().addTo(map);
    renderMarkers();
    renderLive();
  }

  function visiblePosts() {
    const q = state.search.trim().toLowerCase();
    return state.posts.filter((p) => {
      if (!isActive(p)) return false;
      if ((state.tab === "events") !== (p.type === "event")) return false;
      if (!q) return true;
      return [p.title, p.place, p.description, p.author.name, "@" + p.author.handle].join(" ").toLowerCase().includes(q);
    });
  }

  function renderMarkers() {
    if (!map) return;
    markersLayer.clearLayers();
    visiblePosts().forEach((p) => {
      const isEvent = p.type === "event";
      const html = `<div class="pin ${isEvent ? "event" : ""} ${state.selected === p.id ? "selected" : ""}">
          <div class="pin-img">${faceHTML({ name: p.author.name, avatar: isEvent ? p.photo : p.author.avatar })}</div>
        </div>`;
      const icon = L.divIcon({ className: "pin-wrap", html, iconSize: [64, 80], iconAnchor: [32, 80] });
      L.marker([p.lat, p.lng], { icon, title: p.title, riseOnHover: true })
        .on("click", () => openPost(p.id))
        .addTo(markersLayer);
    });
  }

  function liveIcon(person, me = false) {
    return L.divIcon({
      className: "pin-wrap",
      html: `<div class="live-pin ${me ? "me" : ""}"><div class="ring"></div><div class="face">${faceHTML(person)}</div><div class="tag">${me ? "VOCÊ" : "AO VIVO"}</div></div>`,
      iconSize: [46, 46], iconAnchor: [23, 23],
    });
  }

  function renderLive() {
    if (!map) return;
    for (const [id, m] of liveMarkers) {
      if (!state.sharers.has(id)) { m.remove(); liveMarkers.delete(id); }
    }
    for (const [id, s] of state.sharers) {
      const me = state.user && id === state.user.id;
      let m = liveMarkers.get(id);
      if (!m) {
        m = L.marker([s.lat, s.lng], { icon: liveIcon(s.user, me), zIndexOffset: me ? 1000 : 500, title: `${s.user.name} (ao vivo)` })
          .bindPopup(`<b>${esc(s.user.name)}</b><br>@${esc(s.user.handle)} · ao vivo`)
          .addTo(liveLayer);
        liveMarkers.set(id, m);
      } else {
        m.setLatLng([s.lat, s.lng]);
      }
    }
  }

  // ---------------- Post ----------------
  function openPost(id) {
    const p = findPost(id);
    if (!p) return;
    state.selected = id;
    renderMarkers();

    $("#post-photo").style.backgroundImage = `url("${p.photo}")`;
    const av = $("#post-avatar");
    av.onerror = () => av.removeAttribute("src");
    if (p.author.avatar) av.src = p.author.avatar; else av.removeAttribute("src");
    $("#post-handle").textContent = "@" + p.author.handle;
    $("#post-time").textContent = fmtClock(p.postedAt);
    const price = $("#post-price");
    price.textContent = p.free ? "GRÁTIS" : "PAGO";
    price.classList.toggle("paid", !p.free);
    $("#post-title").textContent = p.title;
    $("#post-description").textContent = p.description || "";
    $("#post-rating b").textContent = p.rating;
    $("#post-rating").setAttribute("aria-label", `Avaliação de quem postou: ${p.rating} de 5 estrelas`);
    $("#post-location").textContent = p.place;
    updatePostCounts(p);
    updateCountdown();

    $("#post-view").classList.add("open");
    $("#post-view").setAttribute("aria-hidden", "false");

    // Posiciona o pin na parte de cima, acima do card
    const h = map.getSize().y;
    map.setView([p.lat, p.lng], Math.max(map.getZoom(), 17), { animate: false });
    map.panBy([0, h * 0.36], { animate: true });
  }

  function closePost() {
    state.selected = null;
    $("#post-view").classList.remove("open");
    $("#post-view").setAttribute("aria-hidden", "true");
    renderMarkers();
  }

  function updatePostCounts(p) {
    $("#btn-like").classList.toggle("liked", p.liked);
    $("#btn-like").setAttribute("aria-pressed", p.liked);
    $("#like-count").textContent = p.likes || "";
    $("#comment-count").textContent = p.commentCount || "";
    const f = $("#btn-follow");
    f.classList.toggle("hidden", p.mine || p.type === "event");
    f.classList.toggle("on", p.following);
    f.textContent = p.following ? "Amigos ✓" : "Seguir";
  }

  function updateCountdown() {
    const p = state.selected && findPost(state.selected);
    if (!p) return;
    const left = p.expiresAt - Date.now();
    $("#post-countdown").textContent = fmtRemaining(left);
    $("#post-countdown").title = `Status visível por mais ${fmtRemaining(left)} (horas:minutos)`;
  }

  async function toggleLike() {
    const p = findPost(state.selected);
    if (!p || !requireAccount()) return;
    const wasLiked = p.liked;
    Object.assign(p, { liked: !wasLiked, likes: p.likes + (wasLiked ? -1 : 1) });
    updatePostCounts(p);
    try {
      const { post } = await api(`/posts/${p.id}/like`, { method: wasLiked ? "DELETE" : "POST" });
      upsertPost(post);
      if (state.selected === post.id) updatePostCounts(post);
    } catch (e) {
      Object.assign(p, { liked: wasLiked, likes: p.likes + (wasLiked ? 1 : -1) });
      updatePostCounts(p);
      toast(e.message);
    }
  }

  async function toggleFollow() {
    const p = findPost(state.selected);
    if (!p || !requireAccount()) return;
    const was = p.following;
    try {
      await api(`/users/${p.author.id}/follow`, { method: was ? "DELETE" : "POST" });
      state.posts.filter((x) => x.author.id === p.author.id).forEach((x) => (x.following = !was));
      updatePostCounts(p);
      toast(was ? `Você deixou de seguir @${p.author.handle}` : `@${p.author.handle} agora é seu amigo no Rolê`);
      sendLiveStart(); // atualiza quem pode ver sua localização
    } catch (e) { toast(e.message); }
  }

  async function openComments() {
    const p = findPost(state.selected);
    if (!p) return;
    $("#comment-list").innerHTML = `<li class="muted">Carregando...</li>`;
    openSheet("sheet-comments");
    try {
      const { comments } = await api(`/posts/${p.id}/comments`);
      renderComments(comments);
    } catch (e) {
      $("#comment-list").innerHTML = `<li class="muted">${esc(e.message)}</li>`;
    }
  }
  let currentComments = [];
  function renderComments(list) {
    currentComments = list;
    $("#comment-list").innerHTML = list.length
      ? list.map((c) => `<li><span class="avatar">${faceHTML(c.author)}</span>
          <div><p><b>@${esc(c.author.handle)}</b> ${esc(c.text)}</p><small>${timeAgo(c.at)}</small></div></li>`).join("")
      : `<li class="muted">Nenhum comentário ainda. Seja o primeiro!</li>`;
    const ul = $("#comment-list");
    ul.scrollTop = ul.scrollHeight;
  }
  async function submitComment(e) {
    e.preventDefault();
    const p = findPost(state.selected);
    if (!p || !requireAccount()) return;
    const input = $("#comment-input");
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    try {
      const { comment } = await api(`/posts/${p.id}/comments`, { method: "POST", body: { text } });
      input.value = "";
      renderComments([...currentComments, comment]);
      p.commentCount++;
      updatePostCounts(p);
    } catch (err) { toast(err.message); }
    input.disabled = false;
  }

  async function sharePost() {
    const p = findPost(state.selected);
    if (!p) return;
    const url = `${location.origin}${location.pathname}?role=${enc(p.id)}`;
    const data = { title: `Rolê: ${p.title}`, text: `${p.title} — ${p.place}`, url };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(`${data.text}\n${url}`); toast("Link copiado!"); }
    } catch { /* cancelado */ }
  }

  function openRide() {
    const p = findPost(state.selected);
    if (!p) return;
    $("#ride-destination").textContent = `${p.title} · ${p.place}`;
    $("#ride-uber").href =
      `https://m.uber.com/ul/?action=setPickup&pickup=my_location` +
      `&dropoff[latitude]=${p.lat}&dropoff[longitude]=${p.lng}` +
      `&dropoff[nickname]=${enc(p.title)}&dropoff[formatted_address]=${enc(p.place)}`;
    Object.assign($("#ride-99").dataset, { lat: p.lat, lng: p.lng, title: p.title });
    $("#ride-maps").href = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
    openSheet("sheet-ride");
  }
  function open99(e) {
    e.preventDefault();
    const { lat, lng, title } = e.currentTarget.dataset;
    const ua = navigator.userAgent;
    const store = /android/i.test(ua)
      ? "https://play.google.com/store/apps/details?id=com.taxis99"
      : /iphone|ipad|ipod/i.test(ua) ? "https://apps.apple.com/br/app/99/id553663691" : "https://99app.com/";
    // Tenta abrir o app da 99 com o destino; se não abrir, vai para a loja/site.
    const fallback = setTimeout(() => { if (!document.hidden) window.open(store, "_blank"); }, 1500);
    document.addEventListener("visibilitychange", () => clearTimeout(fallback), { once: true });
    window.location.href = `taxis99://call?end_lat=${lat}&end_lng=${lng}&end_title=${enc(title)}`;
  }

  // ---------------- Lista ----------------
  function postItem(p, side) {
    return `<li data-post="${p.id}">
      <span class="thumb" style="background-image:url('${esc(p.photo)}')"></span>
      <span class="meta"><b>${esc(p.title)}</b><span>${side.sub}</span></span>
      ${side.right}
    </li>`;
  }
  function openList() {
    const origin = state.myPos || (map ? [map.getCenter().lat, map.getCenter().lng] : CENTER);
    const items = visiblePosts().map((p) => ({ p, d: distanceKm(origin, [p.lat, p.lng]) })).sort((a, b) => a.d - b.d);
    $("#list-title").textContent = state.tab === "events" ? "Eventos perto de você" : "Rolês perto de você";
    $("#list-items").innerHTML = items.length
      ? items.map(({ p, d }) => postItem(p, {
          sub: `@${esc(p.author.handle)} · ★ ${p.rating} · ${p.free ? "Grátis" : "Pago"}`,
          right: `<span class="side">${fmtDist(d)}<br><span class="muted">${fmtClock(p.postedAt)}</span></span>`,
        })).join("")
      : `<li class="empty">Nada por aqui ainda. Que tal fazer um check-in?</li>`;
    openSheet("sheet-list");
  }

  // ---------------- Check-in ----------------
  let checkin;
  let checkinRequest = 0;

  function openCheckin() {
    if (!requireAccount("checkin")) return;
    checkin = { photo: null, preview: null, pos: null, place: null, rating: 0, free: true, duration: 180 };
    $("#checkin-form").reset();
    const prev = $("#checkin-preview");
    prev.style.backgroundImage = "";
    prev.classList.remove("has-img");
    setChips("#checkin-price", "free");
    setChips("#checkin-duration", "180");
    renderStarsInput();
    validateCheckin();
    openSheet("sheet-checkin");
    locateForCheckin();
  }
  async function locateForCheckin() {
    const req = ++checkinRequest;
    const label = $("#checkin-location");
    label.textContent = "Obtendo sua localização...";
    try {
      const pos = await getPosition();
      if (req !== checkinRequest) return;
      checkin.pos = state.myPos = pos;
      label.textContent = "Localização encontrada, buscando endereço...";
      const { place } = await api(`/geocode?lat=${pos[0]}&lng=${pos[1]}`);
      if (req !== checkinRequest) return;
      checkin.place = place;
      label.textContent = place;
    } catch (err) {
      if (req !== checkinRequest) return;
      label.innerHTML = `${esc(err.message)} <button type="button" class="link" id="retry-loc">Tentar de novo</button>`;
      $("#retry-loc").onclick = locateForCheckin;
    }
    validateCheckin();
  }
  function stopCheckinLocation() { checkinRequest++; }

  function renderStarsInput() {
    $("#checkin-stars").innerHTML = [1, 2, 3, 4, 5].map((n) =>
      `<button type="button" data-star="${n}" class="${n <= checkin.rating ? "on" : ""}" aria-label="${n} estrela${n > 1 ? "s" : ""}"><svg><use href="#i-star"/></svg></button>`
    ).join("");
  }
  function validateCheckin() {
    const ok = checkin && checkin.photo && checkin.pos && checkin.place && checkin.rating > 0 && $("#checkin-title").value.trim();
    $("#checkin-submit").disabled = !ok;
  }
  async function submitCheckin(e) {
    e.preventDefault();
    const btn = $("#checkin-submit");
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "Postando...";
    try {
      const photo = await uploadPhoto(checkin.photo);
      const { post } = await api("/posts", {
        method: "POST",
        body: {
          title: $("#checkin-title").value.trim(),
          description: $("#checkin-desc").value.trim(),
          photo, lat: checkin.pos[0], lng: checkin.pos[1],
          rating: checkin.rating, free: checkin.free, durationMin: checkin.duration,
        },
      });
      upsertPost(post);
      closeSheets();
      state.tab = "roles";
      syncTabs();
      renderMarkers();
      toast("Check-in postado! 🎉");
      openPost(post.id);
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
    btn.textContent = "Postar check-in";
  }

  function setChips(sel, value) {
    $$(sel + " .chip-opt").forEach((b) => b.classList.toggle("active", b.dataset.value === String(value)));
  }

  // ---------------- Localização em tempo real (WebSocket) ----------------
  let ws = null, wsRetry = 0, wsTimer = null, liveWatch = null;

  function connectLive() {
    clearTimeout(wsTimer);
    if (ws) { ws.onclose = null; ws.close(); }
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const q = state.token ? `?token=${enc(state.token)}` : "";
    ws = window.RoleDemo ? new window.RoleDemo.DemoLive(state.token) : new WebSocket(`${proto}://${location.host}/api/live${q}`);
    ws.onopen = () => {
      wsRetry = 0;
      if (state.live.active) { sendLiveStart(); sendMyPos(); }
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === "snapshot") {
        state.sharers = new Map(m.sharers.map((s) => [s.user.id, s]));
      } else if (m.type === "update") {
        state.sharers.set(m.sharer.user.id, m.sharer);
      } else if (m.type === "remove") {
        state.sharers.delete(m.userId);
      } else if (m.type === "error") {
        toast(m.message);
      }
      renderLive();
    };
    ws.onclose = () => {
      // Reconecta com espera crescente (1s, 2s, 4s... até 30s)
      wsTimer = setTimeout(connectLive, Math.min(30000, 1000 * 2 ** wsRetry++));
    };
  }
  const wsSend = (msg) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
  function sendLiveStart() {
    if (!state.live.active) return;
    wsSend({ type: "start", visibility: state.liveSettings.visibility, until: state.live.until });
  }
  function sendMyPos() {
    if (state.live.active && state.myPos) wsSend({ type: "pos", lat: state.myPos[0], lng: state.myPos[1] });
  }

  function openLiveSettings() {
    if (!requireAccount("live")) return;
    setChips("#live-visibility", state.liveSettings.visibility);
    setChips("#live-duration", state.liveSettings.duration);
    syncLiveUI();
    openSheet("sheet-live");
  }

  function startLive(resume = false) {
    if (!state.user) return;
    if (!navigator.geolocation) { toast("Seu navegador não suporta GPS."); return; }
    if (!resume) {
      const dur = Number(state.liveSettings.duration);
      state.live = { active: true, until: dur ? Date.now() + dur * MIN : 0 };
      persistLive();
    }
    sendLiveStart();
    if (liveWatch !== null) navigator.geolocation.clearWatch(liveWatch);
    let first = !resume;
    liveWatch = navigator.geolocation.watchPosition(
      (p) => {
        state.myPos = [p.coords.latitude, p.coords.longitude];
        sendMyPos();
        if (first && map) { map.setView(state.myPos, 17); first = false; }
      },
      (err) => {
        if (err.code === 1) {
          toast("Permita o acesso à localização para compartilhar.");
          stopLive(true);
        } else {
          // Falha momentânea do GPS (túnel, prédio): continua tentando.
          toast("Sinal de GPS fraco, tentando de novo...");
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    syncLiveUI();
    if (!resume) {
      closeSheets();
      toast(`Compartilhando sua localização com ${state.liveSettings.visibility === "all" ? "todos" : "seus amigos"}.`);
    }
  }

  function stopLive(silent = false) {
    if (liveWatch !== null) navigator.geolocation.clearWatch(liveWatch);
    liveWatch = null;
    wsSend({ type: "stop" });
    if (state.user) state.sharers.delete(state.user.id);
    renderLive();
    state.live = { active: false, until: 0 };
    persistLive();
    syncLiveUI();
    if (!silent) toast("Você parou de compartilhar sua localização.");
  }

  function syncLiveUI() {
    const on = state.live.active;
    $("#live-banner").classList.toggle("hidden", !on);
    $("#live-start").textContent = on ? "Atualizar e continuar" : "Começar a compartilhar";
    $("#live-stop-btn").classList.toggle("hidden", !on);
    $("#live-share-link").classList.toggle("hidden", !on);
    $("#member-live-toggle").checked = on;
    const who = state.liveSettings.visibility === "all" ? "Todos" : "Amigos";
    $("#member-live-status").textContent = on
      ? `Ligada · visível para ${who}${state.live.until ? " · até " + fmtClock(state.live.until) : " · sem limite"}`
      : "Desligada";
    updateLiveTimer();
  }

  function updateLiveTimer() {
    if (!state.live.active) return;
    if (state.live.until) {
      const left = state.live.until - Date.now();
      if (left <= 0) { stopLive(true); toast("O tempo de compartilhamento acabou."); return; }
      $("#live-timer").textContent = fmtRemaining(left, true);
    } else {
      $("#live-timer").textContent = "sem limite";
    }
  }

  async function shareLiveLink() {
    const pos = state.myPos;
    if (!pos) { toast("Aguardando sua localização..."); return; }
    const url = `https://www.google.com/maps/search/?api=1&query=${pos[0]},${pos[1]}`;
    const text = `@${state.user.handle} está no rolê! Posição atual:`;
    try {
      if (navigator.share) await navigator.share({ title: "Minha localização · Rolê", text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); toast("Link copiado!"); }
    } catch { /* cancelado */ }
  }

  // ---------------- Conta / Área do membro ----------------
  function renderDrawer() {
    const u = state.user;
    setAvatar($("#drawer-avatar"), u || { name: "?" });
    $("#drawer-name").textContent = u ? u.name : "Visitante";
    $("#drawer-handle").textContent = u ? "@" + u.handle : "Crie sua conta para postar";
    $("#drawer-auth").classList.toggle("hidden", !!u);
  }

  async function renderMember() {
    const u = state.user;
    if (!u) return;
    setAvatar($("#member-avatar"), u);
    $("#member-name").textContent = u.name;
    $("#member-handle").textContent = "@" + u.handle;
    $("#member-phone").textContent = u.phone ? formatPhone(u.phone) : (u.email || "");
    $("#change-password-btn").textContent = u.hasPassword ? "Trocar senha" : "Criar senha";
    syncLiveUI();
    try {
      const s = await api("/me/summary");
      $("#stat-checkins").textContent = s.stats.checkins;
      $("#stat-likes").textContent = s.stats.likesReceived;
      $("#stat-friends").textContent = s.stats.following;
      $("#my-posts").innerHTML = s.posts.length
        ? s.posts.map((p) => postItem(p, {
            sub: `${esc(p.place)} · ${isActive(p) ? "ativo · " + fmtRemaining(p.expiresAt - Date.now()) : "encerrado"} · ♥ ${p.likes}`,
            right: `<button class="del" data-delete="${p.id}">Apagar</button>`,
          })).join("")
        : `<li class="empty">Você ainda não fez check-in.</li>`;
      $("#my-likes").innerHTML = s.liked.length
        ? s.liked.map((p) => postItem(p, { sub: `@${esc(p.author.handle)} · ★ ${p.rating}`, right: "" })).join("")
        : `<li class="empty">Nenhuma curtida ainda.</li>`;
      s.posts.concat(s.liked).forEach((p) => { if (!findPost(p.id)) state.posts.push(p); });
    } catch (e) { toast(e.message); }
  }

  let profileDraftAvatar = null; // Blob | null
  let signupAvatar = null; // Blob | null

  function openProfileEdit() {
    const u = state.user;
    if (!u) return;
    profileDraftAvatar = null;
    setAvatar($("#profile-avatar"), u);
    $("#profile-name").value = u.name;
    $("#profile-handle").value = u.handle;
    openSheet("sheet-profile");
  }

  const normalizeHandle = (v) => v.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_.]/g, "");

  async function openNotifications() {
    openSheet("sheet-notifications");
    if (!state.user) {
      $("#notif-list").innerHTML = `<li class="empty">Crie sua conta para receber notificações.</li>`;
      return;
    }
    await loadNotifications();
    $("#notif-list").innerHTML = state.notifications.length
      ? state.notifications.map((n) => `<li ${n.postId ? `data-post="${n.postId}"` : ""}><span class="meta"><b style="white-space:normal">${esc(n.text)}</b><span>${timeAgo(n.at)}</span></span></li>`).join("")
      : `<li class="empty">Sem notificações.</li>`;
    if (state.notifications.some((n) => !n.read)) {
      api("/notifications/read", { method: "POST" }).catch(() => {});
      state.notifications.forEach((n) => (n.read = true));
      syncNotifDot();
    }
  }
  const syncNotifDot = () => $("#notif-dot").classList.toggle("hidden", !state.notifications.some((n) => !n.read));
  const syncTabs = () => $$(".seg").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));

  function setSession(user, token) {
    state.user = user;
    if (token) { state.token = token; localStorage.setItem(TOKEN_KEY, token); }
    connectLive();
    loadPosts();
    loadNotifications();
  }

  // ---------------- Eventos ----------------
  const actions = {
    discover: () => show("screen-map"),
    signup: () => startAuth("register"),
    back,
    "back-map": () => show("screen-map"),
    menu: openDrawer,
    member: () => { closeDrawer(); if (requireAccount("member")) show("screen-member"); },
    search: () => {
      const bar = $(".pill-bar");
      const on = bar.classList.toggle("searching");
      if (on) $("#search-input").focus();
      else { $("#search-input").value = ""; state.search = ""; renderMarkers(); }
    },
    notifications: openNotifications,
    list: openList,
    checkin: openCheckin,
    locate: async () => {
      try {
        state.myPos = await getPosition();
        map.setView(state.myPos, 17);
      } catch (e) { toast(e.message); }
    },
    "close-post": closePost,
    "open-author": () => {
      const p = findPost(state.selected);
      if (!p) return;
      closePost();
      $(".pill-bar").classList.add("searching");
      $("#search-input").value = state.search = "@" + p.author.handle;
      renderMarkers();
      toast(`Rolês de ${p.author.name}`);
    },
    follow: toggleFollow,
    like: toggleLike,
    comments: openComments,
    share: sharePost,
    go: openRide,
    "live-settings": openLiveSettings,
    "live-start": () => startLive(false),
    "live-stop": () => { stopLive(); closeSheets(); },
    "live-link": shareLiveLink,
    "edit-profile": openProfileEdit,
    logout: async () => {
      if (!confirm("Sair da conta neste aparelho? Para entrar de novo, é só usar o mesmo celular.")) return;
      await signOut("/auth/session");
    },
    "logout-all": async () => {
      if (!confirm("Sair da conta em todos os aparelhos?")) return;
      await signOut("/auth/sessions");
    },
    login: () => startAuth("login"),
    "auth-back": () => {
      if (authStep === "choose") back();
      else if (authStep === "code") setAuthStep("phone");
      else setAuthStep("choose");
    },
    "auth-register": () => openRegister(),
    "auth-login": () => { setAuthStep("login"); setTimeout(() => $("#login-handle").focus(), 100); },
    "change-password": openPasswordSheet,
    "auth-change-phone": () => setAuthStep("phone"),
    "auth-use-phone": () => { setAuthStep("phone"); setTimeout(() => $("#phone-input").focus(), 100); },
  };

  document.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-action]");
    if (a && actions[a.dataset.action]) { e.preventDefault(); e.stopPropagation(); actions[a.dataset.action](); return; }

    const del = e.target.closest("[data-delete]");
    if (del) {
      e.stopPropagation();
      if (!confirm("Apagar este check-in?")) return;
      try {
        await api(`/posts/${del.dataset.delete}`, { method: "DELETE" });
        state.posts = state.posts.filter((p) => p.id !== del.dataset.delete);
        renderMember(); renderMarkers();
        toast("Check-in apagado.");
      } catch (err) { toast(err.message); }
      return;
    }

    const item = e.target.closest("[data-post]");
    if (item) {
      let p = findPost(item.dataset.post);
      if (!p) {
        try { p = (await api(`/posts/${item.dataset.post}`)).post; upsertPost(p); } catch (err) { toast(err.message); return; }
      }
      if (!isActive(p)) { toast("Esse status já encerrou."); return; }
      closeSheets();
      if (!$("#screen-map").classList.contains("active")) show("screen-map");
      state.tab = p.type === "event" ? "events" : "roles";
      syncTabs(); renderMarkers();
      openPost(p.id);
    }
  });

  $("#sheet-backdrop").addEventListener("click", closeSheets);
  $("#drawer").addEventListener("click", (e) => { if (e.target.id === "drawer") closeDrawer(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if ($(".sheet.open")) closeSheets();
    else if ($("#drawer").classList.contains("open")) closeDrawer();
    else if (state.selected) closePost();
  });

  $$(".seg").forEach((b) => b.addEventListener("click", () => { state.tab = b.dataset.tab; syncTabs(); closePost(); }));
  $("#search-input").addEventListener("input", (e) => { state.search = e.target.value; renderMarkers(); });
  $("#ride-99").addEventListener("click", open99);
  $("#comment-form").addEventListener("submit", submitComment);

  // Check-in
  $("#checkin-photo").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      checkin.photo = await resizeImage(f);
      if (checkin.preview) URL.revokeObjectURL(checkin.preview);
      checkin.preview = URL.createObjectURL(checkin.photo);
      const prev = $("#checkin-preview");
      prev.style.backgroundImage = `url("${checkin.preview}")`;
      prev.classList.add("has-img");
    } catch (err) { toast(err.message); }
    validateCheckin();
  });
  $("#checkin-stars").addEventListener("click", (e) => {
    const b = e.target.closest("[data-star]");
    if (!b) return;
    checkin.rating = Number(b.dataset.star);
    renderStarsInput();
    validateCheckin();
  });
  $("#checkin-price").addEventListener("click", (e) => {
    const b = e.target.closest(".chip-opt"); if (!b) return;
    checkin.free = b.dataset.value === "free"; setChips("#checkin-price", b.dataset.value);
  });
  $("#checkin-duration").addEventListener("click", (e) => {
    const b = e.target.closest(".chip-opt"); if (!b) return;
    checkin.duration = Number(b.dataset.value); setChips("#checkin-duration", b.dataset.value);
  });
  $("#checkin-title").addEventListener("input", validateCheckin);
  $("#checkin-form").addEventListener("submit", submitCheckin);

  // Localização em tempo real
  $("#live-visibility").addEventListener("click", (e) => {
    const b = e.target.closest(".chip-opt"); if (!b) return;
    state.liveSettings.visibility = b.dataset.value; setChips("#live-visibility", b.dataset.value); persistLive();
  });
  $("#live-duration").addEventListener("click", (e) => {
    const b = e.target.closest(".chip-opt"); if (!b) return;
    state.liveSettings.duration = Number(b.dataset.value); setChips("#live-duration", b.dataset.value); persistLive();
  });
  $("#member-live-toggle").addEventListener("change", (e) => {
    if (e.target.checked) { initMap(); startLive(false); } else stopLive();
  });

  // Cadastro
  $("#signup-photo").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      signupAvatar = await resizeImage(f, 400);
      setAvatar($("#signup-avatar"), { name: $("#signup-name").value || "?", avatar: URL.createObjectURL(signupAvatar) });
    } catch (err) { toast(err.message); }
  });
  $("#signup-name").addEventListener("input", (e) => {
    const h = $("#signup-handle");
    if (!h.dataset.touched) h.value = normalizeHandle(e.target.value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, ""));
  });
  $("#signup-handle").addEventListener("input", (e) => {
    e.target.dataset.touched = "1";
    e.target.value = normalizeHandle(e.target.value);
  });
  $("#signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#signup-form button[type=submit]");
    btn.disabled = true;
    try {
      const profile = { name: $("#signup-name").value.trim(), handle: normalizeHandle($("#signup-handle").value) };
      const { user, token } = auth.ticket
        ? await api("/users", { method: "POST", body: { signupTicket: auth.ticket, ...profile } })
        : await api("/auth/register", { method: "POST", body: { ...profile, password: $("#signup-password").value } });
      state.token = token;
      localStorage.setItem(TOKEN_KEY, token);
      let finalUser = user;
      if (signupAvatar) {
        try {
          const avatar = await uploadPhoto(signupAvatar);
          finalUser = (await api("/me", { method: "PATCH", body: { avatar } })).user;
        } catch { toast("Conta criada, mas a foto não foi enviada. Tente em Editar perfil."); }
      }
      finishAuth(finalUser, `Conta criada! Bem-vindo, @${finalUser.handle}`);
    } catch (err) {
      toast(err.message);
      if (err.status === 401) setAuthStep("choose");
    }
    btn.disabled = false;
  });

  // ---------------- Login por telefone ----------------
  const auth = { phone: null, ticket: null, resendAt: 0, channel: "sms", channels: { sms: true, whatsapp: false, googleClientId: null } };
  const CHANNEL_TEXT = { sms: "por SMS", whatsapp: "pelo WhatsApp" };

  // Mostra só as formas de login que o servidor tem configuradas.
  api("/auth/channels").then((c) => {
    auth.channels = c;
    $("#phone-submit-wa").classList.toggle("hidden", !c.whatsapp);
    $("#use-phone-btn").classList.toggle("hidden", !c.sms);
    $("#auth-or").classList.toggle("hidden", !(c.sms || c.googleClientId));
    if (c.googleClientId) loadGoogle(c.googleClientId);
  }).catch(() => {});
  let authStep = "choose";

  // Começa em "choose" (Criar conta / Já tenho conta), ou direto num dos dois.
  function startAuth(step = "choose") {
    closeDrawer(); closeSheets();
    show("screen-signup");
    if (step === "register") openRegister();
    else if (step === "login") { setAuthStep("login"); setTimeout(() => $("#login-handle").focus(), 100); }
    else setAuthStep("choose");
  }

  // Cadastro com @ e senha: o mesmo formulário de perfil, com o campo de senha.
  function openRegister() {
    auth.ticket = null;
    signupAvatar = null;
    $("#signup-form").reset();
    delete $("#signup-handle").dataset.touched;
    $("#signup-avatar").innerHTML = '<svg><use href="#i-camera"/></svg>';
    setAuthStep("profile");
    setTimeout(() => $("#signup-name").focus(), 100);
  }

  function setAuthStep(step) {
    authStep = step;
    // Senha só é pedida no cadastro direto (sem ticket do Google/celular).
    const needsPw = step === "profile" && !auth.ticket;
    const pw = $("#signup-password");
    pw.classList.toggle("hidden", !needsPw);
    pw.required = needsPw;
    const ids = { choose: "choose-form", login: "login-form", phone: "phone-form", code: "code-form", profile: "signup-form" };
    $$(".auth-step").forEach((f) => f.classList.toggle("active", f.id === ids[step]));
    if (step === "code") { $("#code-input").value = ""; setTimeout(() => $("#code-input").focus(), 100); }
  }

  // (41) 99999-9999
  function maskPhone(v) {
    const d = v.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 2) return d ? `(${d}` : "";
    if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  function formatPhone(e164) {
    if (e164.startsWith("+55")) return "+55 " + maskPhone(e164.slice(3));
    return e164;
  }

  $("#phone-input").addEventListener("input", (e) => { e.target.value = maskPhone(e.target.value); });

  async function requestCode(channel = auth.channel) {
    const digits = $("#phone-input").value.replace(/\D/g, "");
    if (digits.length !== 11) { toast("Digite o celular com DDD: 11 números."); return false; }
    const btns = $$("#phone-form [data-channel]");
    const labels = btns.map((b) => b.innerHTML);
    btns.forEach((b) => (b.disabled = true));
    const active = btns.find((b) => b.dataset.channel === channel);
    if (active) active.textContent = "Enviando...";
    try {
      const r = await api("/auth/send", { method: "POST", body: { phone: digits, channel } });
      auth.phone = r.phone;
      auth.channel = r.channel || channel;
      $("#code-channel").textContent = CHANNEL_TEXT[auth.channel];
      const other = auth.channel === "sms" ? "whatsapp" : "sms";
      const sw = $("#switch-channel");
      sw.dataset.channel = other;
      sw.textContent = other === "whatsapp" ? "Receber pelo WhatsApp" : "Receber por SMS";
      sw.classList.toggle("hidden", !auth.channels[other]);
      auth.resendAt = Date.now() + (r.resendIn || 60) * 1000;
      $("#code-phone").textContent = formatPhone(r.phone);
      const dev = $("#dev-code");
      dev.classList.toggle("hidden", !r.devCode);
      dev.textContent = r.devCode ? `Modo de teste (nada é enviado): seu código é ${r.devCode}` : "";
      setAuthStep("code");
      return true;
    } catch (err) {
      toast(err.message);
      if (err.status === 429 && authStep === "code") auth.resendAt = Date.now() + 60000;
      return false;
    } finally {
      btns.forEach((b, i) => { b.disabled = false; b.innerHTML = labels[i]; });
    }
  }
  $("#phone-form").addEventListener("submit", (e) => {
    e.preventDefault();
    requestCode(e.submitter && e.submitter.dataset.channel === "whatsapp" ? "whatsapp" : "sms");
  });
  $("#resend-btn").addEventListener("click", async () => {
    if (Date.now() < auth.resendAt) return;
    if (await requestCode()) toast(`Enviamos um novo código ${CHANNEL_TEXT[auth.channel]}.`);
  });
  $("#switch-channel").addEventListener("click", async (e) => {
    const channel = e.currentTarget.dataset.channel;
    if (Date.now() < auth.resendAt) {
      toast(`Espere ${Math.ceil((auth.resendAt - Date.now()) / 1000)}s para pedir o código ${CHANNEL_TEXT[channel]}.`);
      return;
    }
    if (await requestCode(channel)) toast(`Enviamos o código ${CHANNEL_TEXT[channel]}.`);
  });
  setInterval(() => {
    const btn = $("#resend-btn");
    const left = Math.ceil((auth.resendAt - Date.now()) / 1000);
    btn.disabled = left > 0;
    btn.textContent = left > 0 ? `Reenviar em ${left}s` : "Reenviar código";
  }, 500);

  let verifying = false;
  async function verifyCode() {
    const code = $("#code-input").value.replace(/\D/g, "");
    if (code.length !== 6 || verifying) return;
    verifying = true;
    const btn = $("#code-submit");
    btn.disabled = true;
    btn.textContent = "Conferindo...";
    try {
      const r = await api("/auth/verify", { method: "POST", body: { phone: auth.phone, code } });
      if (r.token) {
        state.token = r.token;
        localStorage.setItem(TOKEN_KEY, r.token);
        finishAuth(r.user, `Que bom te ver de novo, @${r.user.handle}!`);
      } else {
        auth.ticket = r.signupTicket;
        setAuthStep("profile");
        setTimeout(() => $("#signup-name").focus(), 100);
      }
    } catch (err) {
      toast(err.message);
      $("#code-input").select();
    } finally {
      verifying = false;
      btn.disabled = false;
      btn.textContent = "Confirmar";
    }
  }
  $("#code-input").addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
    if (e.target.value.length === 6) verifyCode(); // confirma sozinho ao completar
  });
  $("#code-form").addEventListener("submit", (e) => { e.preventDefault(); verifyCode(); });

  // ---------------- Entrar com @ e senha ----------------
  $("#login-handle").addEventListener("input", (e) => { e.target.value = normalizeHandle(e.target.value); });
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#login-submit");
    btn.disabled = true;
    btn.textContent = "Entrando...";
    try {
      const r = await api("/auth/login", {
        method: "POST",
        body: { handle: normalizeHandle($("#login-handle").value), password: $("#login-password").value },
      });
      state.token = r.token;
      localStorage.setItem(TOKEN_KEY, r.token);
      $("#login-password").value = "";
      finishAuth(r.user, `Que bom te ver de novo, @${r.user.handle}!`);
    } catch (err) {
      toast(err.message);
      $("#login-password").select();
    } finally {
      btn.disabled = false;
      btn.textContent = "Entrar";
    }
  });

  function openPasswordSheet() {
    if (!state.user) return;
    const has = !!state.user.hasPassword;
    $("#password-title").textContent = has ? "Trocar senha" : "Criar senha";
    $("#pw-current").classList.toggle("hidden", !has);
    $("#pw-current").required = has;
    $("#password-form").reset();
    openSheet("sheet-password");
  }
  $("#password-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/me/password", { method: "POST", body: { current: $("#pw-current").value, password: $("#pw-new").value } });
      state.user.hasPassword = true;
      closeSheets();
      renderMember();
      toast("Senha salva. Agora você também entra com @ e senha.");
    } catch (err) { toast(err.message); }
  });

  // ---------------- Entrar com Google ----------------
  // Usa o botão oficial do Google (Google Identity Services). O Google devolve um
  // "ID token" assinado, que o servidor confere em /api/auth/google.
  let googleLoaded = false;
  function loadGoogle(clientId) {
    if (googleLoaded) return;
    googleLoaded = true;
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => {
      window.google.accounts.id.initialize({ client_id: clientId, callback: onGoogleCredential, ux_mode: "popup", context: "signin" });
      window.google.accounts.id.renderButton($("#google-btn"), {
        theme: "outline", size: "large", shape: "pill", text: "continue_with", locale: "pt-BR",
        width: Math.min(320, $("#choose-form").clientWidth || 320),
      });
    };
    s.onerror = () => { googleLoaded = false; toast("Não foi possível carregar o login do Google. Verifique sua internet."); };
    document.head.appendChild(s);
  }

  async function onGoogleCredential(resp) {
    try {
      const r = await api("/auth/google", { method: "POST", body: { credential: resp.credential } });
      if (r.token) {
        state.token = r.token;
        localStorage.setItem(TOKEN_KEY, r.token);
        finishAuth(r.user, `Que bom te ver de novo, @${r.user.handle}!`);
        return;
      }
      // Conta nova: nome e foto vêm do Google; a pessoa só confirma o @.
      auth.ticket = r.signupTicket;
      const sug = r.suggested || {};
      signupAvatar = null;
      $("#signup-name").value = sug.name || "";
      const h = $("#signup-handle");
      h.value = sug.handle || "";
      if (sug.handle) h.dataset.touched = "1";
      setAvatar($("#signup-avatar"), { name: sug.name || "?", avatar: sug.avatar });
      if (!$("#screen-signup").classList.contains("active")) show("screen-signup");
      setAuthStep("profile");
      setTimeout(() => (sug.handle ? h : $("#signup-name")).focus(), 100);
    } catch (err) {
      toast(err.message);
    }
  }

  function finishAuth(user, message) {
    auth.ticket = null;
    setSession(user);
    state.history = [];
    show("screen-map");
    toast(message);
    const next = pendingAfterSignup;
    pendingAfterSignup = null;
    if (next === "checkin") setTimeout(openCheckin, 300);
    else if (next === "live") setTimeout(openLiveSettings, 300);
    else if (next === "member") show("screen-member");
  }

  async function signOut(path) {
    stopLive(true);
    try { await api(path, { method: "DELETE" }); } catch { /* sai localmente mesmo assim */ }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LIVE_KEY);
    location.href = location.pathname;
  }

  // Editar perfil
  $("#profile-photo").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      profileDraftAvatar = await resizeImage(f, 400);
      setAvatar($("#profile-avatar"), { name: state.user.name, avatar: URL.createObjectURL(profileDraftAvatar) });
    } catch (err) { toast(err.message); }
  });
  $("#profile-handle").addEventListener("input", (e) => { e.target.value = normalizeHandle(e.target.value); });
  $("#profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const patch = { name: $("#profile-name").value.trim(), handle: normalizeHandle($("#profile-handle").value) };
      if (profileDraftAvatar) patch.avatar = await uploadPhoto(profileDraftAvatar);
      state.user = (await api("/me", { method: "PATCH", body: patch })).user;
      closeSheets();
      renderMember();
      connectLive(); // reconecta para o mapa ao vivo usar a nova foto/nome
      loadPosts();
      toast("Perfil atualizado.");
    } catch (err) { toast(err.message); }
  });

  // Relógio: contagem do post e do compartilhamento ao vivo
  setInterval(() => { updateCountdown(); updateLiveTimer(); }, 1000);
  // Novos rolês aparecem sozinhos
  setInterval(() => { if (!document.hidden) loadPosts(); }, 30000);
  setInterval(() => { if (!document.hidden) loadNotifications(); }, 60000);

  // ---------------- Início ----------------
  async function boot() {
    if (window.RoleDemo) $("#demo-note").classList.remove("hidden");
    syncLiveUI();
    if (state.token) {
      try {
        state.user = (await api("/me")).user;
      } catch (e) {
        if (e.status === 401) { localStorage.removeItem(TOKEN_KEY); state.token = null; }
      }
    }
    if (!state.user && state.live.active) { state.live = { active: false, until: 0 }; persistLive(); syncLiveUI(); }
    connectLive();
    await loadPosts();
    loadNotifications();
    if (state.user && state.live.active) startLive(true);

    const deepLink = new URLSearchParams(location.search).get("role");
    if (state.user || deepLink) {
      show("screen-map");
      state.history = ["screen-welcome"];
      if (deepLink) {
        let p = findPost(deepLink);
        if (!p) { try { p = (await api(`/posts/${deepLink}`)).post; upsertPost(p); } catch { /* não existe */ } }
        if (p && isActive(p)) {
          state.tab = p.type === "event" ? "events" : "roles";
          syncTabs(); renderMarkers();
          setTimeout(() => openPost(p.id), 300);
        } else toast("Esse rolê já encerrou.");
      }
    }
  }
  boot();
})();
