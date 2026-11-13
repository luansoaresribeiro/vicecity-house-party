-- Phone + gender on the application (gender sets the price), and the organizer-managed list of crews.
alter table public.guests add column if not exists phone text;
alter table public.guests add column if not exists gender text check (gender in ('female','male'));
alter table public.settings add column if not exists crews jsonb not null default '[]'::jsonb;
