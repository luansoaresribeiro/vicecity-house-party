-- Apply first, pay later: a spot is only held for 30 min after the guest opens checkout.
alter table public.guests add column if not exists checkout_started_at timestamptz;
create index if not exists guests_checkout_idx on public.guests (status, checkout_started_at);
