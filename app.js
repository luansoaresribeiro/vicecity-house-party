(() => {
  const P = window.PARTY;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const PREVIEW = !P.api;
  const salesClosed = () => Date.now() > Date.parse(P.salesClose);

  // ---------- API ----------
  async function api(action, body, query = "") {
    const res = await fetch(`${P.api}?action=${action}${query}`, body
      ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
    return data;
  }

  // ---------- helpers ----------
  const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const cleanHandle = (h) => h.trim().replace(/^@+/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?].*$/, "").toLowerCase();

  function bubbleEl(g, me) {
    const a = document.createElement("a");
    a.className = "bubble" + (me ? " me" : "");
    a.href = `https://instagram.com/${encodeURIComponent(g.instagram)}`;
    a.target = "_blank"; a.rel = "noopener";
    a.setAttribute("role", "listitem");
    a.title = g.name;
    const face = document.createElement("span");
    face.className = "face";
    if (g.photo) { const img = document.createElement("img"); img.src = g.photo; img.alt = ""; img.loading = "lazy"; face.append(img); }
    else face.textContent = initials(g.name || g.instagram);
    const h = document.createElement("span");
    h.className = "handle"; h.textContent = "@" + g.instagram;
    a.append(face, h);
    return a;
  }

  // ---------- floating wall ----------
  const wall = $("wall");
  const floaters = new Map(); // id -> {el,x,y,vx,vy,s,phase}
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function sizeFor(n) {
    const area = wall.clientWidth * wall.clientHeight;
    const s = Math.sqrt(area / Math.max(n, 1) / 3.2);
    return Math.max(46, Math.min(92, s));
  }

  function renderWall(guests) {
    $("wallEmpty").hidden = guests.length > 0;
    const ids = new Set(guests.map((g) => g.id));
    for (const [id, f] of floaters) if (!ids.has(id)) { f.el.remove(); floaters.delete(id); }
    const s = sizeFor(guests.length);
    const W = wall.clientWidth, H = wall.clientHeight;
    for (const g of guests) {
      let f = floaters.get(g.id);
      if (!f) {
        const el = bubbleEl(g, false);
        wall.append(el);
        const ang = Math.random() * Math.PI * 2, sp = 0.15 + Math.random() * 0.25;
        f = { el, x: Math.random() * (W - s), y: Math.random() * (H - s - 26), vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, phase: Math.random() * 6 };
        floaters.set(g.id, f);
      }
      f.s = s; f.el.style.setProperty("--s", s + "px");
    }
  }

  function tick(t) {
    const W = wall.clientWidth, H = wall.clientHeight;
    const list = [...floaters.values()];
    // soft push-apart so bubbles don't pile on top of each other
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const p = list[i], q = list[j];
      const dx = q.x - p.x, dy = q.y - p.y, dist = Math.hypot(dx, dy) || 1, min = p.s * 1.25;
      if (dist < min) {
        const push = (min - dist) / dist * 0.04;
        p.vx -= dx * push; p.vy -= dy * push; q.vx += dx * push; q.vy += dy * push;
      }
    }
    for (const f of list) {
      const sp = Math.hypot(f.vx, f.vy), max = 0.6, minSp = 0.12;
      if (sp > max) { f.vx *= max / sp; f.vy *= max / sp; }
      else if (sp < minSp) { f.vx *= minSp / (sp || 1); f.vy *= minSp / (sp || 1); }
      const h = f.s + 26;
      f.x += f.vx; f.y += f.vy;
      if (f.x < 0 || f.x > W - f.s) { f.vx *= -1; f.x = Math.max(0, Math.min(W - f.s, f.x)); }
      if (f.y < 0 || f.y > H - h) { f.vy *= -1; f.y = Math.max(0, Math.min(H - h, f.y)); }
      const bob = Math.sin(t / 900 + f.phase) * 4;
      f.el.style.transform = `translate(${f.x}px,${f.y + bob}px)`;
    }
    if (!reduced) requestAnimationFrame(tick);
  }

  // ---------- counter ----------
  function renderCounts(going, held) {
    $("goingCount").textContent = going;
    const left = Math.max(0, P.capacity - going - (held || 0));
    $("spotsLeft").textContent = left;
    const closed = salesClosed(), soldOut = left <= 0;
    if (closed || soldOut) {
      const box = $("closedMsg");
      box.replaceChildren(soldOut ? "Sold out online 🔥" : "Online sales are closed.", document.createElement("br"), "Text or call ");
      const tel = document.createElement("a"); tel.className = "phone"; tel.href = "sms:+1" + P.phone.replace(/\D/g, ""); tel.textContent = P.phone;
      box.append(tel, " to request a ticket · At the door: $70");
      box.hidden = false;
      $("payBtn").disabled = true; $("heroCta").textContent = soldOut ? "Sold out" : "Sales closed";
    }
  }

  // ---------- data ----------
  async function loadWall() {
    if (PREVIEW) {
      const sample = ["jordan.m", "sofia.rr", "mike_305", "isa.vibes", "dani.fiu", "chris.stu", "val.mia", "leo.dade", "nat.sun", "gabi.linen", "tony.v", "mari.305"];
      const guests = params.has("preview") ? sample.map((h, i) => ({ id: h, instagram: h, name: h.replace(/[._\d]/g, " ") })) : [];
      renderWall(guests); renderCounts(guests.length, 0); return;
    }
    try {
      const d = await api("wall");
      renderWall(d.guests); renderCounts(d.going, d.held);
    } catch { /* keep last state */ }
  }

  // ---------- photo (resized in the browser to keep uploads small) ----------
  let photoData = null;
  $("photo").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const bmp = await createImageBitmap(file);
      const side = Math.min(bmp.width, bmp.height), size = Math.min(480, side);
      const c = document.createElement("canvas"); c.width = c.height = size;
      c.getContext("2d").drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
      photoData = c.toDataURL("image/jpeg", 0.85);
      $("photoPreview").src = photoData; $("photoPreview").hidden = false; $("photoHint").hidden = true;
    } catch { showError("Couldn't read that photo. Try another one."); }
  });

  // ---------- form ----------
  function showError(msg) { const e = $("formError"); e.textContent = msg; e.hidden = !msg; }
  $("rsvp").addEventListener("submit", async (e) => {
    e.preventDefault(); showError("");
    const f = e.target;
    const name = f.name.value.trim(), instagram = cleanHandle(f.instagram.value), school = f.school.value;
    const ticket = (f.querySelector("input[name=ticket]:checked") || {}).value;
    if (name.length < 2) return showError("Add your name.");
    if (!/^[a-z0-9._]{1,30}$/.test(instagram)) return showError("That Instagram handle doesn't look right.");
    if (!school) return showError("Pick your school.");
    if (!ticket) return showError("Choose Ladies or Guys.");
    if (!$("terms").checked) return showError("Please confirm you understand there are no refunds.");
    if (PREVIEW) return showError("Preview mode — payments turn on once the site is connected.");
    $("payBtn").disabled = true; $("payBtn").textContent = "Opening checkout…";
    try {
      const d = await api("checkout", { name, instagram, school, ticket, showPhoto: $("showPhoto").checked, photo: photoData });
      location.href = d.url;
    } catch (err) {
      showError(err.message); $("payBtn").disabled = false; $("payBtn").textContent = "Pay & lock my spot";
    }
  });
  $("instagram").addEventListener("blur", (e) => { e.target.value = cleanHandle(e.target.value); });
  const labelFor = () => { const t = document.querySelector("input[name=ticket]:checked"); $("payBtn").textContent = t ? `Pay $${P.prices[t.value]} & lock my spot` : "Pay & lock my spot"; };
  document.querySelectorAll("input[name=ticket]").forEach((r) => r.addEventListener("change", labelFor));

  // ---------- my ticket (after Stripe sends people back with ?t=token) ----------
  async function loadTicket(token) {
    const box = $("myTicket");
    box.hidden = false; box.textContent = "Checking your ticket…";
    box.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      const d = await api("ticket", null, "&t=" + encodeURIComponent(token));
      const mine = floaters.get(d.id); if (mine) mine.el.classList.add("me");
      box.replaceChildren();
      const h = document.createElement("h2");
      const p = document.createElement("p");
      if (d.status === "paid") {
        h.textContent = "You're in!";
        p.textContent = `${d.name} · ${d.ticket === "ladies" ? "Ladies" : "Guys"} ticket · Friday, Nov 20 · 8PM–4AM`;
        const me = bubbleEl(d, true); me.style.position = "static";
        const addr = document.createElement("p"); addr.className = "addr";
        addr.textContent = d.address ? `📍 ${d.address}` : "📍 Address drops soon — come back to this page (bookmark it!)";
        const note = document.createElement("p"); note.className = "fine";
        note.textContent = "Show this page at the door. Your Stripe receipt was sent to your email.";
        box.append(h, me, p, addr, note);
      } else {
        h.textContent = "Almost there";
        p.textContent = "We haven't received your payment yet. If you just paid, give it a minute and refresh.";
        box.append(h, p);
      }
    } catch (err) { box.textContent = err.message; }
  }

  // ---------- music (official YouTube player, starts on tap — browsers block sound on page load) ----------
  if (P.music && P.music.youtubeId) {
    $("music").hidden = false;
    const id = encodeURIComponent(P.music.youtubeId);
    let on = false;
    const set = (v) => {
      on = v; $("musicBtn").setAttribute("aria-pressed", v);
      $("musicLabel").textContent = v ? "♫ " + P.music.title.split(" — ")[0] : "Play the vibe";
      $("musicPlayer").hidden = !v;
      if (v) {
        const f = document.createElement("iframe");
        f.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&loop=1&playlist=${id}`;
        f.allow = "autoplay; encrypted-media"; f.title = P.music.title;
        $("musicFrame").replaceChildren(f);
      } else $("musicFrame").replaceChildren();
    };
    $("musicBtn").addEventListener("click", () => set(!on));
    $("musicClose").addEventListener("click", () => set(false));
  }

  // ---------- boot ----------
  loadWall();
  if (!reduced) requestAnimationFrame(tick); else tick(0);
  if (!PREVIEW) setInterval(loadWall, 20000);
  addEventListener("resize", () => { const s = sizeFor(floaters.size); floaters.forEach((f) => { f.s = s; f.el.style.setProperty("--s", s + "px"); }); if (reduced) tick(0); });
  const t = params.get("t");
  if (t && !PREVIEW) loadTicket(t);
})();
