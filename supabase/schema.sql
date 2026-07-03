-- Run this in the Supabase SQL editor for your project.

create type show_status as enum ('watching', 'want_to_watch', 'watched', 'dropped');

create table if not exists public.user_shows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tvmaze_id integer not null,
  show_name text not null,
  show_image text,
  status show_status not null default 'want_to_watch',
  is_favorite boolean not null default false,
  rating smallint check (rating between 1 and 10),
  current_season integer,
  current_episode integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, tvmaze_id)
);

-- Run this if user_shows already exists from a previous version of this schema:
-- alter table public.user_shows add column if not exists is_favorite boolean not null default false;

alter table public.user_shows enable row level security;

create policy "Users manage their own shows"
  on public.user_shows
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger user_shows_set_updated_at
  before update on public.user_shows
  for each row
  execute function public.set_updated_at();

create table if not exists public.watched_episodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tvmaze_show_id integer not null,
  tvmaze_episode_id integer not null,
  season integer not null,
  number integer not null,
  watched boolean not null default true,
  watched_at timestamptz not null default now(),
  rating smallint check (rating between 1 and 5),
  feeling text,
  times_watched integer not null default 1,
  unique (user_id, tvmaze_episode_id)
);

-- Run this if watched_episodes already exists from a previous version of this schema:
-- alter table public.watched_episodes add column if not exists times_watched integer not null default 1;

alter table public.watched_episodes enable row level security;

create policy "Users manage their own watched episodes"
  on public.watched_episodes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists watched_episodes_show_idx
  on public.watched_episodes (user_id, tvmaze_show_id);

create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.lists enable row level security;

create policy "Users manage their own lists"
  on public.lists
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  tvmaze_id integer not null,
  show_name text not null,
  show_image text,
  created_at timestamptz not null default now(),
  unique (list_id, tvmaze_id)
);

alter table public.list_items enable row level security;

create policy "Users manage their own list items"
  on public.list_items
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
