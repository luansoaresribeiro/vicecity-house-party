// Vice City — After Dark backend (one Supabase Edge Function, deployed with verify_jwt = false).
// Secrets (Supabase → Edge Functions → Secrets): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, ADMIN_PASSWORD, SITE_URL
import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const CAPACITY = 200;
const PRICES: Record<string, number> = { ladies: 2000, guys: 4000 }; // cents
const SALES_CLOSE = Date.parse("2026-11-18T23:59:59-05:00");
const HOLD_MIN = 30; // a pending checkout holds a spot for 30 min (Stripe's minimum session life)
const SCHOOLS = ["FIU", "St. Thomas", "Other"];

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

async function counts() {
  const paid = await db.from("guests").select("id", { count: "exact", head: true }).eq("status", "paid");
  const held = await db.from("guests").select("id", { count: "exact", head: true })
    .eq("status", "pending").gte("created_at", holdSince());
  return { going: paid.count ?? 0, held: held.count ?? 0 };
}

async function markPaid(guestId: string, sessionId: string) {
  await db.from("guests").update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", guestId).eq("stripe_session_id", sessionId).eq("status", "pending");
}

// ---------- public: guest wall ----------
async function wall() {
  const { data, error } = await db.from("guests")
    .select("id,name,instagram,photo_path,show_photo")
    .eq("status", "paid").eq("hidden", false).order("paid_at", { ascending: true });
  if (error) return fail("Couldn't load the guest list.", 500);
  const guests = data.map((g) => {
    const [first, last] = g.name.trim().split(/\s+/);
    return {
      id: g.id, instagram: g.instagram,
      name: last ? `${first} ${last[0]}.` : first, // never expose full last names publicly
      photo: g.show_photo ? photoUrl(g.photo_path) : null,
    };
  });
  return json({ guests, ...(await counts()), capacity: CAPACITY });
}

// ---------- public: start checkout ----------
async function checkout(req: Request) {
  if (Date.now() > SALES_CLOSE) return fail("Online sales are closed. Text or call 786-656-6926 to request a ticket.");
  if (!env("STRIPE_SECRET_KEY") || !SITE) return fail("Ticket sales open soon. 🌴", 503);
  const b = await req.json().catch(() => null);
  if (!b) return fail("Bad request.");
  const name = String(b.name ?? "").trim().replace(/\s+/g, " ");
  const instagram = String(b.instagram ?? "").trim().replace(/^@+/, "").toLowerCase();
  const school = String(b.school ?? "");
  const ticket = String(b.ticket ?? "");
  if (name.length < 2 || name.length > 60) return fail("Add your name.");
  if (!/^[a-z0-9._]{1,30}$/.test(instagram)) return fail("That Instagram handle doesn't look right.");
  if (!SCHOOLS.includes(school)) return fail("Pick your school.");
  if (!(ticket in PRICES)) return fail("Choose Ladies or Guys.");

  const dup = await db.from("guests").select("id", { count: "exact", head: true })
    .eq("instagram", instagram).eq("status", "paid");
  if ((dup.count ?? 0) > 0) return fail(`@${instagram} already has a ticket. 🌴`);

  const { going, held } = await counts();
  if (going + held >= CAPACITY) return fail("Sold out online 🔥 Text or call 786-656-6926 to request a ticket.");

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

  const { data: g, error } = await db.from("guests").insert({
    name, instagram, school, ticket, amount_cents: PRICES[ticket], photo_path, show_photo: b.showPhoto !== false,
  }).select("id,token").single();
  if (error || !g) return fail("Couldn't save your RSVP. Try again.", 500);

  const session = await stripeClient().checkout.sessions.create({
    mode: "payment",
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd", unit_amount: PRICES[ticket],
        product_data: { name: `Vice City — After Dark · ${ticket === "ladies" ? "Ladies" : "Guys"} ticket`, description: "Fri, Nov 20 · 8PM–4AM · All sales final, no refunds" },
      },
    }],
    client_reference_id: g.id,
    metadata: { guest_id: g.id, instagram },
    success_url: `${SITE}/?t=${g.token}`,
    cancel_url: `${SITE}/#tickets`,
    expires_at: Math.floor(Date.now() / 1000) + HOLD_MIN * 60 + 60,
  });
  await db.from("guests").update({ stripe_session_id: session.id }).eq("id", g.id);
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
    id: g.id, name: g.name, instagram: g.instagram, ticket: g.ticket, status: g.status,
    photo: g.show_photo ? photoUrl(g.photo_path) : null,
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
  if (b.op === "settings") {
    await db.from("settings").update({ address: String(b.address ?? "").slice(0, 200), address_released: !!b.released }).eq("id", 1);
  }
  const { data: guests } = await db.from("guests")
    .select("id,name,instagram,school,ticket,amount_cents,status,hidden,checked_in,photo_path,show_photo,created_at,paid_at")
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
    if (action === "checkout" && req.method === "POST") return await checkout(req);
    if (action === "ticket" && req.method === "GET") return await ticketPage(url);
    if (action === "webhook" && req.method === "POST") return await webhook(req);
    if (action === "admin" && req.method === "POST") return await admin(req);
    return fail("Not found.", 404);
  } catch (e) {
    console.error(e);
    return fail("Something went wrong. Try again.", 500);
  }
});
