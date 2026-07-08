import { supabase, getCurrentUserId } from "./supabase";

export type MovieStatus = "want_to_watch" | "watched";

export interface UserMovie {
  id: string;
  user_id: string;
  tmdb_id: number | null;
  title: string;
  year: number | null;
  status: MovieStatus;
  is_favorite: boolean;
  rating: number | null;
  feeling: string | null;
  poster_path: string | null;
  watched_at: string | null;
  times_watched: number;
  created_at: string;
  updated_at: string;
}

// One round trip for Explore to know, per TMDB movie card, whether it's
// already on the list and/or favorited — mirrors how the shows side of
// Explore builds addedIds/favoriteIds from a single fetchUserShows() call.
// Explicitly scoped to the current user rather than relying solely on RLS
// (user_movies has no "viewable by authenticated users" policy the way
// user_shows does, so RLS already blocks this today — but every other read
// in this file filters by user_id explicitly too, and this one shouldn't be
// the exception a future RLS change quietly turns into a leak).
export async function fetchUserMovieTmdbMap(): Promise<Map<number, UserMovie>> {
  const userId = await getCurrentUserId();
  if (!userId) return new Map();

  const { data, error } = await supabase
    .from("user_movies")
    .select("*")
    .eq("user_id", userId)
    .not("tmdb_id", "is", null);
  if (error) throw error;
  const map = new Map<number, UserMovie>();
  for (const row of data as UserMovie[]) {
    if (row.tmdb_id) map.set(row.tmdb_id, row);
  }
  return map;
}

export async function fetchUserMovies() {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("user_movies")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "watched")
    .order("watched_at", { ascending: false });
  if (error) throw error;
  return data as UserMovie[];
}

export async function fetchMovieWatchlist() {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("user_movies")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "want_to_watch")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as UserMovie[];
}

export async function fetchFavoriteMovies() {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("user_movies")
    .select("*")
    .eq("user_id", userId)
    .eq("is_favorite", true)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data as UserMovie[];
}

export async function fetchUserMovie(id: string): Promise<UserMovie | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from("user_movies")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Looks up whichever row (watched or want_to_watch) this TMDB movie already
// has for the current user, if any — lets a card/detail screen know which
// state to render (add vs. already-on-list vs. already-watched) without the
// caller having to fetch the whole list first. tmdb_id isn't unique across
// users (each user who's added a given movie has their own row), so this
// must filter by user_id explicitly rather than tmdb_id alone.
// fallbackTitle/fallbackYear cover rows written before tmdb_id existed on
// this table (a TV Time import never sets it — see bulkUpsertUserMovies) or
// before this specific row was ever matched to a TMDB id: without this,
// looking up by tmdb_id alone would miss an existing watched row entirely,
// and the caller (thinking there's nothing here yet) would upsert a new
// 'want_to_watch' row on the same (user_id, title, year) conflict key,
// silently resetting the existing watched row's status/watched_at/times_watched.
export async function fetchUserMovieByTmdbId(
  tmdbId: number,
  fallbackTitle?: string,
  fallbackYear?: number | null
): Promise<UserMovie | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from("user_movies")
    .select("*")
    .eq("tmdb_id", tmdbId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;
  if (fallbackTitle === undefined) return null;

  let byTitleQuery = supabase.from("user_movies").select("*").eq("user_id", userId).eq("title", fallbackTitle);
  byTitleQuery = fallbackYear == null ? byTitleQuery.is("year", null) : byTitleQuery.eq("year", fallbackYear);
  const { data: byTitle, error: titleError } = await byTitleQuery.maybeSingle();
  if (titleError) throw titleError;
  return byTitle;
}

// Adds a movie to the personal "want to watch" list — from Explore's movie
// card or the TMDB detail screen, where all we have is the TMDB summary.
// posterPath, when the caller already has it (a TMDB search/detail result),
// is stored on the row so the Movies grid can render a poster directly later
// instead of every MovieCard re-searching TMDB by title+year on mount.
// Omitted (not just null) when the caller doesn't have it, so an upsert
// never clobbers an existing stored poster_path with null.
export async function addMovieToWatchlist(
  tmdbId: number,
  title: string,
  year: number | null,
  posterPath?: string | null
): Promise<UserMovie> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("user_movies")
    .upsert(
      {
        user_id: userId,
        tmdb_id: tmdbId,
        title,
        year,
        status: "want_to_watch",
        watched_at: null,
        times_watched: 0,
        ...(posterPath !== undefined ? { poster_path: posterPath } : {}),
      },
      { onConflict: "user_id,title,year" }
    )
    .select()
    .single();
  if (error) throw error;
  return data as UserMovie;
}

export async function removeUserMovie(id: string): Promise<void> {
  const { error } = await supabase.from("user_movies").delete().eq("id", id);
  if (error) throw error;
}

export async function setMovieFavorite(id: string, isFavorite: boolean): Promise<UserMovie> {
  const { data, error } = await supabase
    .from("user_movies")
    .update({ is_favorite: isFavorite })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as UserMovie;
}

// Mirrors rateEpisode's shape (lib/userShows.ts) — a movie only has one
// rating/feeling row (unlike episodes there's no per-episode id to key off
// of other than the user_movies row itself).
export async function rateMovie(id: string, rating: number | null, feeling: string | null): Promise<UserMovie> {
  const { data, error } = await supabase
    .from("user_movies")
    .update({ rating, feeling })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as UserMovie;
}

// Aggregate, anonymous count of how everyone who's watched this movie felt
// about it — mirrors fetchEpisodeFeelingCounts, keyed by tmdb_id since that's
// the only id shared across different users' rows for the same movie.
// Goes through the movie_feeling_counts() SECURITY DEFINER function (see
// supabase/schema.sql) rather than a raw select — user_movies' own RLS
// stays locked to "auth.uid() = user_id" for every column, so this is the
// only way to see the aggregate across other users' rows without opening
// the whole table up.
export async function fetchMovieFeelingCounts(tmdbId: number): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc("movie_feeling_counts", { p_tmdb_id: tmdbId });
  if (error) throw error;

  const counts: Record<string, number> = {};
  for (const row of data as { feeling: string; count: number }[]) {
    counts[row.feeling] = row.count;
  }
  return counts;
}

// Removes a movie from watched history (unwatch) or adds/marks it watched —
// mirrors setEpisodeWatched's delete-when-unwatching / upsert-when-watching
// shape. tmdbId is only needed the first time a title is marked watched
// (e.g. straight from Explore, skipping the watchlist); once a row exists,
// its stored tmdb_id carries over through the upsert's onConflict match.
export async function setMovieWatched(
  title: string,
  year: number | null,
  watched: boolean,
  tmdbId?: number,
  posterPath?: string | null
): Promise<UserMovie | null> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  if (!watched) {
    const { error } = await supabase
      .from("user_movies")
      .delete()
      .eq("user_id", userId)
      .eq("title", title)
      .eq("year", year);
    if (error) throw error;
    return null;
  }

  const { data, error } = await supabase
    .from("user_movies")
    .upsert(
      {
        user_id: userId,
        tmdb_id: tmdbId,
        title,
        year,
        status: "watched",
        watched_at: new Date().toISOString(),
        times_watched: 1,
        ...(posterPath !== undefined ? { poster_path: posterPath } : {}),
      },
      { onConflict: "user_id,title,year" }
    )
    .select()
    .single();
  if (error) throw error;
  return data as UserMovie;
}

export async function incrementMovieRewatch(id: string, currentTimesWatched: number): Promise<UserMovie> {
  const { data, error } = await supabase
    .from("user_movies")
    .update({ times_watched: currentTimesWatched + 1, watched_at: new Date().toISOString(), status: "watched" })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as UserMovie;
}

export async function bulkUpsertUserMovies(
  movies: { title: string; year: number | null; watchedAt: string; timesWatched: number }[]
) {
  if (movies.length === 0) return;
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const CHUNK_SIZE = 300;
  for (let i = 0; i < movies.length; i += CHUNK_SIZE) {
    const chunk = movies.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from("user_movies").upsert(
      chunk.map((m) => ({
        user_id: userId,
        title: m.title,
        year: m.year,
        status: "watched",
        watched_at: m.watchedAt,
        times_watched: m.timesWatched,
      })),
      { onConflict: "user_id,title,year" }
    );
    if (error) throw error;
  }
}
