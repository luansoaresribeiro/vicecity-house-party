-- Age is no longer stored (owner's decision, 2026-11-15).
alter table public.guests drop column if exists age;
