(() => {
  const $ = (id) => document.getElementById(id);
  let pw = "";
  try { pw = sessionStorage.getItem("adm") || ""; } catch {}
  let state = null, filter = "review"; // opens on the requests waiting for approval

  async function call(body = {}) {
    const res = await fetch(`${window.PARTY.api}?action=admin`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw, ...body }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Error");
    return d;
  }

  async function load(body) {
    try {
      state = await call(body);
      try { sessionStorage.setItem("adm", pw); } catch {}
      $("login").hidden = true; $("panel").hidden = false;
      render();
    } catch (e) {
      $("login").hidden = false; $("panel").hidden = true;
      $("loginErr").textContent = e.message; $("loginErr").hidden = !pw;
    }
  }

  // one row per person: if someone joined twice with the same @, keep their newest entry (paid always wins)
  function people() {
    const best = new Map();
    for (const g of state.guests) { // already newest first
      const k = g.instagram || g.id; // Google Forms people have no @
      const cur = best.get(k);
      if (!cur || (g.status === "paid" && cur.status !== "paid")) best.set(k, g);
    }
    return [...best.values()];
  }

  const SCHOOLS = [["St. Thomas", "STU"], ["FIU", "FIU"], ["UM", "UM"], ["Other", "Other"]];
  function cell(n, of) { const td = document.createElement("td"); td.textContent = n; if (of) { const s = document.createElement("small"); s.textContent = ` ${Math.round((n / of) * 100)}%`; td.append(s); } return td; }
  function renderMix(approved, review) {
    // the main metric: school × gender among approved guests (goal: close to 50/50)
    const t = document.createElement("table");
    const head = document.createElement("tr");
    ["School", "Women", "Men", "Total"].forEach((h) => { const th = document.createElement("th"); th.textContent = h; head.append(th); });
    t.append(head);
    const count = (list, school, gender) => list.filter((g) => (!school || g.school === school) && (!gender || g.gender === gender)).length;
    for (const [school, label] of SCHOOLS) {
      const tot = count(approved, school);
      if (!tot && school !== "St. Thomas" && school !== "FIU") continue;
      const tr = document.createElement("tr");
      const th = document.createElement("td"); th.textContent = label; tr.append(th);
      tr.append(cell(count(approved, school, "female")), cell(count(approved, school, "male")), cell(tot, approved.length));
      t.append(tr);
    }
    const tr = document.createElement("tr"); tr.className = "total";
    const th = document.createElement("td"); th.textContent = "Total"; tr.append(th);
    tr.append(cell(count(approved, null, "female"), approved.length), cell(count(approved, null, "male"), approved.length), cell(approved.length));
    t.append(tr);
    const h = document.createElement("h3"); h.textContent = "Mix of approved guests — goal: close to 50/50";
    const note = document.createElement("p"); note.className = "fine";
    note.textContent = review.length ? `+ ${review.length} waiting for approval (${count(review, null, "female")} women · ${count(review, null, "male")} men)` : "No requests waiting.";
    $("mix").replaceChildren(h, t, note);
    // teams
    const teams = {};
    approved.forEach((g) => { const k = g.team || "No team yet"; teams[k] = (teams[k] || 0) + 1; });
    const ul = document.createElement("ul");
    Object.entries(teams).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => { const li = document.createElement("li"); li.append(k + " "); const b = document.createElement("b"); b.textContent = n; li.append(b); ul.append(li); });
    const ht = document.createElement("h3"); ht.textContent = "Teams (approved)";
    $("teams").replaceChildren(ht, ul);
  }

  function render() {
    const everyone = people();
    const all = everyone.filter((g) => g.approval === "approved"); // stats count approved guests
    const review = everyone.filter((g) => g.approval === "pending");
    const paid = all.filter((g) => g.status === "paid");
    const waiting = all.filter((g) => g.status !== "paid");
    const ladies = paid.filter((g) => g.ticket === "ladies").length;
    const money = paid.reduce((s, g) => s + g.amount_cents, 0) / 100;
    const inside = paid.filter((g) => g.checked_in).length;
    // everyone who joined (paid or not), split by gender — like the Google Forms summary
    const women = all.filter((g) => g.gender === "female").length, men = all.filter((g) => g.gender === "male").length;
    const unknown = all.length - women - men;
    const pct = (n) => (all.length ? Math.round((n / all.length) * 100) : 0);
    renderMix(all, review);
    $("stats").replaceChildren(...[
      [all.length, "approved on the list"],
      [review.length, "waiting for approval"],
      [`${women} · ${men}`, `women · men (${pct(women)}% · ${pct(men)}%)${unknown ? ` · ${unknown} unknown` : ""}`],
      [paid.length + " / " + state.capacity, "paid"],
      [`${ladies} · ${paid.length - ladies}`, "paid ladies · guys"],
      ["$" + money.toLocaleString("en-US"), "sold online"],
      [inside, "checked in"],
    ].map(([b, s]) => { const d = document.createElement("div"); d.innerHTML = "<b></b><span></span>"; d.children[0].textContent = b; d.children[1].textContent = s; return d; }));

    const open = !!state.settings.payments_open;
    $("paySwitch").classList.toggle("open", open);
    $("payState").textContent = open ? "Payments: OPEN" : "Payments: closed";
    $("payHint").textContent = open ? "People can pay now. Closing it hides payment again (nothing is deleted)."
      : 'Only "Request an invite" is open. Flip this when the house is confirmed.';
    $("payToggle").textContent = open ? "Close payments" : "Open payments";
    if (document.activeElement !== $("address")) $("address").value = state.settings.address;
    if (document.activeElement !== $("crewsInput")) $("crewsInput").value = (state.settings.crews || []).join("\n");
    $("released").checked = state.settings.address_released;

    const q = $("q").value.trim().toLowerCase().replace(/^@/, "");
    const declined = everyone.filter((g) => g.approval === "declined");
    const n = { review: review.length, list: waiting.length, paid: paid.length, declined: declined.length, all: everyone.length };
    document.querySelectorAll("[data-f]").forEach((b) => { b.textContent = `${b.dataset.label} (${n[b.dataset.f]})`; });
    const inFilter = { review: (g) => g.approval === "pending", list: (g) => g.approval === "approved" && g.status !== "paid",
      paid: (g) => g.status === "paid", declined: (g) => g.approval === "declined", all: () => true }[filter];
    const rows = everyone.filter((g) =>
      inFilter(g) &&
      (!q || g.name.toLowerCase().includes(q) || (g.instagram || "").includes(q) || (g.phone || "").includes(q.replace(/\D/g, "") || "~")));
    $("list").replaceChildren(...rows.map(row));
    if (!rows.length) { const p = document.createElement("p"); p.className = "fine"; p.textContent = "Nobody here yet."; $("list").append(p); }
  }

  function row(g) {
    const el = document.createElement("div");
    el.className = "g " + g.status + (g.approval === "declined" ? " declined" : "");
    const face = document.createElement("div"); face.className = "face";
    if (g.photo) { const i = document.createElement("img"); i.src = g.photo; i.alt = ""; face.append(i); }
    else face.textContent = g.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

    const who = document.createElement("div"); who.className = "who";
    const b = document.createElement("b"); b.textContent = g.name;
    const sm = document.createElement("small");
    const sex = g.gender === "female" ? "Female" : g.gender === "male" ? "Male" : "";
    sm.textContent = `${g.instagram ? "@" + g.instagram : "no @"} · ${g.school}${g.team ? " · " + g.team : ""}${sex ? " · " + sex : ""}${g.phone ? " · " + g.phone : ""}${g.referrer_name ? ` · invited by ${g.referrer_name} (${g.referrer_school})` : ""}${g.status === "paid" && !g.show_photo ? " · mystery on wall" : ""}`;
    const tag = document.createElement("span");
    if (g.status === "paid") { tag.className = "tag paid"; tag.textContent = `paid $${g.amount_cents / 100}`; }
    else if (g.approval === "pending") { tag.className = "tag review"; tag.textContent = "waiting for approval"; }
    else if (g.approval === "declined") { tag.className = "tag declined"; tag.textContent = "declined"; }
    else { tag.className = "tag"; tag.textContent = "approved · not paid"; }
    who.append(b, " ", tag, sm);

    const acts = document.createElement("div"); acts.className = "acts";
    if (g.status !== "paid" && g.approval !== "approved") { const a = btn("Approve", false, () => load({ op: "approve", id: g.id })); a.classList.add("ok"); acts.append(a); }
    if (g.status !== "paid" && g.approval !== "declined") { const d = btn("Decline", false, () => load({ op: "decline", id: g.id })); d.classList.add("no"); acts.append(d); }
    if (g.status === "paid") {
      acts.append(btn(g.checked_in ? "✓ Inside" : "Check in", g.checked_in, () => load({ op: "checkin", id: g.id, value: !g.checked_in })));
      acts.append(btn(g.hidden ? "Shown as ?" : "Show as ? on wall", g.hidden, () => load({ op: "hide", id: g.id, value: !g.hidden })));
    }
    if (g.instagram) {
      const ig = document.createElement("a"); ig.className = "mini"; ig.textContent = "Instagram"; ig.target = "_blank"; ig.rel = "noopener";
      ig.href = "https://instagram.com/" + encodeURIComponent(g.instagram); ig.style.textDecoration = "none";
      acts.append(ig);
    }
    if (g.source === "google_forms") { const t = document.createElement("span"); t.className = "tag"; t.textContent = "Google Forms"; who.append(" ", t); }
    if (g.phone) {
      const tx = document.createElement("a"); tx.className = "mini"; tx.textContent = "Text"; tx.style.textDecoration = "none";
      tx.href = "sms:" + g.phone; acts.append(tx);
    }
    el.append(face, who, acts);
    return el;
  }
  function btn(label, on, fn) { const b = document.createElement("button"); b.className = "mini" + (on ? " on" : ""); b.textContent = label; b.onclick = fn; return b; }

  $("login").addEventListener("submit", (e) => { e.preventDefault(); pw = $("pw").value; load(); });
  $("addrForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if ($("released").checked && !$("address").value.trim()) return alert("Type the address first.");
    $("saveAddr").textContent = "Saving…";
    await load({ op: "settings", address: $("address").value.trim(), released: $("released").checked });
    $("saveAddr").textContent = "Saved ✓"; setTimeout(() => ($("saveAddr").textContent = "Save address"), 1500);
  });
  $("payToggle").addEventListener("click", () => {
    const open = !state.settings.payments_open;
    const msg = open
      ? "Open payments now? Everyone on the site will see the Pay button right away. Make sure the Stripe keys are set."
      : "Close payments? The Pay button disappears (nothing is deleted).";
    if (confirm(msg)) load({ op: "payments", value: open });
  });
  $("copyPhones").addEventListener("click", async () => {
    const phones = [...new Set(state.guests.filter((g) => g.status !== "paid" && g.approval === "approved" && g.phone).map((g) => g.phone))];
    try { await navigator.clipboard.writeText(phones.join("\n")); $("copyMsg").textContent = `${phones.length} numbers copied ✓`; }
    catch { prompt("Copy these numbers:", phones.join(", ")); }
  });
  $("crewForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("saveCrews").textContent = "Saving…";
    await load({ op: "crews", crews: $("crewsInput").value.split("\n").map((x) => x.trim()).filter(Boolean) });
    $("saveCrews").textContent = "Saved ✓"; setTimeout(() => ($("saveCrews").textContent = "Save crews"), 1500);
  });
  $("q").addEventListener("input", () => state && render());
  document.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.f; document.querySelectorAll("[data-f]").forEach((x) => x.classList.toggle("on", x === b)); render();
  }));

  if (pw) load();
  setInterval(() => { if (pw && !$("panel").hidden && document.activeElement !== $("address") && document.activeElement !== $("crewsInput")) load(); }, 30000);
})();
