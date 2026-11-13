-- Vice City — After Dark: guests, settings and the photo bucket.
-- All reads/writes go through the `party` Edge Function (service role).
-- RLS is on with no policies, so the public anon key can't read or write anything directly.

create table if not exists public.guests (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),   -- secret for the guest's ticket page
  name text not null check (char_length(name) between 2 and 60),
  instagram text not null check (instagram ~ '^[a-z0-9._]{1,30}$'),
  school text not null check (school in ('FIU','St. Thomas','Other')),
  ticket text not null check (ticket in ('ladies','guys')),
  amount_cents int not null,
  photo_path text,
  show_photo boolean not null default true,
  status text not null default 'pending' check (status in ('pending','paid')),
  hidden boolean not null default false,
  checked_in boolean not null default false,
  stripe_session_id text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists guests_status_idx on public.guests (status, created_at);
alter table public.guests enable row level security;

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  address text not null default '',
  address_released boolean not null default false
);
insert into public.settings (id) values (1) on conflict do nothing;
alter table public.settings enable row level security;

-- Public bucket: file names are random UUIDs, the wall only lists paid guests.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guest-photos', 'guest-photos', true, 1048576, array['image/jpeg'])
on conflict (id) do nothing;
