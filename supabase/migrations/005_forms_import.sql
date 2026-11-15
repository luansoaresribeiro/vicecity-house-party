-- People imported from the Google Forms list have no Instagram, may have an age, and are tagged by source.
alter table public.guests alter column instagram drop not null;
alter table public.guests drop constraint if exists guests_instagram_check;
alter table public.guests add constraint guests_instagram_check check (instagram is null or instagram ~ '^[a-z0-9._]{1,30}$');
alter table public.guests add column if not exists age int check (age between 13 and 99);
alter table public.guests add column if not exists source text not null default 'site' check (source in ('site','google_forms'));
