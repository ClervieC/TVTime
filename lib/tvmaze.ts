import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE_URL = "https://api.tvmaze.com";
const CACHE_PREFIX = "tvmaze_cache:";
const ONE_HOUR = 60 * 60 * 1000;
const SIX_HOURS = 6 * ONE_HOUR;

const memoryCache = new Map<string, { data: unknown; expiresAt: number }>();

// Show metadata and episode lists rarely change and are identical for every user,
// so caching them (in-memory for the session, persisted to disk across restarts)
// avoids re-fetching the same show over and over as you move between screens
// (Shows list -> show detail -> episode detail all ask for the same data).
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
      // Expired, but kept around as a last-resort fallback below if TVmaze
      // turns out to be unreachable right now.
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
    // TVmaze is down/unreachable and retries were already exhausted (see
    // fetchWithRetry) — better to show slightly stale data than an error
    // screen, if we have anything at all to fall back on.
    if (stalePersisted !== undefined) return stalePersisted;
    const memoryStale = memoryCache.get(cacheKey);
    if (memoryStale) return memoryStale.data as T;
    throw err;
  }
}

export interface TVMazeShow {
  id: number;
  name: string;
  summary: string | null;
  status: string;
  premiered: string | null;
  ended: string | null;
  language: string | null;
  rating: { average: number | null };
  genres: string[];
  image: { medium: string; original: string } | null;
  network: { name: string; country: { name: string } | null } | null;
  webChannel: { name: string } | null;
  schedule: { time: string; days: string[] };
}

export interface TVMazeEpisode {
  id: number;
  name: string;
  season: number;
  number: number;
  airdate: string;
  airstamp: string;
  runtime: number | null;
  summary: string | null;
  image: { medium: string; original: string } | null;
}

export interface CastMember {
  person: {
    id: number;
    name: string;
    image: { medium: string; original: string } | null;
  };
  character: {
    id: number;
    name: string;
  };
}

export interface ScheduleEntry {
  id: number;
  airdate: string;
  airtime: string;
  season: number;
  number: number;
  name: string;
  show: TVMazeShow;
}

const MAX_RETRIES = 3;

// TVmaze rate-limits at ~20 calls/10s per IP, and being a free public API it
// occasionally has brief outages/5xx blips or the request just times out on
// a flaky connection. All of these are worth a couple of backed-off retries
// before we give up and (see withCache) fall back to whatever we last saw.
async function fetchWithRetry(path: string, retriesLeft = MAX_RETRIES): Promise<Response> {
  const attempt = MAX_RETRIES - retriesLeft;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`);
  } catch (err) {
    // Network failure (offline, DNS hiccup, connection reset, timeout...) —
    // fetch throws rather than resolving with a bad status in this case.
    if (retriesLeft <= 0) throw err;
    await sleep(backoffDelay(attempt));
    return fetchWithRetry(path, retriesLeft - 1);
  }

  if (res.status === 429 && retriesLeft > 0) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffDelay(attempt);
    await sleep(delay);
    return fetchWithRetry(path, retriesLeft - 1);
  }

  // 5xx means the TVmaze server itself is having trouble — also transient.
  if (res.status >= 500 && retriesLeft > 0) {
    await sleep(backoffDelay(attempt));
    return fetchWithRetry(path, retriesLeft - 1);
  }

  return res;
}

function backoffDelay(attempt: number) {
  return Math.min(1000 * 2 ** attempt, 8000);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function get<T>(path: string): Promise<T> {
  const res = await fetchWithRetry(path);
  if (!res.ok) {
    throw new Error(`TVmaze request failed (${res.status}): ${path}`);
  }
  return res.json() as Promise<T>;
}

export function searchShows(query: string) {
  return get<{ score: number; show: TVMazeShow }[]>(
    `/search/shows?q=${encodeURIComponent(query)}`
  );
}

export function getShow(id: number) {
  return withCache(`show:${id}`, SIX_HOURS, () => get<TVMazeShow>(`/shows/${id}`));
}

export function getShowEpisodes(id: number) {
  return withCache(`episodes:${id}`, ONE_HOUR, () => get<TVMazeEpisode[]>(`/shows/${id}/episodes`));
}

export function getShowCast(id: number) {
  return withCache(`cast:${id}`, SIX_HOURS, () => get<CastMember[]>(`/shows/${id}/cast`));
}

export function getTodaySchedule(countryCode = "US", date?: string) {
  const dateParam = date ? `&date=${date}` : "";
  return get<ScheduleEntry[]>(`/schedule?country=${countryCode}${dateParam}`);
}

export function getShowsIndex(page = 0) {
  return withCache(`index:${page}`, ONE_HOUR, () => get<TVMazeShow[]>(`/shows?page=${page}`));
}

// TVmaze's /shows index is ordered by internal ID, which roughly tracks when
// a show was added to their database — recently added/premiered shows sit at
// the very end, not the beginning. Sampling only the first N pages (as we
// used to) means "New releases" is essentially always empty. Finding the
// last page costs a handful of sequential requests, so the result is cached
// for a while and reused.
async function findLastShowsPageIndex(): Promise<number> {
  return withCache("index:lastPage", SIX_HOURS, async () => {
    async function pageLength(page: number) {
      try {
        return (await get<TVMazeShow[]>(`/shows?page=${page}`)).length;
      } catch {
        return 0;
      }
    }
    let lo = 0;
    let hi = 1;
    while ((await pageLength(hi)) > 0) {
      lo = hi;
      hi *= 2;
      if (hi > 5000) break;
    }
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if ((await pageLength(mid)) > 0) lo = mid;
      else hi = mid;
    }
    return lo;
  });
}

// Pulls a sample pool of shows spread evenly across the whole index — used to
// build genre/popularity/recency based Discover categories, since TVmaze has
// no server-side genre, "trending" or "newest" filter. Spreading across the
// full range (rather than just the first pages) is what lets recent premieres
// and less common languages show up at all. Each page is itself cached (see
// getShowsIndex), so repeat visits are fast.
export async function getShowsPool(pageCount: number) {
  const lastPage = await findLastShowsPageIndex();
  const pages =
    lastPage < pageCount
      ? Array.from({ length: lastPage + 1 }, (_, i) => i)
      : Array.from({ length: pageCount }, (_, i) =>
          Math.round((i * lastPage) / (pageCount - 1)),
        );
  const uniquePages = Array.from(new Set(pages));
  const results = await Promise.all(
    uniquePages.map((p) => getShowsIndex(p).catch(() => [])),
  );
  return results.flat();
}

export function getEpisode(id: number) {
  return get<TVMazeEpisode>(`/episodes/${id}`);
}

export function lookupShowByTvdbId(tvdbId: number): Promise<TVMazeShow | null> {
  return withCache(`tvdb:${tvdbId}`, SIX_HOURS, async () => {
    const res = await fetchWithRetry(`/lookup/shows?thetvdb=${tvdbId}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`TVmaze request failed (${res.status}): /lookup/shows?thetvdb=${tvdbId}`);
    }
    return res.json() as Promise<TVMazeShow>;
  });
}
