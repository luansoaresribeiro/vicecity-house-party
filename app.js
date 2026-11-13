(() => {
  const P = window.PARTY;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const PREVIEW = !P.api;
  let paymentsOpen = false; // organizer flips this in /admin; until then the form is a "Join the list"
  const submitLabel = () => (paymentsOpen ? "Apply" : "Join the list");
  function applyMode(open) {
    paymentsOpen = !!open;
    if (!$("payBtn").disabled) $("payBtn").textContent = submitLabel();
    if (!salesClosed()) $("heroCta").textContent = paymentsOpen ? "Get your ticket" : "Join the list";
    $("listNote").hidden = paymentsOpen;
    $("finePay").hidden = !paymentsOpen; $("fineList").hidden = paymentsOpen;
  }
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
    if (g.mystery || g.filler) {
      // "?" bubble: a guest who chose not to show up on the wall, or a placeholder while the wall fills up
      const m = document.createElement("span");
      m.className = "bubble mystery" + (g.filler ? " filler" : "");
      m.setAttribute("role", "listitem");
      const face = document.createElement("span"); face.className = "face"; face.textContent = "?";
      m.append(face);
      if (g.mystery) { const h = document.createElement("span"); h.className = "handle"; h.textContent = "Mystery guest"; m.append(h); }
      return m;
    }
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

  const MIN_BUBBLES = 12; // the wall never looks empty: "?" placeholders until 12 real guests
  function renderWall(real) {
    const guests = real.concat(Array.from({ length: Math.max(0, MIN_BUBBLES - real.length) }, (_, i) => ({ id: "filler-" + i, filler: true })));
    $("wallEmpty").hidden = true;
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
  let spotsLeft = P.capacity;
  function renderCounts(going, held) {
    const left = Math.max(0, P.capacity - going - (held || 0));
    spotsLeft = left; tickCountdown();
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
      const guests = params.has("preview") ? sample.slice(0, 5).map((h) => ({ id: h, instagram: h, name: h.replace(/[._\d]/g, " ") })).concat([{ id: "m1", mystery: true }]) : [];
      renderWall(guests); renderCounts(0, 0); return;
    }
    try {
      const d = await api("wall");
      applyMode(d.paymentsOpen);
      renderWall(d.guests); renderCounts(d.going, d.held); renderCrews(d.crews);
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
    const gender = (f.querySelector("input[name=gender]:checked") || {}).value;
    const refName = $("refName").value.trim().replace(/\s+/g, " "), refSchool = $("refSchool").value;
    const phone = f.phone.value.trim(), digits = phone.replace(/\D/g, "");
    if (name.length < 2) return showError("Add your name.");
    if (!/^[a-z0-9._]{1,30}$/.test(instagram)) return showError("That Instagram handle doesn't look right.");
    if (digits.length < 10 || digits.length > 15) return showError("Add a valid phone number.");
    if (!school) return showError("Pick your school.");
    if (school === "Other" && refName.length < 2) return showError("Tell us who invited you.");
    if (school === "Other" && !refSchool) return showError("Pick the school of who invited you.");
    if (!gender) return showError("Select your gender.");
    if (!$("terms").checked) return showError("Please confirm you understand there are no refunds.");
    if (PREVIEW) return showError("Preview mode — payments turn on once the site is connected.");
    $("payBtn").disabled = true; $("payBtn").textContent = "Sending…";
    try {
      const d = await api("apply", { name, instagram, phone, school, gender, refName, refSchool, showPhoto: $("showPhoto").checked, photo: photoData });
      history.replaceState(null, "", "/?t=" + d.token);
      showApplied(d.token, d);
    } catch (err) {
      showError(err.message); $("payBtn").disabled = false; $("payBtn").textContent = submitLabel();
    }
  });

  // ---------- step 2: pay ----------
  async function startPayment(token, btn) {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = "Opening checkout…";
    try { location.href = (await api("pay", { t: token })).url; }
    catch (err) { btn.disabled = false; btn.textContent = label; alert(err.message); }
  }
  function payBlock(token, amount) {
    const btn = document.createElement("button");
    btn.className = "btn wide"; btn.type = "button"; btn.textContent = `Pay $${amount} now`;
    btn.onclick = () => startPayment(token, btn);
    const note = document.createElement("p"); note.className = "fine";
    note.textContent = "Secure checkout by Stripe · card, Apple Pay, Google Pay · All sales final, no refunds";
    return [btn, note];
  }
  function onTheList(first) {
    const h = document.createElement("h2"); h.textContent = `You're on the list, ${first}! 🌴`;
    const p = document.createElement("p"); p.className = "warn";
    p.textContent = "Tickets drop soon — we'll text you the moment payment opens.";
    const f = document.createElement("p"); f.className = "fine";
    f.textContent = "Spots are first come, first served, and your spot is only guaranteed once you pay. Bookmark this page — it's your link to pay when tickets drop.";
    return [h, p, f];
  }
  function showApplied(token, d) {
    $("rsvp").hidden = true;
    const box = $("applied"); box.hidden = false;
    if (!d.paymentsOpen && !paymentsOpen) {
      box.replaceChildren(...onTheList(d.first));
      box.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const h = document.createElement("h2"); h.textContent = `Application received, ${d.first}! 🌴`;
    const warn = document.createElement("p"); warn.className = "warn";
    warn.textContent = "Your spot is only guaranteed once you pay.";
    const later = document.createElement("p"); later.className = "fine";
    later.textContent = "Not ready? Bookmark this page — it's your link to come back and pay before Wed, Nov 18 at midnight. Spots go to whoever pays first.";
    box.replaceChildren(h, warn, ...payBlock(token, d.amount), later);
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  $("instagram").addEventListener("blur", (e) => { e.target.value = cleanHandle(e.target.value); });
  // "Other" school → must say who invited them (event is exclusive to STU, FIU & UM)
  $("school").addEventListener("change", (e) => {
    const other = e.target.value === "Other";
    $("referral").hidden = !other;
    if (other) $("refName").focus();
  });

  // gender decides the price
  document.querySelectorAll("input[name=gender]").forEach((r) => r.addEventListener("change", () => {
    const ladies = r.value === "female";
    const b = document.createElement("b"); b.textContent = `$${ladies ? P.prices.ladies : P.prices.guys}`;
    $("yourPrice").replaceChildren(`Your ticket: ${ladies ? "Ladies" : "Guys"} · `, b);
  }));

  function renderCrews(list) {
    const items = (list || []).filter(Boolean);
    $("crews").hidden = !items.length;
    $("crewList").replaceChildren(...items.map((c) => { const li = document.createElement("li"); li.textContent = c; return li; }));
  }

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
      } else if (!d.paymentsOpen) {
        box.append(...onTheList(d.name.split(" ")[0]));
        $("rsvp").hidden = true;
      } else {
        h.textContent = `Hey ${d.name.split(" ")[0]}, almost there`;
        p.className = "warn";
        p.textContent = "Your application is in, but your spot is only guaranteed once you pay.";
        const hint = document.createElement("p"); hint.className = "fine";
        hint.textContent = "Just paid? Give it a minute and refresh this page.";
        box.append(h, p, ...(salesClosed() ? [] : payBlock(token, d.amount)), hint);
        $("rsvp").hidden = true;
      }
    } catch (err) { box.textContent = err.message; }
  }

  // ---------- countdown bar: appears by itself Tue 12AM → Wed midnight, only while payments are open ----------
  const pad = (n) => String(n).padStart(2, "0");
  function tickCountdown() {
    const now = Date.now(), end = Date.parse(P.salesClose), start = Date.parse(P.countdownStart || P.salesClose);
    const show = paymentsOpen && now >= start && now < end && spotsLeft > 0;
    $("countdown").hidden = !show;
    if (!show) return;
    const s = Math.floor((end - now) / 1000), d = Math.floor(s / 86400);
    $("cdTime").textContent = (d ? d + "d " : "") + `${pad(Math.floor(s % 86400 / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}`;
    $("cdSpots").textContent = spotsLeft;
  }
  setInterval(tickCountdown, 1000);

  // ---------- boot ----------
  loadWall();
  if (!reduced) requestAnimationFrame(tick); else tick(0);
  if (!PREVIEW) setInterval(loadWall, 20000);
  addEventListener("resize", () => { const s = sizeFor(floaters.size); floaters.forEach((f) => { f.s = s; f.el.style.setProperty("--s", s + "px"); }); if (reduced) tick(0); });
  const t = params.get("t");
  if (t && !PREVIEW) loadTicket(t);
})();
