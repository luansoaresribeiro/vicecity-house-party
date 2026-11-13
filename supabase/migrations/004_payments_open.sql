-- List phase: payments stay closed until the organizer flips this in /admin.
alter table public.settings add column if not exists payments_open boolean not null default false;
