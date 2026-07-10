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

-- Superseded below — a plain "viewable by authenticated users" policy on
-- user_movies would let any authenticated client SELECT * on any user's row
-- directly (RLS gates rows, not which columns a query happens to ask for),
-- exposing rating/watched_at/times_watched/is_favorite, not just the
-- anonymous feeling this was added for. Run this drop if that policy was
-- already applied from a previous version of this file:
drop policy if exists "User movies are viewable by authenticated users" on public.user_movies;

-- Narrow replacement: a SECURITY DEFINER function that returns only the
-- aggregate feeling counts for a given movie, so user_movies itself stays
-- locked to "auth.uid() = user_id" for every column while still letting
-- fetchMovieFeelingCounts (lib/userMovies.ts) see everyone's feeling, not
-- just the current user's.
create or replace function public.movie_feeling_counts(p_tmdb_id integer)
returns table (feeling text, count bigint)
language sql
security definer
set search_path = public
as $$
  select feeling, count(*)
  from public.user_movies
  where tmdb_id = p_tmdb_id and feeling is not null
  group by feeling;
$$;

grant execute on function public.movie_feeling_counts(integer) to authenticated;

-- ============================================================
-- Admin flag + content/user reporting. Purely additive — safe to run once
-- against an existing database.
-- ============================================================

-- Set manually on your own row from the Supabase dashboard (Table Editor ->
-- profiles -> your row -> is_admin = true). No client code ever sets this —
-- see the RLS policies below, which don't grant users update access to it.
alter table public.profiles add column if not exists is_admin boolean not null default false;

create type report_target as enum ('user', 'comment', 'movie_comment', 'show', 'episode', 'movie');
create type report_status as enum ('open', 'resolved', 'dismissed');

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  target_type report_target not null,
  -- Exactly one of these is set, matching target_type: a uuid FK for
  -- user/comment/movie_comment targets (rows that exist in this database),
  -- or a plain external id for show/episode (TVmaze) and movie (TMDB),
  -- which have no local row to foreign-key to.
  target_user_id uuid references auth.users (id) on delete cascade,
  target_comment_id uuid references public.comments (id) on delete cascade,
  target_movie_comment_id uuid references public.movie_comments (id) on delete cascade,
  target_tvmaze_show_id integer,
  target_tvmaze_episode_id integer,
  target_tmdb_id integer,
  reason text not null check (char_length(trim(reason)) between 1 and 500),
  status report_status not null default 'open',
  -- Admin-only moderation note (why resolved/dismissed) — never shown to
  -- the reporter.
  resolution_note text,
  resolved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.reports enable row level security;

-- Reporters can file reports and see their own (so a future "my reports"
-- view could show status), but never anyone else's — a report often names
-- a specific person, which isn't something to expose broadly.
create policy "Users create their own reports"
  on public.reports
  for insert
  with check (auth.uid() = reporter_id);

create policy "Users view their own reports"
  on public.reports
  for select
  using (auth.uid() = reporter_id);

-- Admins see and act on every report. Checked directly against
-- profiles.is_admin — profiles is already readable by any authenticated
-- user (see "Profiles are viewable by authenticated users" above), so this
-- doesn't need a SECURITY DEFINER function to avoid an RLS deadlock.
create policy "Admins view all reports"
  on public.reports
  for select
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin));

create policy "Admins update reports"
  on public.reports
  for update
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin));

create index if not exists reports_status_idx on public.reports (status, created_at desc);
create index if not exists reports_reporter_idx on public.reports (reporter_id);

-- ============================================================
-- TMDB-only show bookmarks — for shows not yet indexed by TVmaze (this
-- app's real source for episode-level tracking; see comments throughout
-- lib/tvmaze.ts). Deliberately a separate table rather than widening
-- user_shows.tvmaze_id to nullable: nearly the whole app (Watch Next,
-- watched-episode tracking, the offline snapshot, comments/reports, ...)
-- assumes every tracked show has a real TVmaze id, and threading "maybe
-- null" through all of that for a genuinely rare case (a show TVmaze
-- doesn't have yet) would be a much bigger, riskier change than this
-- simple bookmark list — which auto-upgrades to a real tracked user_shows
-- row the moment TVmaze does pick the show up (see the resolve check in
-- app/show/tmdb/[id].tsx). Purely additive — safe to run once.
-- ============================================================
create table if not exists public.tmdb_only_shows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tmdb_id integer not null,
  title text not null,
  poster_path text,
  created_at timestamptz not null default now(),
  unique (user_id, tmdb_id)
);

alter table public.tmdb_only_shows enable row level security;

create policy "Users manage their own tmdb-only show bookmarks"
  on public.tmdb_only_shows
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- Show stats cache — the "watch time"/"episodes watched" detail page
-- (episodes/week, remaining episodes, genre breakdown) needs several TVmaze
-- calls per tracked show plus a full scan of watched_episodes, too slow to
-- redo on every visit. One row per user holding the last computed result as
-- JSON; the client repaints from this instantly and only recomputes (then
-- overwrites this row) when it's missing or older than the screen's own TTL.
-- Purely additive — safe to run once.
-- ============================================================
create table if not exists public.show_stats_cache (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null,
  computed_at timestamptz not null default now()
);

alter table public.show_stats_cache enable row level security;

create policy "Users manage their own show stats cache"
  on public.show_stats_cache
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- Favorite episodes — a heart toggle on an already-watched episode (see
-- episode/[id].tsx), listed in Profile the same way favorite shows/movies
-- already are. Just a column on watched_episodes rather than a separate
-- table: a favorite episode is inherently a watched one (nothing else has a
-- row here to attach it to), so this is a one-to-one flag on data that
-- already exists. Purely additive — safe to run once.
-- ============================================================
alter table public.watched_episodes
  add column if not exists is_favorite boolean not null default false;
