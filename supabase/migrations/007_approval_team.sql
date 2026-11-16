-- Invite-only: every new request waits for the organizer's approval; everyone already on the list was approved.
-- Team / sport of each guest (to confirm the "core" teams and track the mix).
alter table public.guests add column if not exists team text check (team is null or char_length(team) <= 40);
alter table public.guests add column if not exists approval text not null default 'pending' check (approval in ('pending','approved','declined'));
update public.guests set approval = 'approved' where approval = 'pending';
