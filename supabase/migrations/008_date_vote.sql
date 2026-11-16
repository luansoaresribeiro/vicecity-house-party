-- The date isn't fixed yet: guests vote for the best date among options the organizer sets in /admin.
alter table public.settings add column if not exists date_options jsonb not null default '[]'::jsonb;
create table if not exists public.date_votes (
  voter text primary key check (char_length(voter) between 8 and 64), -- random id kept in the voter's browser (one vote per device)
  option text not null check (char_length(option) between 1 and 60),
  updated_at timestamptz not null default now()
);
alter table public.date_votes enable row level security;
