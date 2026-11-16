(() => {
  const P = window.PARTY;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const PREVIEW = !P.api;
  // Guy / Girl picked on the entry screen: shows their own price and the opposite gender first on the wall
  let viewer = null; // "male" | "female" | null
  let lastGuests = [];
  let onlyOpposite = false; // wall filter: "Everyone" (default) or only the opposite gender
  function tailor(list) {
    if (!viewer || !onlyOpposite) return list;
    const opp = viewer === "male" ? "female" : "male";
    return list.filter((g) => g.gender === opp);
  }
  document.querySelectorAll("[data-wf]").forEach((b) => b.addEventListener("click", () => {
    onlyOpposite = b.dataset.wf === "opp";
    document.querySelectorAll("[data-wf]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
    renderWall(tailor(lastGuests));
  }));
  // ticket phases: online price → late tickets (Thu–Fri) → closed (text us / at the door)
  const phase = () => { const n = Date.now(); return n <= Date.parse(P.salesClose) ? "online" : n <= Date.parse(P.lateClose) ? "late" : "closed"; };
  const priceFor = (gender, ph = phase()) => (P.prices[gender === "female" ? "female" : "male"] || {})[ph === "closed" ? "door" : ph];
  function renderPrices() {
    if (!viewer) return;
    const pr = P.prices[viewer], ph = phase(), order = ["online", "late", "door"];
    const cards = [["online", "Online", "until Wed"], ["late", "Late", "Thu–Fri"], ["door", "At the door", "Fri night"]]
      .filter(([k]) => pr[k] != null) // girls have no door price
      .map(([k, label, when]) => {
        const d = document.createElement("div");
        const cur = (ph === "closed" ? "door" : ph) === k;
        d.className = "price" + (k === "door" ? " door" : "") + (cur ? " now" : order.indexOf(k) < order.indexOf(ph === "closed" ? "door" : ph) ? " past" : "");
        const sp = document.createElement("span"); sp.textContent = label;
        const b = document.createElement("b"); b.textContent = "$" + pr[k];
        const sm = document.createElement("small"); sm.textContent = when;
        d.append(sp, b, sm); return d;
      });
    const box = document.querySelector(".prices");
    box.replaceChildren(...cards);
    box.classList.add("solo"); box.classList.toggle("two", cards.length === 2);
  }
  function choose(gender) {
    viewer = gender === "female" ? "female" : "male";
    try { localStorage.setItem("afterdark-gender", viewer); } catch {}
    renderPrices(); // their own prices: online / late (/ door for guys)
    // form: preselect their gender (they can still change it if they tapped the wrong one)
    const r = document.querySelector(`input[name=gender][value=${viewer}]`);
    if (r && !document.querySelector("input[name=gender]:checked")) { r.checked = true; r.dispatchEvent(new Event("change")); }
    $("wfOpp").textContent = viewer === "male" ? "Only girls 👀" : "Only guys 👀";
    $("wallFilter").hidden = false;
    renderWall(tailor(lastGuests));
  }
  document.querySelectorAll("[data-gender]").forEach((b) => b.addEventListener("click", () => choose(b.dataset.gender)));
  let paymentsOpen = false; // organizer flips this in /admin
  const submitLabel = () => "Request an invite"; // invite only: every new request waits for the organizer's approval
  function applyMode(open) {
    paymentsOpen = !!open;
    if (!$("payBtn").disabled) $("payBtn").textContent = submitLabel();
    $("listNote").hidden = paymentsOpen;
  }
  const salesClosed = () => phase() === "closed"; // online + late are both over

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
    // guests without an @ (from Google Forms) show their short name and don't link anywhere
    const a = document.createElement(g.instagram ? "a" : "span");
    a.className = "bubble" + (me ? " me" : "");
    if (g.instagram) { a.href = `https://instagram.com/${encodeURIComponent(g.instagram)}`; a.target = "_blank"; a.rel = "noopener"; }
    a.setAttribute("role", "listitem");
    a.title = g.name;
    const face = document.createElement("span");
    face.className = "face";
    if (g.photo) { const img = document.createElement("img"); img.src = g.photo; img.alt = ""; img.loading = "lazy"; face.append(img); }
    else face.textContent = initials(g.name || g.instagram);
    const h = document.createElement("span");
    h.className = "handle"; h.textContent = g.instagram ? "@" + g.instagram : g.name;
    a.append(face, h);
    return a;
  }

  // ---------- floating wall ----------
  // Calm wall that people can actually read:
  //  • real people (name + @) always come first; "?" bubbles are capped at a few, just for curiosity
  //  • when more people joined than fit, each bubble gets ~5.5 s on screen, then the next one takes its place
  //  • if everyone with a name fits, they stay put and only the "?" bubbles take turns
  const wall = $("wall");
  const floaters = new Map(); // on-screen bubbles: id -> {el,x,y,vx,vy,s,phase,born,leaving,named}
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const LIFE = 5500;      // ms each bubble stays when someone else is waiting
  const MAX_MYSTERY = 3;  // "?" bubbles on screen at most
  const MIN_BUBBLES = 6;  // "?" placeholders only while the list is tiny
  let pool = [], byId = new Map(), namedQ = [], mysteryQ = [], slotCount = 8, bubbleSize = 76;
  let namedSlots = 0, mysterySlots = 0;
  const isNamed = (g) => g && !g.mystery && !g.filler;

  function sizeFor(n) {
    const area = wall.clientWidth * wall.clientHeight;
    const s = Math.sqrt(area / Math.max(n, 1) / 3.2);
    return Math.max(46, Math.min(92, s));
  }
  function slotsFor() {
    const W = wall.clientWidth, H = wall.clientHeight, s = W < 500 ? 66 : 76;
    return Math.max(6, Math.min(24, Math.round((W * H) / (s * s * 4.2))));
  }
  const visible = (named) => [...floaters.values()].filter((f) => !f.leaving && (named === undefined || f.named === named));

  function spawn(g, stagger) {
    if (!g || floaters.has(g.id)) return;
    const W = wall.clientWidth, H = wall.clientHeight, s = bubbleSize;
    const el = bubbleEl(g, false);
    el.classList.add("enter");
    el.style.setProperty("--s", s + "px");
    wall.append(el);
    const ang = Math.random() * Math.PI * 2, sp = 0.25 + Math.random() * 0.12;
    const x = Math.random() * Math.max(1, W - s), y = Math.random() * Math.max(1, H - s - 26);
    el.style.transform = `translate(${x}px,${y}px)`; // placed right away (also when animations are off)
    floaters.set(g.id, { el, s, x, y,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, phase: Math.random() * 6, leaving: false, named: isNamed(g),
      born: performance.now() - (stagger ? Math.random() * LIFE : 0) }); // first batch: staggered so they don't all swap at once
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("enter")));
  }
  function retire(id) {
    const f = floaters.get(id);
    if (!f || f.leaving) return;
    f.leaving = true; f.el.classList.add("leave");
    setTimeout(() => { f.el.remove(); if (floaters.get(id) === f) floaters.delete(id); }, 900);
  }
  function fill(stagger) {
    while (visible(true).length < namedSlots && namedQ.length) spawn(byId.get(namedQ.shift()), stagger);
    while (visible(false).length < mysterySlots && mysteryQ.length) spawn(byId.get(mysteryQ.shift()), stagger);
  }

  function renderWall(real) {
    const all = real.concat(Array.from({ length: Math.max(0, MIN_BUBBLES - real.length) }, (_, i) => ({ id: "filler-" + i, filler: true })));
    $("wallEmpty").hidden = true;
    const known = new Set(pool.map((g) => g.id));
    byId = new Map(all.map((g) => [g.id, g]));
    pool = all;
    for (const id of [...floaters.keys()]) if (!byId.has(id)) retire(id);
    const waiting = (q) => q.filter((id) => byId.has(id) && !floaters.has(id));
    const fresh = all.filter((g) => !known.has(g.id) && !floaters.has(g.id));
    // newcomers jump the line so people see themselves soon after joining
    namedQ = fresh.filter(isNamed).map((g) => g.id).concat(waiting(namedQ));
    mysteryQ = waiting(mysteryQ).concat(fresh.filter((g) => !isNamed(g)).map((g) => g.id));
    for (const g of all) {
      const q = isNamed(g) ? namedQ : mysteryQ;
      if (!floaters.has(g.id) && !q.includes(g.id)) q.push(g.id);
    }

    slotCount = slotsFor();
    const namedCount = all.filter(isNamed).length, mysteryCount = all.length - namedCount;
    mysterySlots = Math.min(mysteryCount, MAX_MYSTERY, Math.max(mysteryCount ? 1 : 0, slotCount - namedCount));
    namedSlots = Math.min(namedCount, slotCount - mysterySlots);
    bubbleSize = Math.min(wall.clientWidth < 500 ? 72 : 84, sizeFor(namedSlots + mysterySlots));
    for (const f of floaters.values()) { f.s = bubbleSize; f.el.style.setProperty("--s", bubbleSize + "px"); }
    fill(!known.size);
  }

  // every half second: bubbles whose turn is over make room for whoever is waiting (one swap per kind at a time)
  function rotate() {
    const now = performance.now();
    for (const [named, q] of [[true, namedQ], [false, mysteryQ]]) {
      if (!q.length) continue;
      const due = [...floaters.entries()]
        .filter(([, f]) => !f.leaving && f.named === named && !f.el.classList.contains("me") && now - f.born > LIFE)
        .sort((a, b) => a[1].born - b[1].born)[0];
      if (due) { retire(due[0]); q.push(due[0]); spawn(byId.get(q.shift())); }
    }
    fill(false);
    setTimeout(rotate, 500);
  }
  setTimeout(rotate, 1000); // turns keep going even with "reduce motion" on (bubbles just don't drift)

  function tick(t) {
    const W = wall.clientWidth, H = wall.clientHeight;
    const list = [...floaters.values()];
    // soft push-apart so bubbles don't pile on top of each other
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const p = list[i], q = list[j];
      const dx = q.x - p.x, dy = q.y - p.y, dist = Math.hypot(dx, dy) || 1, min = p.s * 1.25;
      if (dist < min) {
        const push = (min - dist) / dist * 0.015;
        p.vx -= dx * push; p.vy -= dy * push; q.vx += dx * push; q.vy += dy * push;
      }
    }
    for (const f of list) {
      const sp = Math.hypot(f.vx, f.vy), max = 0.42, minSp = 0.22; // calm but visible drift (~15–25 px/s)
      if (sp > max) { f.vx *= max / sp; f.vy *= max / sp; }
      else if (sp < minSp) { f.vx *= minSp / (sp || 1); f.vy *= minSp / (sp || 1); }
      const h = f.s + 26;
      f.x += f.vx; f.y += f.vy;
      if (f.x < 0 || f.x > W - f.s) { f.vx *= -1; f.x = Math.max(0, Math.min(W - f.s, f.x)); }
      if (f.y < 0 || f.y > H - h) { f.vy *= -1; f.y = Math.max(0, Math.min(H - h, f.y)); }
      const bob = Math.sin(t / 1400 + f.phase) * 2.5;
      f.el.style.transform = `translate(${f.x}px,${f.y + bob}px)`;
    }
    if (!reduced) requestAnimationFrame(tick);
  }

  // ---------- counter ----------
  let spotsLeft = P.capacity;
  function renderCounts(d) {
    const used = paymentsOpen ? (d.going || 0) + (d.held || 0) : (d.listed ?? (d.guests || []).length);
    const left = Math.max(0, P.capacity - used);
    spotsLeft = left; tickCountdown();
    $("spotsLeft").textContent = left > 0 ? "Few" : "0"; // owner's choice: show urgency, not the exact number
    const closed = salesClosed(), soldOut = paymentsOpen && left <= 0; // during the list phase nobody is turned away
    if (closed || soldOut) {
      const box = $("closedMsg");
      box.replaceChildren(soldOut ? "Sold out online 🔥" : "Online sales are closed.", document.createElement("br"), "Text or call ");
      const tel = document.createElement("a"); tel.className = "phone"; tel.href = "sms:+1" + P.phone.replace(/\D/g, ""); tel.textContent = P.phone;
      box.append(tel, " to request a ticket" + (P.prices.male.door ? ` · Guys at the door: $${P.prices.male.door}` : ""));
      box.hidden = false;
      $("payBtn").disabled = true; $("heroCta").textContent = soldOut ? "Sold out" : "Sales closed";
    }
  }

  // ---------- data ----------
  async function loadWall() {
    if (PREVIEW) {
      const sample = ["jordan.m", "sofia.rr", "mike_305", "isa.vibes", "dani.fiu", "chris.stu", "val.mia", "leo.dade", "nat.sun", "gabi.linen", "tony.v", "mari.305"];
      const guests = params.has("preview") ? sample.slice(0, 5).map((h) => ({ id: h, instagram: h, name: h.replace(/[._\d]/g, " ") })).concat([{ id: "m1", mystery: true }]) : [];
      lastGuests = guests; renderWall(tailor(guests)); renderCounts({ guests }); return;
    }
    try {
      const d = await api("wall");
      applyMode(d.paymentsOpen);
      lastGuests = d.guests; renderWall(tailor(d.guests)); renderCounts(d); renderCrews(d.crews);
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
    const team = f.team.value === "Other" ? $("teamOther").value.trim().replace(/\s+/g, " ") : f.team.value;
    const phone = f.phone.value.trim(), digits = phone.replace(/\D/g, "");
    if (name.length < 2) return showError("Add your name.");
    if (!/^[a-z0-9._]{1,30}$/.test(instagram)) return showError("That Instagram handle doesn't look right.");
    if (digits.length < 10 || digits.length > 15) return showError("Add a valid phone number.");
    if (!school) return showError("Pick your school.");
    if (school === "Other" && refName.length < 2) return showError("Tell us who invited you.");
    if (school === "Other" && !refSchool) return showError("Pick the school of who invited you.");
    if (!f.team.value) return showError("Pick your team (or \"Not on a team\").");
    if (team.length < 2) return showError("Tell us which team.");
    if (!gender) return showError("Select your gender.");
    if (!$("terms").checked) return showError("Please confirm you understand there are no refunds.");
    if (PREVIEW) return showError("Preview mode — payments turn on once the site is connected.");
    $("payBtn").disabled = true; $("payBtn").textContent = "Sending…";
    try {
      const d = await api("apply", { name, instagram, phone, school, team, gender, refName, refSchool, showPhoto: $("showPhoto").checked, photo: photoData });
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
  function underReview(first) {
    const h = document.createElement("h2"); h.textContent = `Request received, ${first}! 🌴`;
    const p = document.createElement("p"); p.className = "warn";
    p.textContent = "We'll text you if you're in.";
    const f = document.createElement("p"); f.className = "fine";
    f.textContent = "Invite only — we review every request. Bookmark this page: it's your link to check your invite and get your ticket.";
    return [h, p, f];
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
    if (d.approval !== "approved") {
      box.replaceChildren(...underReview(d.first));
      box.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!d.paymentsOpen && !paymentsOpen) {
      box.replaceChildren(...onTheList(d.first));
      box.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const h = document.createElement("h2"); h.textContent = `Application received, ${d.first}! 🌴`;
    const warn = document.createElement("p"); warn.className = "warn";
    warn.textContent = "Your spot is only guaranteed once you pay.";
    const later = document.createElement("p"); later.className = "fine";
    later.textContent = "Not ready? Bookmark this page — it's your link to come back and pay. Online price until Wed at midnight, late tickets until Fri 6PM. Spots go to whoever pays first.";
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
    const ph = phase(), price = priceFor(r.value, ph);
    const b = document.createElement("b"); b.textContent = price != null ? `$${price}` : "text us";
    $("yourPrice").replaceChildren(`Your ticket (${ph === "online" ? "online price" : ph === "late" ? "late ticket" : "at the door"}): `, b);
  }));

  // Team / Sport options (+ "Other" with a text box)
  $("team").append(...P.teams.concat(["Not on a team", "Other"]).map((t) => { const o = document.createElement("option"); o.value = o.textContent = t; return o; }));
  $("team").addEventListener("change", (e) => {
    const other = e.target.value === "Other";
    $("teamOtherWrap").hidden = !other;
    if (other) $("teamOther").focus();
  });

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
      } else if (d.approval !== "approved") {
        box.append(...underReview(d.name.split(" ")[0])); // pending or declined: same neutral message
        $("rsvp").hidden = true;
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
    const now = Date.now(), ph = phase(), start = Date.parse(P.countdownStart || P.salesClose);
    const end = Date.parse(ph === "online" ? P.salesClose : P.lateClose);
    const show = paymentsOpen && ph !== "closed" && now >= start && spotsLeft > 0;
    $("cdLabel").textContent = ph === "online" ? "⏰ Online price ends in" : "⏰ Late tickets end in";
    $("countdown").hidden = !show;
    if (!show) return;
    const s = Math.floor((end - now) / 1000), d = Math.floor(s / 86400);
    $("cdTime").textContent = (d ? d + "d " : "") + `${pad(Math.floor(s % 86400 / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}`;
    $("cdSpots").textContent = spotsLeft > 0 ? "Few" : "0";
  }
  setInterval(tickCountdown, 1000);

  // ---------- boot ----------
  loadWall();
  if (!reduced) requestAnimationFrame(tick); else tick(0);
  if (!PREVIEW) setInterval(loadWall, 15000);
  addEventListener("resize", () => { renderWall(tailor(lastGuests)); if (reduced) tick(0); });
  const t = params.get("t");
  if (t && !PREVIEW) loadTicket(t);
})();
