// Vice City — After Dark backend (one Supabase Edge Function, deployed with verify_jwt = false).
// Secrets (Supabase → Edge Functions → Secrets): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, ADMIN_PASSWORD, SITE_URL
import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const CAPACITY = 200;
// cents, by phase: online price until Wed midnight → late tickets until Fri 6PM → closed (text us / at the door)
const PRICES: Record<string, Record<string, number>> = {
  female: { online: 2000, late: 3500 },
  male: { online: 4000, late: 5500 },
};
const SALES_CLOSE = Date.parse("2026-11-18T23:59:59-05:00"); // end of the online price
const LATE_CLOSE = Date.parse("2026-11-20T18:00:00-05:00");  // end of late tickets (site stops selling)
const phase = () => (Date.now() <= SALES_CLOSE ? "online" : Date.now() <= LATE_CLOSE ? "late" : "closed");
const genderOf = (g: { gender?: string | null; ticket?: string }) => g.gender ?? (g.ticket === "ladies" ? "female" : "male");
const priceNow = (gender: string) => PRICES[gender === "female" ? "female" : "male"][phase()] ?? null;
const HOLD_MIN = 30; // opening checkout holds a spot for 30 min (Stripe's minimum session life)
const PHONE = "786-656-6926";
const SCHOOLS = ["FIU", "St. Thomas", "UM", "Other"];
const REF_SCHOOLS = ["FIU", "St. Thomas", "UM"]; // "Other" guests need an invite from one of these
const TICKET_FOR: Record<string, string> = { female: "ladies", male: "guys" }; // gender sets the price

// US numbers → +1XXXXXXXXXX; other countries must start with + (8–15 digits)
function normalizePhone(raw: string): string | null {
  const plus = raw.trim().startsWith("+");
  const d = raw.replace(/\D/g, "");
  if (!plus && d.length === 10) return "+1" + d;
  if (!plus && d.length === 11 && d[0] === "1") return "+" + d;
  if (plus && d.length >= 8 && d.length <= 15) return "+" + d;
  return null;
}
const cleanCrews = (v: unknown) =>
  (Array.isArray(v) ? v : []).map((x) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 40);

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
let _stripe: Stripe | null = null; // created on first use, so the wall works even before Stripe is set up
const stripeClient = () => {
  if (!env("STRIPE_SECRET_KEY")) throw new Error("Stripe is not set up yet.");
  return (_stripe ??= new Stripe(env("STRIPE_SECRET_KEY"), { httpClient: Stripe.createFetchHttpClient() }));
};
const SITE = env("SITE_URL").replace(/\/$/, "");

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, stripe-signature",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json" } });
const fail = (msg: string, status = 400) => json({ error: msg }, status);

const photoUrl = (path: string | null) =>
  path ? `${env("SUPABASE_URL")}/storage/v1/object/public/guest-photos/${path}` : null;
const holdSince = () => new Date(Date.now() - HOLD_MIN * 60_000).toISOString();

async function counts(exceptId?: string) {
  const paid = await db.from("guests").select("id", { count: "exact", head: true }).eq("status", "paid");
  let q = db.from("guests").select("id", { count: "exact", head: true })
    .eq("status", "pending").gte("checkout_started_at", holdSince());
  if (exceptId) q = q.neq("id", exceptId);
  const held = await q;
  return { going: paid.count ?? 0, held: held.count ?? 0 };
}

async function markPaid(guestId: string, sessionId: string) {
  await db.from("guests").update({ status: "paid", paid_at: new Date().toISOString(), stripe_session_id: sessionId })
    .eq("id", guestId).eq("status", "pending");
}

// organizer switch in /admin: false = "Join the list" only, true = people can pay
async function paymentsOpen() {
  const { data } = await db.from("settings").select("payments_open").eq("id", 1).single();
  return !!data?.payments_open;
}

// ---------- public: guest wall ----------
// List phase (payments closed): everyone who joined the list shows up. Once payments open: only paid guests.
async function wall() {
  const open = await paymentsOpen();
  let q = db.from("guests").select("id,name,instagram,photo_path,show_photo,hidden,source,gender").eq("approval", "approved");
  q = open ? q.eq("status", "paid").order("paid_at", { ascending: true }) : q.order("created_at", { ascending: true });
  const { data, error } = await q;
  if (error) return fail("Couldn't load the guest list.", 500);
  // one bubble per @ (someone may have joined twice) — keep their latest entry, in the original order
  // (people imported from Google Forms have no @, so they are keyed by their own id)
  const key = (g: { instagram: string | null; id: string }) => g.instagram ?? g.id;
  const latest = new Map(data.map((g) => [key(g), g.id]));
  const guests = data.filter((g) => latest.get(key(g)) === g.id).map((g) => {
    const fromForms = g.source === "google_forms";
    // "?" bubble: hidden by the organizer, or a site guest who unticked "show me on the wall"
    if (g.hidden || (!fromForms && (!g.show_photo || !g.instagram))) return { id: g.id, mystery: true, gender: g.gender };
    const [first, last] = g.name.trim().split(/\s+/);
    const name = last ? `${first} ${last[0]}.` : first; // never expose full last names publicly
    // Google Forms guests (owner's choice): first name + last initial only — no @, no photo
    if (fromForms) return { id: g.id, instagram: null, name, photo: null, gender: g.gender };
    return { id: g.id, instagram: g.instagram, name, photo: photoUrl(g.photo_path), gender: g.gender };
  });
  const { data: st } = await db.from("settings").select("crews").eq("id", 1).single();
  // people on the list (each @ once, paid or not) — drives "spots left" during the list phase
  const { data: handles } = await db.from("guests").select("id,instagram").eq("approval", "approved");
  const listed = new Set((handles ?? []).map((h) => h.instagram ?? h.id)).size;
  return json({ guests, listed, crews: cleanCrews(st?.crews), paymentsOpen: open, ...(await counts()), capacity: CAPACITY });
}

const closedMsg = `Online sales are closed. Text or call ${PHONE} to request a ticket.`;
const soldOutMsg = `Sold out online 🔥 Text or call ${PHONE} to request a ticket.`;

// ---------- public: step 1, apply (saves the guest; spot NOT held yet) ----------
async function apply(req: Request) {
  if (phase() === "closed") return fail(closedMsg);
  const b = await req.json().catch(() => null);
  if (!b) return fail("Bad request.");
  const name = String(b.name ?? "").trim().replace(/\s+/g, " ");
  const instagram = String(b.instagram ?? "").trim().replace(/^@+/, "").toLowerCase();
  const school = String(b.school ?? "");
  const gender = String(b.gender ?? "");
  const team = String(b.team ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  const ticket = TICKET_FOR[gender];
  const phone = normalizePhone(String(b.phone ?? ""));
  if (name.length < 2 || name.length > 60) return fail("Add your name.");
  if (!phone) return fail("Add a valid phone number.");
  if (!/^[a-z0-9._]{1,30}$/.test(instagram)) return fail("That Instagram handle doesn't look right.");
  if (!SCHOOLS.includes(school)) return fail("Pick your school.");
  const refName = school === "Other" ? String(b.refName ?? "").trim().replace(/\s+/g, " ").slice(0, 60) : "";
  const refSchool = school === "Other" ? String(b.refSchool ?? "") : "";
  if (school === "Other" && refName.length < 2) return fail("Tell us who invited you.");
  if (school === "Other" && !REF_SCHOOLS.includes(refSchool)) return fail("Pick the school of who invited you.");
  if (team.length < 2) return fail("Pick your team.");
  if (!ticket) return fail("Select your gender.");

  const dup = await db.from("guests").select("id", { count: "exact", head: true })
    .eq("instagram", instagram).eq("status", "paid");
  if ((dup.count ?? 0) > 0) return fail(`@${instagram} already has a ticket. 🌴`);

  const { going, held } = await counts();
  if (going + held >= CAPACITY) return fail(soldOutMsg);

  // optional selfie: a small JPEG data URL made by the browser
  let photo_path: string | null = null;
  if (typeof b.photo === "string" && b.photo.startsWith("data:image/jpeg;base64,")) {
    const bytes = Uint8Array.from(atob(b.photo.slice(23)), (c) => c.charCodeAt(0));
    if (bytes.length > 900_000) return fail("That photo is too big. Try another one.");
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return fail("That photo couldn't be read.");
    photo_path = `${crypto.randomUUID()}.jpg`;
    const up = await db.storage.from("guest-photos").upload(photo_path, bytes, { contentType: "image/jpeg" });
    if (up.error) photo_path = null;
  }

  const fields = {
    name, instagram, school, team, gender, phone, ticket,
    referrer_name: refName || null, referrer_school: refSchool || null, amount_cents: priceNow(gender) ?? 0, show_photo: b.showPhoto !== false,
  };
  // same @ already on the list (not paid) → update that entry instead of adding a duplicate
  const { data: prev } = await db.from("guests").select("id,photo_path,approval").eq("instagram", instagram).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: g, error } = prev
    ? await db.from("guests").update({ ...fields, photo_path: photo_path ?? prev.photo_path }).eq("id", prev.id).select("id,token,approval").single() // keeps their approval
    : await db.from("guests").insert({ ...fields, photo_path, approval: "pending" }).select("id,token,approval").single();
  if (error || !g) return fail("Couldn't save your application. Try again.", 500);
  return json({ token: g.token, first: name.split(" ")[0], approval: g.approval, amount: (priceNow(gender) ?? 0) / 100, paymentsOpen: await paymentsOpen() });
}

// ---------- public: step 2, pay (fresh Stripe checkout each time, holds the spot 30 min) ----------
async function pay(req: Request) {
  if (phase() === "closed") return fail(closedMsg);
  if (!(await paymentsOpen())) return fail("Tickets aren't on sale yet — we'll text you the moment they drop. 🌴");
  if (!env("STRIPE_SECRET_KEY") || !SITE) return fail("Payments open soon. 🌴 You're on the list.", 503);
  const b = await req.json().catch(() => ({}));
  const t = String(b.t ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(t)) return fail("Application not found.", 404);
  const { data: g } = await db.from("guests").select("*").eq("token", t).maybeSingle();
  if (!g) return fail("Application not found.", 404);
  if (g.status === "paid") return fail("You already paid. You're in! 🌴");
  if (g.approval !== "approved") return fail("Your invite is still being reviewed — we'll text you. 🌴");
  const amount = priceNow(genderOf(g));
  if (!amount) return fail(closedMsg);
  const label = phase() === "online" ? "Online" : "Late";
  const { going, held } = await counts(g.id);
  if (going + held >= CAPACITY) return fail(soldOutMsg);

  const session = await stripeClient().checkout.sessions.create({
    mode: "payment",
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd", unit_amount: amount,
        product_data: { name: `Vice City — After Dark · ${g.ticket === "ladies" ? "Ladies" : "Guys"} · ${label} ticket`, description: "Fri, Nov 20 · 8PM–4AM · All sales final, no refunds" },
      },
    }],
    client_reference_id: g.id,
    metadata: { guest_id: g.id, instagram: g.instagram },
    success_url: `${SITE}/?t=${g.token}`,
    cancel_url: `${SITE}/?t=${g.token}`,
    expires_at: Math.floor(Date.now() / 1000) + HOLD_MIN * 60 + 60,
  });
  await db.from("guests").update({ stripe_session_id: session.id, checkout_started_at: new Date().toISOString(), amount_cents: amount }).eq("id", g.id);
  return json({ url: session.url });
}

// ---------- public: my ticket page ----------
async function ticketPage(url: URL) {
  const t = url.searchParams.get("t") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(t)) return fail("Ticket not found.", 404);
  const { data: g } = await db.from("guests").select("*").eq("token", t).maybeSingle();
  if (!g) return fail("Ticket not found.", 404);
  if (g.status === "pending" && g.stripe_session_id) {
    // don't wait for the webhook: ask Stripe directly
    const s = await Promise.resolve().then(() => stripeClient().checkout.sessions.retrieve(g.stripe_session_id)).catch(() => null);
    if (s?.payment_status === "paid") { await markPaid(g.id, s.id); g.status = "paid"; }
  }
  const { data: st } = await db.from("settings").select("*").eq("id", 1).single();
  return json({
    id: g.id, name: g.name, instagram: g.instagram, ticket: g.ticket, status: g.status, approval: g.approval,
    amount: g.status === "paid" ? g.amount_cents / 100 : (priceNow(genderOf(g)) ?? 0) / 100,
    paymentsOpen: !!st?.payments_open,
    photo: photoUrl(g.photo_path), // their own page always shows their own photo
    address: g.status === "paid" && st?.address_released ? st.address : null,
  });
}

// ---------- Stripe webhook ----------
async function webhook(req: Request) {
  const sig = req.headers.get("stripe-signature") ?? "";
  let event: Stripe.Event;
  try {
    event = await stripeClient().webhooks.constructEventAsync(await req.text(), sig, env("STRIPE_WEBHOOK_SECRET"));
  } catch { return fail("Bad signature.", 400); }
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const s = event.data.object as Stripe.Checkout.Session;
    if (s.payment_status === "paid" && s.client_reference_id) await markPaid(s.client_reference_id, s.id);
  }
  return json({ received: true });
}

// ---------- organizer area ----------
function samePassword(a: string, b: string) {
  if (!b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function admin(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (!samePassword(String(b.password ?? ""), env("ADMIN_PASSWORD"))) {
    await new Promise((r) => setTimeout(r, 800));
    return fail("Wrong password.", 401);
  }
  const id = String(b.id ?? "");
  if (b.op === "hide") await db.from("guests").update({ hidden: !!b.value }).eq("id", id);
  if (b.op === "checkin") await db.from("guests").update({ checked_in: !!b.value }).eq("id", id);
  if (b.op === "approve") await db.from("guests").update({ approval: "approved" }).eq("id", id);
  if (b.op === "decline") await db.from("guests").update({ approval: "declined" }).eq("id", id).neq("status", "paid");
  if (b.op === "payments") await db.from("settings").update({ payments_open: !!b.value }).eq("id", 1);
  if (b.op === "crews") await db.from("settings").update({ crews: cleanCrews(b.crews) }).eq("id", 1);
  if (b.op === "settings") {
    await db.from("settings").update({ address: String(b.address ?? "").slice(0, 200), address_released: !!b.released }).eq("id", 1);
  }
  const { data: guests } = await db.from("guests")
    .select("id,name,instagram,school,team,approval,gender,source,phone,referrer_name,referrer_school,ticket,amount_cents,status,hidden,checked_in,photo_path,show_photo,created_at,paid_at")
    .order("created_at", { ascending: false });
  const { data: settings } = await db.from("settings").select("*").eq("id", 1).single();
  return json({
    guests: (guests ?? []).map((g) => ({ ...g, photo: photoUrl(g.photo_path) })),
    settings, capacity: CAPACITY, holdSince: holdSince(),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  try {
    if (action === "wall" && req.method === "GET") return await wall();
    if (action === "apply" && req.method === "POST") return await apply(req);
    if (action === "pay" && req.method === "POST") return await pay(req);
    if (action === "ticket" && req.method === "GET") return await ticketPage(url);
    if (action === "webhook" && req.method === "POST") return await webhook(req);
    if (action === "admin" && req.method === "POST") return await admin(req);
    return fail("Not found.", 404);
  } catch (e) {
    console.error(e);
    return fail("Something went wrong. Try again.", 500);
  }
});
