import type { TVMazeEpisode, TVMazeShow } from "./tvmaze";
import type { WatchedEpisode } from "./userShows";

// Generic cache-aside helper: repeated visits (Watch List, a show's detail
// page, its episode pager, etc.) all want the same show/episode data, and
// re-fetching it from TVmaze or Supabase every time is pure waste. Each of
// these lazily calls its `fetcher` only on a cache miss/expiry.
function createCache<T>(ttlMs: number) {
  const map = new Map<number, { data: T; fetchedAt: number }>();

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
    map.set(id, { data, fetchedAt: Date.now() });
  }

  function invalidate(id: number) {
    map.delete(id);
  }

  async function getOrFetch(id: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = get(id);
    if (cached) return cached;
    const data = await fetcher();
    set(id, data);
    return data;
  }

  return { get, set, invalidate, getOrFetch };
}

// Show metadata and episode lists are effectively static day-to-day.
const SHOW_INFO_TTL = 15 * 60 * 1000;
const EPISODES_TTL = 15 * 60 * 1000;
// Watched status changes whenever the user marks something watched, so keep
// this window short and invalidate explicitly on every mutation.
const WATCHED_TTL = 2 * 60 * 1000;

const showInfoCache = createCache<TVMazeShow>(SHOW_INFO_TTL);
const episodesCache = createCache<TVMazeEpisode[]>(EPISODES_TTL);
const watchedCache = createCache<WatchedEpisode[]>(WATCHED_TTL);

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

// Legacy combined accessor kept for the Watch List screen, which already
// fetches episodes + watched together per show.
export function getCachedShowData(showId: number): { episodes: TVMazeEpisode[]; watchedList: WatchedEpisode[] } | null {
  const episodes = episodesCache.get(showId);
  const watchedList = watchedCache.get(showId);
  if (!episodes || !watchedList) return null;
  return { episodes, watchedList };
}

export function setCachedShowData(showId: number, episodes: TVMazeEpisode[], watchedList: WatchedEpisode[]) {
  episodesCache.set(showId, episodes);
  watchedCache.set(showId, watchedList);
}
