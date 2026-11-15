(() => {
  const $ = (id) => document.getElementById(id);
  let pw = "";
  try { pw = sessionStorage.getItem("adm") || ""; } catch {}
  let state = null, filter = "all"; // open on everyone, so nobody on the list gets missed

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
      const cur = best.get(g.instagram);
      if (!cur || (g.status === "paid" && cur.status !== "paid")) best.set(g.instagram, g);
    }
    return [...best.values()];
  }

  function render() {
    const all = people();
    const paid = all.filter((g) => g.status === "paid");
    const waiting = all.filter((g) => g.status !== "paid");
    const ladies = paid.filter((g) => g.ticket === "ladies").length;
    const money = paid.reduce((s, g) => s + g.amount_cents, 0) / 100;
    const inside = paid.filter((g) => g.checked_in).length;
    // everyone who joined (paid or not), split by gender — like the Google Forms summary
    const women = all.filter((g) => g.gender === "female").length, men = all.filter((g) => g.gender === "male").length;
    const unknown = all.length - women - men;
    const pct = (n) => (all.length ? Math.round((n / all.length) * 100) : 0);
    $("stats").replaceChildren(...[
      [all.length, "joined the list"],
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
      : 'Only "Join the list" is open. Flip this when the house is confirmed.';
    $("payToggle").textContent = open ? "Close payments" : "Open payments";
    if (document.activeElement !== $("address")) $("address").value = state.settings.address;
    if (document.activeElement !== $("crewsInput")) $("crewsInput").value = (state.settings.crews || []).join("\n");
    $("released").checked = state.settings.address_released;

    const q = $("q").value.trim().toLowerCase().replace(/^@/, "");
    const n = { all: all.length, pending: waiting.length, paid: paid.length };
    document.querySelectorAll("[data-f]").forEach((b) => { b.textContent = `${b.dataset.label} (${n[b.dataset.f]})`; });
    const rows = all.filter((g) =>
      (filter === "all" || g.status === filter) &&
      (!q || g.name.toLowerCase().includes(q) || g.instagram.includes(q) || (g.phone || "").includes(q.replace(/\D/g, "") || "~")));
    $("list").replaceChildren(...rows.map(row));
    if (!rows.length) { const p = document.createElement("p"); p.className = "fine"; p.textContent = "Nobody here yet."; $("list").append(p); }
  }

  function row(g) {
    const el = document.createElement("div");
    el.className = "g " + g.status;
    const face = document.createElement("div"); face.className = "face";
    if (g.photo) { const i = document.createElement("img"); i.src = g.photo; i.alt = ""; face.append(i); }
    else face.textContent = g.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

    const who = document.createElement("div"); who.className = "who";
    const b = document.createElement("b"); b.textContent = g.name;
    const sm = document.createElement("small");
    const sex = g.gender === "female" ? "Female" : g.gender === "male" ? "Male" : "";
    sm.textContent = `@${g.instagram} · ${g.school}${sex ? " · " + sex : ""} · ${g.ticket === "ladies" ? "Ladies $20" : "Guys $40"}${g.phone ? " · " + g.phone : ""}${g.referrer_name ? ` · invited by ${g.referrer_name} (${g.referrer_school})` : ""}${g.status === "paid" && !g.show_photo ? " · mystery on wall" : ""}`;
    const tag = document.createElement("span"); tag.className = "tag " + g.status; tag.textContent = g.status === "paid" ? "paid" : "on the list · not paid";
    who.append(b, " ", tag, sm);

    const acts = document.createElement("div"); acts.className = "acts";
    if (g.status === "paid") {
      acts.append(btn(g.checked_in ? "✓ Inside" : "Check in", g.checked_in, () => load({ op: "checkin", id: g.id, value: !g.checked_in })));
      acts.append(btn(g.hidden ? "Shown as ?" : "Show as ? on wall", g.hidden, () => load({ op: "hide", id: g.id, value: !g.hidden })));
    }
    const ig = document.createElement("a"); ig.className = "mini"; ig.textContent = "Instagram"; ig.target = "_blank"; ig.rel = "noopener";
    ig.href = "https://instagram.com/" + encodeURIComponent(g.instagram); ig.style.textDecoration = "none";
    acts.append(ig);
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
    const phones = [...new Set(state.guests.filter((g) => g.status !== "paid" && g.phone).map((g) => g.phone))];
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
