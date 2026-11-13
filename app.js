(() => {
  "use strict";

  const DATA = window.ROLE_DATA;
  const STORE_KEY = "role:v1";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const enc = encodeURIComponent;
  const MIN = 60 * 1000;

  // ---------------- Estado ----------------
  const saved = load();
  const state = {
    user: saved.user || null,
    myPosts: saved.myPosts || [],
    likes: saved.likes || {},
    myComments: saved.myComments || {},
    liveSettings: saved.liveSettings || { visibility: "friends", duration: 60 },
    live: saved.live || { active: false, until: 0, startedAt: 0 },
    notifications: saved.notifications || DATA.notifications.map((n) => ({ ...n, read: false })),
    tab: "roles",
    search: "",
    selected: null,
    myPos: null,
    history: [],
  };

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
  }
  function persist() {
    const { user, myPosts, likes, myComments, liveSettings, live, notifications } = state;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ user, myPosts, likes, myComments, liveSettings, live, notifications }));
    } catch {
      toast("Armazenamento cheio: não foi possível salvar.");
    }
  }

  const allPosts = () => [...state.myPosts, ...DATA.posts];
  const findPost = (id) => allPosts().find((p) => p.id === id);
  const expiresAt = (p) => p.postedAt + p.durationMin * MIN;
  const isActive = (p) => expiresAt(p) > Date.now();

  // ---------------- Helpers ----------------
  function initials(name = "?") {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  }
  function esc(s = "") {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  // Avatar com fallback para iniciais se a imagem falhar
  function faceHTML(person) {
    const img = person && person.avatar
      ? `<img src="${esc(person.avatar)}" alt="" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit">`
      : "";
    return `<span style="position:relative;display:grid;place-items:center;width:100%;height:100%;border-radius:inherit">${esc(initials(person && person.name))}${img}</span>`;
  }
  function setAvatar(el, person) { el.innerHTML = faceHTML(person); }

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
  function fmtDist(km) { return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`; }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
  }

  function resizeImage(file, max = 900) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL("image/jpeg", 0.8));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
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

  async function reverseGeocode([lat, lng]) {
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
    toast("Crie sua conta para continuar — leva 5 segundos.");
    show("screen-signup");
    return false;
  }

  // ---------------- Mapa ----------------
  let map, markersLayer, liveLayer, myLiveMarker;
  const markerById = {};

  function initMap() {
    if (map) return;
    map = L.map("map", { zoomControl: false, attributionControl: true }).setView(DATA.center, 17);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
    liveLayer = L.layerGroup().addTo(map);
    renderMarkers();
    renderFriendsLive();
    setInterval(moveFriends, 4000);
    if (state.live.active) startLive(true);
  }

  function visiblePosts() {
    const q = state.search.trim().toLowerCase();
    return allPosts().filter((p) => {
      if (!isActive(p)) return false;
      if ((state.tab === "events") !== (p.type === "event")) return false;
      if (!q) return true;
      return [p.title, p.place, p.description, p.author.name, "@" + p.author.handle].join(" ").toLowerCase().includes(q);
    });
  }

  function renderMarkers() {
    if (!map) return;
    markersLayer.clearLayers();
    Object.keys(markerById).forEach((k) => delete markerById[k]);
    visiblePosts().forEach((p) => {
      const isEvent = p.type === "event";
      const img = isEvent ? p.photo : p.author.avatar;
      const html = `<div class="pin ${isEvent ? "event" : ""} ${state.selected === p.id ? "selected" : ""}">
          <div class="pin-img">${faceHTML({ name: p.author.name, avatar: img })}</div>
        </div>`;
      const icon = L.divIcon({ className: "pin-wrap", html, iconSize: [64, 80], iconAnchor: [32, 80] });
      const m = L.marker([p.lat, p.lng], { icon, title: p.title, riseOnHover: true }).addTo(markersLayer);
      m.on("click", () => openPost(p.id));
      markerById[p.id] = m;
    });
  }

  function liveIcon(person, me = false) {
    return L.divIcon({
      className: "pin-wrap",
      html: `<div class="live-pin ${me ? "me" : ""}"><div class="ring"></div><div class="face">${faceHTML(person)}</div><div class="tag">${me ? "VOCÊ" : "AO VIVO"}</div></div>`,
      iconSize: [46, 46], iconAnchor: [23, 23],
    });
  }

  function renderFriendsLive() {
    liveLayer.clearLayers();
    DATA.liveFriends.forEach((f) => {
      f.marker = L.marker([f.lat, f.lng], { icon: liveIcon(f.person), title: `${f.person.name} (ao vivo)` })
        .bindPopup(`<b>${esc(f.person.name)}</b><br>@${esc(f.person.handle)} · compartilhando ao vivo`)
        .addTo(liveLayer);
    });
  }
  function moveFriends() {
    DATA.liveFriends.forEach((f) => {
      f.lat += (Math.random() - 0.5) * 0.00012;
      f.lng += (Math.random() - 0.5) * 0.00012;
      f.marker && f.marker.setLatLng([f.lat, f.lng]);
    });
  }

  // ---------------- Post ----------------
  function likeCount(p) { return (p.likes || 0) + (state.likes[p.id] ? 1 : 0); }
  function commentsOf(p) { return [...(p.comments || []), ...(state.myComments[p.id] || [])]; }

  function openPost(id) {
    const p = findPost(id);
    if (!p) return;
    state.selected = id;
    renderMarkers();

    $("#post-photo").style.backgroundImage = `url("${p.photo}")`;
    const av = $("#post-avatar");
    av.src = p.author.avatar || "";
    av.onerror = () => { av.removeAttribute("src"); };
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
    const liked = !!state.likes[p.id];
    $("#btn-like").classList.toggle("liked", liked);
    $("#btn-like").setAttribute("aria-pressed", liked);
    $("#like-count").textContent = likeCount(p) || "";
    $("#comment-count").textContent = commentsOf(p).length || "";
  }

  function updateCountdown() {
    if (!state.selected) return;
    const p = findPost(state.selected);
    if (!p) return;
    const left = expiresAt(p) - Date.now();
    $("#post-countdown").textContent = fmtRemaining(left);
    $("#post-countdown").title = `Status visível por mais ${fmtRemaining(left)} (horas:minutos)`;
  }

  function toggleLike() {
    const p = findPost(state.selected);
    if (!p || !requireAccount()) return;
    state.likes[p.id] = !state.likes[p.id];
    if (!state.likes[p.id]) delete state.likes[p.id];
    persist();
    updatePostCounts(p);
  }

  function openComments() {
    const p = findPost(state.selected);
    if (!p) return;
    renderComments(p);
    openSheet("sheet-comments");
  }
  function renderComments(p) {
    const list = commentsOf(p).sort((a, b) => a.at - b.at);
    $("#comment-list").innerHTML = list.length
      ? list.map((c) => `<li><span class="avatar">${faceHTML(c.author)}</span>
          <div><p><b>@${esc(c.author.handle)}</b> ${esc(c.text)}</p><small>${timeAgo(c.at)}</small></div></li>`).join("")
      : `<li class="muted">Nenhum comentário ainda. Seja o primeiro!</li>`;
    const ul = $("#comment-list");
    ul.scrollTop = ul.scrollHeight;
  }
  function submitComment(e) {
    e.preventDefault();
    const p = findPost(state.selected);
    if (!p || !requireAccount()) return;
    const text = $("#comment-input").value.trim();
    if (!text) return;
    (state.myComments[p.id] ||= []).push({ author: publicUser(), text, at: Date.now() });
    persist();
    $("#comment-input").value = "";
    renderComments(p);
    updatePostCounts(p);
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
    $("#ride-99").dataset.lat = p.lat;
    $("#ride-99").dataset.lng = p.lng;
    $("#ride-99").dataset.title = p.title;
    $("#ride-maps").href = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
    openSheet("sheet-ride");
  }
  function open99(e) {
    e.preventDefault();
    const { lat, lng, title } = e.currentTarget.dataset;
    const ua = navigator.userAgent;
    const store = /android/i.test(ua)
      ? "https://play.google.com/store/apps/details?id=com.taxis99"
      : /iphone|ipad|ipod/i.test(ua)
        ? "https://apps.apple.com/br/app/99/id553663691"
        : "https://99app.com/";
    // Tenta abrir o app da 99 com o destino; se não abrir, vai para a loja/site.
    const fallback = setTimeout(() => { if (!document.hidden) window.open(store, "_blank"); }, 1500);
    document.addEventListener("visibilitychange", () => clearTimeout(fallback), { once: true });
    window.location.href = `taxis99://call?end_lat=${lat}&end_lng=${lng}&end_title=${enc(title)}`;
  }

  // ---------------- Lista ----------------
  function openList() {
    const origin = state.myPos || (map ? [map.getCenter().lat, map.getCenter().lng] : DATA.center);
    const items = visiblePosts()
      .map((p) => ({ p, d: distanceKm(origin, [p.lat, p.lng]) }))
      .sort((a, b) => a.d - b.d);
    $("#list-title").textContent = state.tab === "events" ? "Eventos perto de você" : "Rolês perto de você";
    $("#list-items").innerHTML = items.length
      ? items.map(({ p, d }) => `<li data-post="${p.id}">
          <span class="thumb" style="background-image:url('${esc(p.photo)}')"></span>
          <span class="meta"><b>${esc(p.title)}</b><span>@${esc(p.author.handle)} · ★ ${p.rating} · ${p.free ? "Grátis" : "Pago"}</span></span>
          <span class="side">${fmtDist(d)}<br><span class="muted">${fmtClock(p.postedAt)}</span></span>
        </li>`).join("")
      : `<li class="empty">Nada por aqui ainda. Que tal fazer um check-in?</li>`;
    openSheet("sheet-list");
  }

  // ---------------- Check-in ----------------
  let checkin = { photo: null, pos: null, place: null, rating: 0, free: true, duration: 180 };
  let checkinRequest = 0;

  function openCheckin() {
    if (!requireAccount("checkin")) return;
    checkin = { photo: null, pos: null, place: null, rating: 0, free: true, duration: 180 };
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
      checkin.pos = pos;
      state.myPos = pos;
      label.textContent = "Localização encontrada, buscando endereço...";
      const place = await reverseGeocode(pos);
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
    const ok = checkin.photo && checkin.pos && checkin.place && checkin.rating > 0 && $("#checkin-title").value.trim();
    $("#checkin-submit").disabled = !ok;
  }
  function submitCheckin(e) {
    e.preventDefault();
    if ($("#checkin-submit").disabled) return;
    const post = {
      id: "me-" + Date.now(),
      type: "role",
      author: publicUser(),
      title: $("#checkin-title").value.trim(),
      description: $("#checkin-desc").value.trim(),
      photo: checkin.photo,
      lat: checkin.pos[0], lng: checkin.pos[1],
      place: checkin.place,
      rating: checkin.rating,
      free: checkin.free,
      postedAt: Date.now(),
      durationMin: checkin.duration,
      likes: 0, comments: [],
      mine: true,
    };
    state.myPosts.unshift(post);
    persist();
    closeSheets();
    state.tab = "roles";
    syncTabs();
    renderMarkers();
    toast("Check-in postado! 🎉");
    openPost(post.id);
  }

  function setChips(sel, value) {
    $$(sel + " .chip-opt").forEach((b) => b.classList.toggle("active", b.dataset.value === String(value)));
  }

  // ---------------- Localização em tempo real ----------------
  let liveWatch = null;

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
      const now = Date.now();
      const dur = Number(state.liveSettings.duration);
      state.live = { active: true, startedAt: now, until: dur ? now + dur * MIN : 0 };
      persist();
    }
    if (liveWatch !== null) navigator.geolocation.clearWatch(liveWatch);
    let first = true;
    liveWatch = navigator.geolocation.watchPosition(
      (p) => {
        const pos = [p.coords.latitude, p.coords.longitude];
        state.myPos = pos;
        if (!map) return;
        if (!myLiveMarker) myLiveMarker = L.marker(pos, { icon: liveIcon(publicUser(), true), zIndexOffset: 1000 }).addTo(map);
        else myLiveMarker.setLatLng(pos);
        if (first && !resume) { map.setView(pos, 17); first = false; }
      },
      (err) => {
        toast(err.code === 1 ? "Permita o acesso à localização para compartilhar." : "Não foi possível obter sua localização.");
        stopLive(true);
      },
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    syncLiveUI();
    if (!resume) {
      closeSheets();
      const who = state.liveSettings.visibility === "all" ? "todos" : "seus amigos";
      toast(`Compartilhando sua localização com ${who}.`);
    }
  }

  function stopLive(silent = false) {
    if (liveWatch !== null) navigator.geolocation.clearWatch(liveWatch);
    liveWatch = null;
    if (myLiveMarker) { myLiveMarker.remove(); myLiveMarker = null; }
    state.live = { active: false, until: 0, startedAt: 0 };
    persist();
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
  function publicUser() {
    return state.user ? { name: state.user.name, handle: state.user.handle, avatar: state.user.avatar } : null;
  }

  function renderDrawer() {
    const u = state.user;
    setAvatar($("#drawer-avatar"), u || { name: "?" });
    $("#drawer-name").textContent = u ? u.name : "Visitante";
    $("#drawer-handle").textContent = u ? "@" + u.handle : "Crie sua conta para postar";
    $("#drawer-auth").classList.toggle("hidden", !!u);
  }

  function renderMember() {
    const u = state.user;
    if (!u) return;
    setAvatar($("#member-avatar"), u);
    $("#member-name").textContent = u.name;
    $("#member-handle").textContent = "@" + u.handle;
    $("#stat-checkins").textContent = state.myPosts.length;
    $("#stat-likes").textContent = state.myPosts.reduce((s, p) => s + likeCount(p), 0);
    $("#stat-comments").textContent = Object.values(state.myComments).reduce((s, l) => s + l.length, 0);

    $("#my-posts").innerHTML = state.myPosts.length
      ? state.myPosts.map((p) => `<li data-post="${p.id}">
          <span class="thumb" style="background-image:url('${esc(p.photo)}')"></span>
          <span class="meta"><b>${esc(p.title)}</b><span>${esc(p.place)} · ${isActive(p) ? "ativo · " + fmtRemaining(expiresAt(p) - Date.now()) : "encerrado"}</span></span>
          <button class="del" data-delete="${p.id}">Apagar</button>
        </li>`).join("")
      : `<li class="empty">Você ainda não fez check-in.</li>`;

    const liked = allPosts().filter((p) => state.likes[p.id]);
    $("#my-likes").innerHTML = liked.length
      ? liked.map((p) => `<li data-post="${p.id}">
          <span class="thumb" style="background-image:url('${esc(p.photo)}')"></span>
          <span class="meta"><b>${esc(p.title)}</b><span>@${esc(p.author.handle)} · ★ ${p.rating}</span></span>
        </li>`).join("")
      : `<li class="empty">Nenhuma curtida ainda.</li>`;
    syncLiveUI();
  }

  function openProfileEdit() {
    const u = state.user;
    if (!u) return;
    profileDraftAvatar = u.avatar;
    setAvatar($("#profile-avatar"), u);
    $("#profile-name").value = u.name;
    $("#profile-handle").value = u.handle;
    openSheet("sheet-profile");
  }
  let profileDraftAvatar = null;
  let signupAvatar = null;

  function normalizeHandle(v) { return v.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_.]/g, ""); }

  function renderNotifications() {
    $("#notif-list").innerHTML = state.notifications.length
      ? state.notifications.map((n) => `<li><span class="meta"><b style="white-space:normal">${esc(n.text)}</b><span>${timeAgo(n.at)}</span></span></li>`).join("")
      : `<li class="empty">Sem notificações.</li>`;
    state.notifications.forEach((n) => (n.read = true));
    persist();
    syncNotifDot();
  }
  function syncNotifDot() {
    $("#notif-dot").classList.toggle("hidden", !state.notifications.some((n) => !n.read));
  }

  function syncTabs() {
    $$(".seg").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  }

  // ---------------- Eventos ----------------
  const actions = {
    discover: () => show("screen-map"),
    signup: () => { closeDrawer(); show("screen-signup"); },
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
    notifications: () => { renderNotifications(); openSheet("sheet-notifications"); },
    list: openList,
    checkin: openCheckin,
    locate: async () => {
      try {
        const pos = await getPosition();
        state.myPos = pos;
        map.setView(pos, 17);
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
    like: toggleLike,
    comments: openComments,
    share: sharePost,
    go: openRide,
    "live-settings": openLiveSettings,
    "live-start": () => startLive(false),
    "live-stop": () => { stopLive(); closeSheets(); },
    "live-link": shareLiveLink,
    "edit-profile": openProfileEdit,
    logout: () => {
      if (!confirm("Sair da conta? Seus check-ins neste aparelho serão apagados.")) return;
      stopLive(true);
      localStorage.removeItem(STORE_KEY);
      location.reload();
    },
  };

  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-action]");
    if (a && actions[a.dataset.action]) { e.preventDefault(); actions[a.dataset.action](); return; }

    const del = e.target.closest("[data-delete]");
    if (del) {
      e.stopPropagation();
      if (!confirm("Apagar este check-in?")) return;
      state.myPosts = state.myPosts.filter((p) => p.id !== del.dataset.delete);
      persist(); renderMember(); renderMarkers();
      return;
    }

    const item = e.target.closest("[data-post]");
    if (item) {
      const p = findPost(item.dataset.post);
      if (!p) return;
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

  $$(".seg").forEach((b) => b.addEventListener("click", () => {
    state.tab = b.dataset.tab;
    syncTabs();
    closePost();
  }));
  $("#search-input").addEventListener("input", (e) => { state.search = e.target.value; renderMarkers(); });

  $("#ride-99").addEventListener("click", open99);
  $("#comment-form").addEventListener("submit", submitComment);

  // Check-in
  $("#checkin-photo").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      checkin.photo = await resizeImage(f);
      const prev = $("#checkin-preview");
      prev.style.backgroundImage = `url("${checkin.photo}")`;
      prev.classList.add("has-img");
    } catch { toast("Não foi possível ler a foto."); }
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
    state.liveSettings.visibility = b.dataset.value; setChips("#live-visibility", b.dataset.value); persist();
  });
  $("#live-duration").addEventListener("click", (e) => {
    const b = e.target.closest(".chip-opt"); if (!b) return;
    state.liveSettings.duration = Number(b.dataset.value); setChips("#live-duration", b.dataset.value); persist();
  });
  $("#member-live-toggle").addEventListener("change", (e) => {
    if (e.target.checked) { initMap(); startLive(false); } else stopLive();
  });

  // Cadastro
  $("#signup-photo").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      signupAvatar = await resizeImage(f, 300);
      setAvatar($("#signup-avatar"), { name: $("#signup-name").value || "?", avatar: signupAvatar });
    } catch { toast("Não foi possível ler a foto."); }
  });
  $("#signup-name").addEventListener("input", (e) => {
    const h = $("#signup-handle");
    if (!h.dataset.touched) h.value = normalizeHandle(e.target.value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, ""));
  });
  $("#signup-handle").addEventListener("input", (e) => {
    e.target.dataset.touched = "1";
    e.target.value = normalizeHandle(e.target.value);
  });
  $("#signup-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#signup-name").value.trim();
    const handle = normalizeHandle($("#signup-handle").value);
    if (!name || !handle) return;
    state.user = { name, handle, avatar: signupAvatar, createdAt: Date.now() };
    state.notifications.unshift({ text: `Bem-vindo ao Rolê, ${name.split(" ")[0]}! Faça seu primeiro check-in.`, at: Date.now(), read: false });
    persist();
    syncNotifDot();
    state.history = [];
    show("screen-map");
    toast(`Conta criada! Bem-vindo, @${handle}`);
    const next = pendingAfterSignup;
    pendingAfterSignup = null;
    if (next === "checkin") setTimeout(openCheckin, 300);
    else if (next === "live") setTimeout(openLiveSettings, 300);
    else if (next === "member") show("screen-member");
  });

  // Editar perfil
  $("#profile-photo").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      profileDraftAvatar = await resizeImage(f, 300);
      setAvatar($("#profile-avatar"), { name: state.user.name, avatar: profileDraftAvatar });
    } catch { toast("Não foi possível ler a foto."); }
  });
  $("#profile-handle").addEventListener("input", (e) => { e.target.value = normalizeHandle(e.target.value); });
  $("#profile-form").addEventListener("submit", (e) => {
    e.preventDefault();
    state.user.name = $("#profile-name").value.trim() || state.user.name;
    state.user.handle = normalizeHandle($("#profile-handle").value) || state.user.handle;
    state.user.avatar = profileDraftAvatar;
    // Atualiza autoria dos próprios posts e comentários
    state.myPosts.forEach((p) => (p.author = publicUser()));
    Object.values(state.myComments).forEach((l) => l.forEach((c) => (c.author = publicUser())));
    persist();
    if (myLiveMarker) myLiveMarker.setIcon(liveIcon(publicUser(), true));
    closeSheets();
    renderMember();
    renderMarkers();
    toast("Perfil atualizado.");
  });

  // Relógio: contagem do post e do compartilhamento ao vivo
  setInterval(() => { updateCountdown(); updateLiveTimer(); }, 1000);

  // ---------------- Início ----------------
  syncNotifDot();
  syncLiveUI();
  const params = new URLSearchParams(location.search);
  const deepLink = params.get("role");
  if (state.user || deepLink) {
    show("screen-map");
    state.history = ["screen-welcome"];
    if (deepLink && findPost(deepLink)) {
      const p = findPost(deepLink);
      state.tab = p.type === "event" ? "events" : "roles";
      syncTabs(); renderMarkers();
      setTimeout(() => openPost(deepLink), 300);
    }
  }
})();
