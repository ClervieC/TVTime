import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TVMazeEpisode, TVMazeShow } from "./tvmaze";
import type { WatchedEpisode } from "./userShows";

const STORAGE_PREFIX = "show_data_cache:";

// Generic cache-aside helper, persisted to disk (not just in-memory) so a
// cold app start doesn't have to re-fetch every tracked show's episodes and
// watched status from scratch before the Watch List/show detail can render —
// that network round-trip, repeated for every followed show, was the main
// reason those screens were slow to load. Correctness comes from the
// explicit invalidate() calls on every mutation (see lib/userShows.ts), not
// from a short TTL, so these can all be long-lived.
function createCache<T>(name: string, ttlMs: number) {
  const map = new Map<number, { data: T; fetchedAt: number }>();
  // Bumped by invalidate() so a fetch already in flight when the
  // invalidation lands doesn't overwrite it with the pre-mutation data it
  // resolves with — without this, a slow fetchWatchedEpisodes racing a
  // "mark watched" mutation could resurrect stale state for the full TTL.
  const invalidatedAt = new Map<number, number>();
  // Dedupes concurrent getOrFetch calls for the same id (e.g. Watch List
  // and a show's detail screen open at once) onto a single in-flight fetch.
  const inFlight = new Map<number, Promise<T>>();

  function storageKey(id: number) {
    return `${STORAGE_PREFIX}${name}:${id}`;
  }

  function get(id: number): T | null {
    const entry = map.get(id);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > ttlMs) {
      map.delete(id);
      return null;
    }
    return entry.data;
  }

  function set(id: number, data: T) {
    const entry = { data, fetchedAt: Date.now() };
    map.set(id, entry);
    AsyncStorage.setItem(storageKey(id), JSON.stringify(entry)).catch(() => {});
  }

  function invalidate(id: number) {
    invalidatedAt.set(id, Date.now());
    map.delete(id);
    AsyncStorage.removeItem(storageKey(id)).catch(() => {});
  }

  async function getOrFetch(id: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = get(id);
    if (cached) return cached;

    const existing = inFlight.get(id);
    if (existing) return existing;

    const startedAt = Date.now();
    const promise = (async () => {
      let stalePersisted: T | undefined;
      try {
        const stored = await AsyncStorage.getItem(storageKey(id));
        if (stored) {
          const parsed = JSON.parse(stored) as { data: T; fetchedAt: number };
          if (Date.now() - parsed.fetchedAt <= ttlMs) {
            map.set(id, parsed);
            return parsed.data;
          }
          // Expired, but kept around as a last-resort fallback below if the
          // fetch fails outright.
          stalePersisted = parsed.data;
        }
      } catch {
        // Corrupt/unavailable entry — fall through and refetch.
      }

      try {
        const data = await fetcher();
        // A concurrent invalidate() that landed after this fetch started
        // means the data we just fetched is already stale — don't write it.
        if ((invalidatedAt.get(id) ?? 0) < startedAt) set(id, data);
        return data;
      } catch (err) {
        // Network blip — better to show stale data than an error screen.
        if (stalePersisted !== undefined) return stalePersisted;
        const memoryStale = map.get(id);
        if (memoryStale) return memoryStale.data;
        throw err;
      }
    })();

    inFlight.set(id, promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(id);
    }
  }

  return { get, set, invalidate, getOrFetch };
}

// Show metadata and episode lists are effectively static day-to-day, and
// lib/tvmaze.ts already persists them independently too — this layer's main
// job is skipping even that disk read on repeat calls within the same
// session (show list -> show detail -> episode detail all want the same
// data). Watched status is Supabase data with no persistence anywhere else,
// so this is the only cache standing between "open Watch List" and one
// network round-trip per followed show.
const SHOW_INFO_TTL = 24 * 60 * 60 * 1000;
const EPISODES_TTL = 6 * 60 * 60 * 1000;
const WATCHED_TTL = 6 * 60 * 60 * 1000;

const showInfoCache = createCache<TVMazeShow>("show", SHOW_INFO_TTL);
const episodesCache = createCache<TVMazeEpisode[]>("episodes", EPISODES_TTL);
const watchedCache = createCache<WatchedEpisode[]>("watched", WATCHED_TTL);

export function getCachedShow(showId: number, fetcher: () => Promise<TVMazeShow>) {
  return showInfoCache.getOrFetch(showId, fetcher);
}

export function getCachedEpisodes(showId: number, fetcher: () => Promise<TVMazeEpisode[]>) {
  return episodesCache.getOrFetch(showId, fetcher);
}

export function getCachedWatchedEpisodes(showId: number, fetcher: () => Promise<WatchedEpisode[]>) {
  return watchedCache.getOrFetch(showId, fetcher);
}

export function invalidateWatchedEpisodes(showId: number) {
  watchedCache.invalidate(showId);
}

export function invalidateShow(showId: number) {
  showInfoCache.invalidate(showId);
  episodesCache.invalidate(showId);
  watchedCache.invalidate(showId);
}
