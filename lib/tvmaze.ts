import AsyncStorage from "@react-native-async-storage/async-storage";
import { mapWithConcurrency } from "./concurrency";

const BASE_URL = "https://api.tvmaze.com";
const CACHE_PREFIX = "tvmaze_cache:";
const ONE_HOUR = 60 * 60 * 1000;
const SIX_HOURS = 6 * ONE_HOUR;
const ONE_DAY = 24 * ONE_HOUR;

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

// Keeps bulk pool/show fetches comfortably under TVmaze's ~20 req/10s rate
// limit even when the list of pages/shows to fetch is much larger than that.
const POOL_FETCH_CONCURRENCY = 6;

// Global pacing gate for actual network dispatch, shared by every caller
// regardless of how many concurrent workers (mapWithConcurrency lanes, Promise.all,
// etc.) are calling in. Per-caller concurrency limits alone don't cap the
// aggregate request rate — e.g. 4 import lanes each pacing themselves
// independently can still multiply into a rate well past TVmaze's ~20 req/10s
// ceiling. This is a sliding-window limiter rather than a fixed interval: it
// lets a burst (e.g. loading 15 tracked shows' episodes at once on a cold
// cache) fire close to immediately, as long as the aggregate rate over the
// last 10s stays under the cap — a fixed "one request every 550ms" gate was
// correct on average but made every cold-cache batch load several times
// slower than it needed to be.
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_PER_WINDOW = 15; // margin under TVmaze's ~20 req/10s
const requestTimestamps: number[] = [];

// Two FIFO lanes sharing the same rate budget, not two separate budgets —
// "high" always drains first. Without this, an interactive action (typing
// into Explore's search box) waited behind every low-priority background
// batch already queued (Watch List loading 200+ tracked shows' episodes,
// Explore's own per-show genre-bias pass) — on a large account that's
// several *minutes* of silence before a search visibly does anything, even
// though the search itself only needs one quick request.
export type Priority = "high" | "low";
const highQueue: (() => void)[] = [];
const lowQueue: (() => void)[] = [];
let pumping = false;

async function pump() {
  if (pumping) return;
  pumping = true;
  while (highQueue.length > 0 || lowQueue.length > 0) {
    const now = Date.now();
    while (requestTimestamps.length > 0 && now - requestTimestamps[0] >= RATE_LIMIT_WINDOW_MS) {
      requestTimestamps.shift();
    }
    if (requestTimestamps.length < RATE_LIMIT_MAX_PER_WINDOW) {
      requestTimestamps.push(Date.now());
      const next = highQueue.shift() ?? lowQueue.shift();
      next?.();
      continue;
    }
    await sleep(RATE_LIMIT_WINDOW_MS - (Date.now() - requestTimestamps[0]) + 10);
  }
  pumping = false;
}

function throttle(priority: Priority = "low"): Promise<void> {
  return new Promise((resolve) => {
    (priority === "high" ? highQueue : lowQueue).push(resolve);
    pump();
  });
}

// TVmaze rate-limits at ~20 calls/10s per IP, and being a free public API it
// occasionally has brief outages/5xx blips or the request just times out on
// a flaky connection. All of these are worth a couple of backed-off retries
// before we give up and (see withCache) fall back to whatever we last saw.
async function fetchWithRetry(path: string, priority: Priority = "low", retriesLeft = MAX_RETRIES): Promise<Response> {
  const attempt = MAX_RETRIES - retriesLeft;
  await throttle(priority);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`);
  } catch (err) {
    // Network failure (offline, DNS hiccup, connection reset, timeout...) —
    // fetch throws rather than resolving with a bad status in this case.
    if (retriesLeft <= 0) throw err;
    await sleep(backoffDelay(attempt));
    return fetchWithRetry(path, priority, retriesLeft - 1);
  }

  if (res.status === 429 && retriesLeft > 0) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffDelay(attempt);
    await sleep(delay);
    return fetchWithRetry(path, priority, retriesLeft - 1);
  }

  // 5xx means the TVmaze server itself is having trouble — also transient.
  if (res.status >= 500 && retriesLeft > 0) {
    await sleep(backoffDelay(attempt));
    return fetchWithRetry(path, priority, retriesLeft - 1);
  }

  return res;
}

function backoffDelay(attempt: number) {
  return Math.min(1000 * 2 ** attempt, 8000);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function get<T>(path: string, priority: Priority = "low"): Promise<T> {
  const res = await fetchWithRetry(path, priority);
  if (!res.ok) {
    throw new Error(`TVmaze request failed (${res.status}): ${path}`);
  }
  return res.json() as Promise<T>;
}

// High priority: typed interactively into Explore's search box, so it should
// jump ahead of whatever background bulk fetches (Watch List, genre-bias
// pass) are already queued rather than wait behind them.
export function searchShows(query: string) {
  return get<{ score: number; show: TVMazeShow }[]>(
    `/search/shows?q=${encodeURIComponent(query)}`,
    "high"
  );
}

export function getShow(id: number) {
  return withCache(`show:${id}`, ONE_DAY, () => get<TVMazeShow>(`/shows/${id}`));
}

export function getShowEpisodes(id: number) {
  return withCache(`episodes:${id}`, SIX_HOURS, () => get<TVMazeEpisode[]>(`/shows/${id}/episodes`));
}

export function getShowCast(id: number) {
  return withCache(`cast:${id}`, ONE_DAY, () => get<CastMember[]>(`/shows/${id}/cast`));
}

export function getTodaySchedule(countryCode = "US", date?: string) {
  const dateParam = date ? `&date=${date}` : "";
  return get<ScheduleEntry[]>(`/schedule?country=${countryCode}${dateParam}`);
}

export function getShowsIndex(page = 0) {
  return withCache(`index:${page}`, ONE_DAY, () => get<TVMazeShow[]>(`/shows?page=${page}`));
}

// TVmaze's /shows index is ordered by internal ID, which roughly tracks when
// a show was added to their database — recently added/premiered shows sit at
// the very end, not the beginning. Sampling only the first N pages (as we
// used to) means "New releases" is essentially always empty. Finding the
// last page costs a handful of sequential requests, so the result is cached
// for a while and reused.
async function findLastShowsPageIndex(): Promise<number> {
  return withCache("index:lastPage", ONE_DAY, async () => {
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
    lastPage < pageCount || pageCount <= 1
      ? Array.from({ length: Math.min(lastPage, pageCount - 1) + 1 }, (_, i) => i)
      : Array.from({ length: pageCount }, (_, i) =>
          Math.round((i * lastPage) / (pageCount - 1)),
        );
  const uniquePages = Array.from(new Set(pages));
  const results = await mapWithConcurrency(uniquePages, POOL_FETCH_CONCURRENCY, (p) =>
    getShowsIndex(p).catch(() => []),
  );
  return results.flat();
}

export function getEpisode(id: number) {
  return get<TVMazeEpisode>(`/episodes/${id}`);
}

// Defaults to low priority since the biggest caller (lib/tvtimeImport.ts)
// is a bulk background match over potentially hundreds of shows — but
// lib/tmdb.ts's findTvmazeShowFromTmdbTv passes "high" explicitly, since
// that path is a direct interactive tap in Explore and should jump ahead of
// queued background work the same way searchShows already does.
export function lookupShowByTvdbId(tvdbId: number, priority: Priority = "low"): Promise<TVMazeShow | null> {
  return withCache(`tvdb:${tvdbId}`, SIX_HOURS, async () => {
    const res = await fetchWithRetry(`/lookup/shows?thetvdb=${tvdbId}`, priority);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`TVmaze request failed (${res.status}): /lookup/shows?thetvdb=${tvdbId}`);
    }
    return res.json() as Promise<TVMazeShow>;
  });
}
