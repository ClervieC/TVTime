-- Run this in the Supabase SQL editor for your project.

create type show_status as enum ('watching', 'want_to_watch', 'watched', 'dropped', 'paused');

-- Run this instead if show_status already exists from a previous version of this schema:
-- alter type show_status add value if not exists 'paused';

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

-- Lets a user's shows/favorites be shown on their public profile page.
create policy "Shows are viewable by authenticated users"
  on public.user_shows
  for select
  using (auth.role() = 'authenticated');

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

-- Lets episode-watched counts (TV time, episodes watched) show up on a
-- user's public profile page, same spirit as the user_shows read policy above.
create policy "Watched episodes are viewable by authenticated users"
  on public.watched_episodes
  for select
  using (auth.role() = 'authenticated');

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

create table if not exists public.user_movies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  year integer,
  watched_at timestamptz not null default now(),
  times_watched integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, title, year)
);

alter table public.user_movies enable row level security;

create policy "Users manage their own movies"
  on public.user_movies
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger user_movies_set_updated_at
  before update on public.user_movies
  for each row
  execute function public.set_updated_at();

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  spoiler_mode boolean not null default false,
  language text not null default 'en' check (language in ('en', 'fr')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy "Users manage their own settings"
  on public.user_settings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row
  execute function public.set_updated_at();

-- Public-ish identity used for search/follow, separate from auth.users (which clients
-- can't query directly). Anyone authenticated can read profiles; only the owner can
-- create/edit theirs.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-zA-Z0-9_]{3,20}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by authenticated users"
  on public.profiles
  for select
  using (auth.role() = 'authenticated');

create policy "Users create their own profile"
  on public.profiles
  for insert
  with check (auth.uid() = user_id);

create policy "Users update their own profile"
  on public.profiles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- Following requires both sides to have a profile (i.e. a username), which is also
-- what makes them findable via search in the first place.
create table if not exists public.follows (
  follower_id uuid not null references public.profiles (user_id) on delete cascade,
  followed_id uuid not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);

alter table public.follows enable row level security;

create policy "Follows are viewable by authenticated users"
  on public.follows
  for select
  using (auth.role() = 'authenticated');

create policy "Users create their own follows"
  on public.follows
  for insert
  with check (auth.uid() = follower_id);

create policy "Users remove their own follows"
  on public.follows
  for delete
  using (auth.uid() = follower_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  type text not null,
  actor_id uuid references public.profiles (user_id) on delete set null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

create policy "Users see their own notifications"
  on public.notifications
  for select
  using (auth.uid() = user_id);

create policy "Users mark their own notifications read"
  on public.notifications
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- No insert policy for regular users: rows are only ever created by the trigger below,
-- which runs as the function owner and bypasses RLS. A follower's session can't insert
-- into someone else's notifications directly (auth.uid() would never match user_id).
create or replace function public.notify_on_follow()
returns trigger as $$
begin
  insert into public.notifications (user_id, type, actor_id)
  values (new.followed_id, 'follow', new.follower_id);
  return new;
end;
$$ language plpgsql security definer;

create trigger follows_notify
  after insert on public.follows
  for each row
  execute function public.notify_on_follow();

-- Comments on a show (target_type='show') or a specific episode
-- (target_type='episode', tvmaze_episode_id set). Episode comments always
-- carry the show id too, alongside the episode id, so a client can query/
-- delete by show without a join. Same read-everyone/write-your-own shape as
-- user_shows/watched_episodes above; the client is responsible for hiding
-- episode comments behind spoiler mode until the episode is watched, the same
-- way it already gates watched-episode data.
create type comment_target as enum ('show', 'episode');

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  target_type comment_target not null,
  tvmaze_show_id integer not null,
  tvmaze_episode_id integer,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  check (target_type = 'episode' or tvmaze_episode_id is null),
  check (target_type = 'show' or tvmaze_episode_id is not null)
);

alter table public.comments enable row level security;

create policy "Users manage their own comments"
  on public.comments
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Comments are viewable by authenticated users"
  on public.comments
  for select
  using (auth.role() = 'authenticated');

create index if not exists comments_show_idx
  on public.comments (tvmaze_show_id, target_type, created_at);
create index if not exists comments_episode_idx
  on public.comments (tvmaze_episode_id)
  where tvmaze_episode_id is not null;

-- One reaction (heart) per user per comment — toggled on/off, not a pick from
-- multiple reaction types.
create table if not exists public.comment_reactions (
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.comment_reactions enable row level security;

create policy "Users manage their own comment reactions"
  on public.comment_reactions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Comment reactions are viewable by authenticated users"
  on public.comment_reactions
  for select
  using (auth.role() = 'authenticated');

-- One active "favorite character of this episode" vote per user per episode —
-- voting again just replaces it (upsert on the primary key). Character/person
-- name and image are denormalized at vote time so the tally stays renderable
-- even if a later cast fetch drops or reorders that person.
create table if not exists public.character_votes (
  user_id uuid not null references auth.users (id) on delete cascade,
  tvmaze_show_id integer not null,
  tvmaze_episode_id integer not null,
  person_id integer not null,
  person_name text not null,
  person_image text,
  character_id integer not null,
  character_name text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, tvmaze_episode_id)
);

alter table public.character_votes enable row level security;

create policy "Users manage their own character votes"
  on public.character_votes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Character votes are viewable by authenticated users"
  on public.character_votes
  for select
  using (auth.role() = 'authenticated');

create index if not exists character_votes_episode_idx
  on public.character_votes (tvmaze_episode_id);

-- ============================================================
-- Movie features: personal watchlist status, favorites, ratings/
-- feelings, comments, and a stable TMDB id for matching.
-- Run this block against an existing database — it's purely additive
-- (new columns with defaults, new tables), so it's safe to run once.
-- ============================================================

-- tmdb_id is nullable: rows imported from a TV Time export never had one,
-- only movies added going forward (from Explore or the detail screen) do.
-- watched_at loses its NOT NULL/default because a 'want_to_watch' row has no
-- watch date yet — it's only set when the movie is actually marked watched.
alter table public.user_movies add column if not exists tmdb_id integer;
alter table public.user_movies add column if not exists status text not null default 'watched' check (status in ('want_to_watch', 'watched'));
alter table public.user_movies add column if not exists is_favorite boolean not null default false;
alter table public.user_movies add column if not exists rating smallint check (rating between 1 and 5);
alter table public.user_movies add column if not exists feeling text;
alter table public.user_movies alter column watched_at drop not null;
alter table public.user_movies alter column watched_at drop default;

create index if not exists user_movies_status_idx on public.user_movies (user_id, status);

-- Movie comments — same read-everyone/write-your-own shape as `comments`,
-- kept as a separate table (rather than extending `comments`) since movies
-- have no tvmaze id to key off of and altering that table's existing check
-- constraints/enum in place is riskier than an additive new table.
create table if not exists public.movie_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tmdb_id integer not null,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.movie_comments enable row level security;

create policy "Users manage their own movie comments"
  on public.movie_comments
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Movie comments are viewable by authenticated users"
  on public.movie_comments
  for select
  using (auth.role() = 'authenticated');

create index if not exists movie_comments_tmdb_idx
  on public.movie_comments (tmdb_id, created_at);

create table if not exists public.movie_comment_reactions (
  comment_id uuid not null references public.movie_comments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.movie_comment_reactions enable row level security;

create policy "Users manage their own movie comment reactions"
  on public.movie_comment_reactions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Movie comment reactions are viewable by authenticated users"
  on public.movie_comment_reactions
  for select
  using (auth.role() = 'authenticated');

-- ============================================================
-- Performance indexes for query patterns that were previously relying on
-- RLS's `user_id = auth.uid()` predicate alone (or a composite index whose
-- leading column doesn't match the actual filter) and falling back to a
-- full scan + sort. Purely additive — safe to run once against an existing
-- database.
-- ============================================================

-- fetchNotifications (order by created_at) and fetchUnreadNotificationCount
-- (filter on read = false) both run on every Profile tab visit and every
-- tab-bar focus.
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (user_id)
  where not read;

-- fetchWatchedEpisodesPage (Watch List's lazy-loaded History section) sorts
-- by watched_at, which watched_episodes_show_idx doesn't cover.
create index if not exists watched_episodes_watched_at_idx
  on public.watched_episodes (user_id, watched_at desc);

-- rateEpisode/fetchEpisodeFeelingCounts/incrementRewatch filter solely on
-- tvmaze_episode_id (no user_id/show_id predicate) — run on every episode
-- detail view and every rewatch tap.
create index if not exists watched_episodes_episode_idx
  on public.watched_episodes (tvmaze_episode_id);

-- fetchFollowerIds and the "followers" half of fetchFollowCounts filter on
-- followed_id alone, which the (follower_id, followed_id) primary key can't
-- serve efficiently since followed_id isn't its leading column.
create index if not exists follows_followed_idx
  on public.follows (followed_id);

-- fetchEpisodeComments orders by created_at after filtering on
-- tvmaze_episode_id — comments_episode_idx only covered the filter, not the
-- sort. Superseded by the composite index below (safe to drop
-- comments_episode_idx if you want, it's now redundant).
create index if not exists comments_episode_created_idx
  on public.comments (tvmaze_episode_id, created_at)
  where tvmaze_episode_id is not null;

-- Stores each movie's TMDB poster path at write time (add-to-watchlist or
-- mark-watched), so the Movies grid can render a poster directly instead of
-- every MovieCard independently re-searching TMDB by title+year on mount —
-- a real per-card network/cache lookup across a grid of hundreds of movies.
-- Rows written before this existed simply have poster_path null; MovieCard
-- still falls back to the title+year search for those.
alter table public.user_movies add column if not exists poster_path text;

-- user_movies only had "Users manage their own movies" (for all, scoped to
-- auth.uid() = user_id) — unlike watched_episodes, there was no broader
-- read policy, so fetchMovieFeelingCounts (the "how others felt" aggregate
-- on a movie's detail page) could only ever see the current user's own
-- feeling, never anyone else's. This mirrors watched_episodes' equivalent
-- policy: every app-level read of user_movies already filters explicitly by
-- user_id in code (see lib/userMovies.ts) except the intentionally
-- cross-user aggregate queries (which only ever select the anonymous
-- `feeling` column, never user_id/rating/watch history), so broadening this
-- to all authenticated users is safe.
create policy "User movies are viewable by authenticated users"
  on public.user_movies
  for select
  using (auth.role() = 'authenticated');
