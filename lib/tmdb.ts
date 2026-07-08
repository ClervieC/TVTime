import AsyncStorage from "@react-native-async-storage/async-storage";
import { lookupShowByTvdbId, TVMazeShow, Priority } from "./tvmaze";

const BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p";
const API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY;
const CACHE_PREFIX = "tmdb_cache:";
const ONE_DAY = 24 * 60 * 60 * 1000;

const memoryCache = new Map<string, { data: unknown; expiresAt: number }>();

// Same shape as lib/tvmaze.ts's withCache: in-memory for the session,
// persisted to disk across restarts, and falls back to stale data on a
// failed fetch rather than showing an error. Movie metadata never changes
// once published, so a day-long TTL is more than safe.
async function withCache<T>(cacheKey: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const cached = memoryCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.data as T;

  const storageKey = CACHE_PREFIX + cacheKey;
  let stalePersisted: T | undefined;
  try {
    const stored = await AsyncStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored) as { data: T; expiresAt: number };
      if (parsed.expiresAt > now) {
        memoryCache.set(cacheKey, parsed);
        return parsed.data;
      }
      stalePersisted = parsed.data;
    }
  } catch {
    // Corrupt/unavailable cache entry — fall through and refetch.
  }

  try {
    const data = await fetcher();
    const entry = { data, expiresAt: now + ttlMs };
    memoryCache.set(cacheKey, entry);
    AsyncStorage.setItem(storageKey, JSON.stringify(entry)).catch(() => {});
    return data;
  } catch (err) {
    if (stalePersisted !== undefined) return stalePersisted;
    const memoryStale = memoryCache.get(cacheKey);
    if (memoryStale) return memoryStale.data as T;
    throw err;
  }
}

export interface TMDBSearchResult {
  id: number;
  title: string;
  release_date: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string;
  vote_average: number;
}

export interface TMDBMovieDetails extends TMDBSearchResult {
  runtime: number | null;
  genres: { id: number; name: string }[];
  tagline: string;
}

export interface TMDBCastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
}

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!API_KEY) throw new Error("EXPO_PUBLIC_TMDB_API_KEY is not set");
  const query = new URLSearchParams({ api_key: API_KEY, ...params }).toString();
  const res = await fetch(`${BASE_URL}${path}?${query}`);
  if (!res.ok) {
    throw new Error(`TMDB request failed (${res.status}): ${path}`);
  }
  return res.json() as Promise<T>;
}

export function posterUrl(path: string | null, size: "w200" | "w342" | "w500" = "w342") {
  return path ? `${IMAGE_BASE_URL}/${size}${path}` : null;
}

export function backdropUrl(path: string | null, size: "w780" | "w1280" = "w1280") {
  return path ? `${IMAGE_BASE_URL}/${size}${path}` : null;
}

// The app only ever has a title (+ optional year) for a watched movie — TV
// Time's export has no TMDB id — so every lookup is a title search rather
// than a direct id fetch. Cached per title+year since the same movie is
// looked up again every time its detail page (or another with the same
// title) is opened.
export function searchMovie(title: string, year: number | null): Promise<TMDBSearchResult | null> {
  return withCache(`search:${title}::${year ?? ""}`, ONE_DAY, async () => {
    const params: Record<string, string> = { query: title };
    if (year) params.year = String(year);
    const data = await get<{ results: TMDBSearchResult[] }>("/search/movie", params);
    if (data.results.length === 0) return null;
    // Prefer an exact release-year match when the search returns several
    // (remakes, sequels sharing a title, etc.) — otherwise take the top hit,
    // which TMDB already ranks by relevance/popularity.
    if (year) {
      const exact = data.results.find((r) => r.release_date?.startsWith(String(year)));
      if (exact) return exact;
    }
    return data.results[0];
  });
}

export function getMovieDetails(tmdbId: number): Promise<TMDBMovieDetails> {
  return withCache(`movie:${tmdbId}`, ONE_DAY, () => get<TMDBMovieDetails>(`/movie/${tmdbId}`));
}

export function getMovieCast(tmdbId: number): Promise<TMDBCastMember[]> {
  return withCache(`credits:${tmdbId}`, ONE_DAY, () =>
    get<{ cast: TMDBCastMember[] }>(`/movie/${tmdbId}/credits`).then((d) =>
      [...d.cast].sort((a, b) => a.order - b.order)
    )
  );
}

export function profileUrl(path: string | null, size: "w185" = "w185") {
  return path ? `${IMAGE_BASE_URL}/${size}${path}` : null;
}

// Multi-result search (for the Explore "search everything" box) — distinct
// from searchMovie above, which picks the single best match for a known
// watched title. Cached per query since the same text is often retyped.
export function searchMovies(query: string): Promise<TMDBSearchResult[]> {
  return withCache(`searchAll:${query}`, ONE_DAY, () =>
    get<{ results: TMDBSearchResult[] }>("/search/movie", { query }).then((d) => d.results)
  );
}

function cachedMovieList(path: string) {
  return () => withCache(`list:${path}`, ONE_DAY, () => get<{ results: TMDBSearchResult[] }>(path).then((d) => d.results));
}

export const getPopularMovies = cachedMovieList("/movie/popular");
export const getTopRatedMovies = cachedMovieList("/movie/top_rated");
export const getNowPlayingMovies = cachedMovieList("/movie/now_playing");
export const getUpcomingMovies = cachedMovieList("/movie/upcoming");

// TVmaze and TMDB use entirely different internal ids for the same show, but
// both link out to the same third-party TheTVDB id — TMDB exposes it via
// /tv/{id}/external_ids, and TVmaze already has a lookup-by-tvdb-id endpoint
// (lib/tvmaze.ts's lookupShowByTvdbId, used elsewhere for TV Time imports).
// Chaining the two is what lets a TMDB-sourced show result resolve to the
// TVmaze id the rest of this app is built around (tracking, episodes, ...).
// Not every TMDB show has a tvdb_id on file, so this can legitimately
// return null — callers should treat that as "no match found", not an error.
interface TMDBTvExternalIds {
  tvdb_id: number | null;
  imdb_id: string | null;
}

function getTvExternalIds(tmdbTvId: number): Promise<TMDBTvExternalIds> {
  return withCache(`tv-external:${tmdbTvId}`, ONE_DAY, () => get<TMDBTvExternalIds>(`/tv/${tmdbTvId}/external_ids`));
}

// Defaults to "high" for the interactive case (a direct tap in Explore that
// should jump the TVmaze queue) — Explore's background prefetch of every
// visible discover-category card (see explore.tsx) passes "low" explicitly,
// so a bulk pass over 40-80 cards never delays an actual interactive request.
export async function findTvmazeShowFromTmdbTv(
  tmdbTvId: number,
  priority: Priority = "high"
): Promise<TVMazeShow | null> {
  const external = await getTvExternalIds(tmdbTvId);
  if (!external.tvdb_id) return null;
  return lookupShowByTvdbId(external.tvdb_id, priority);
}

export interface TMDBTvResult {
  id: number;
  name: string;
  first_air_date: string;
  poster_path: string | null;
  vote_average: number;
}

function cachedTvList(path: string, params: Record<string, string> = {}) {
  return () =>
    withCache(`tvlist:${path}:${JSON.stringify(params)}`, ONE_DAY, () =>
      get<{ results: TMDBTvResult[] }>(path, params).then((d) => d.results)
    );
}

// Same 4-category shape as the movie side (Popular/Top Rated/Now
// Playing/Upcoming) — TV's closest equivalents to "in theaters" and
// "upcoming" are "on the air" (currently airing new episodes) and a
// discover query for shows premiering from today onward, since TMDB has no
// dedicated /tv/upcoming endpoint the way it does for movies.
export const getPopularTv = cachedTvList("/tv/popular");
export const getTopRatedTv = cachedTvList("/tv/top_rated");
export const getOnTheAirTv = cachedTvList("/tv/on_the_air");
export function getUpcomingTv() {
  const today = new Date().toISOString().slice(0, 10);
  return cachedTvList("/discover/tv", {
    "first_air_date.gte": today,
    sort_by: "popularity.desc",
  })();
}
