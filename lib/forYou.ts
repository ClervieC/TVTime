import { loadLocalShowStats, fetchCachedShowStats } from "./showStats";
import { getForYouTv, getForYouMovies, TMDBTvResult, TMDBSearchResult } from "./tmdb";

// TVmaze genres are free-text ("Drama", "Science-Fiction", ...); TMDB's
// discover endpoint wants its own fixed numeric genre ids. This maps the
// TVmaze names that actually show up in lib/showStats.ts's genreBreakdown to
// their closest TMDB TV genre id — not every TVmaze genre has a clean TMDB
// equivalent (e.g. "Legal", "Espionage"), those are just left unmapped and
// skipped rather than guessed at.
const TVMAZE_TO_TMDB_TV_GENRE: Record<string, number> = {
  Drama: 18,
  Comedy: 35,
  Crime: 80,
  Documentary: 99,
  Family: 10751,
  Kids: 10762,
  Mystery: 9648,
  News: 10763,
  "Reality": 10764,
  "Science-Fiction": 10765,
  Fantasy: 10765,
  Romance: 10766,
  "War": 10768,
  Western: 37,
  Action: 10759,
  Adventure: 10759,
  Anime: 16,
  Horror: 9648,
  Thriller: 9648,
};

const MAX_GENRES = 3;

async function topGenreIds(): Promise<number[]> {
  const stats = (await loadLocalShowStats()) ?? (await fetchCachedShowStats().catch(() => null));
  if (!stats) return [];

  const ids: number[] = [];
  for (const g of stats.genreBreakdown) {
    const id = TVMAZE_TO_TMDB_TV_GENRE[g.genre];
    if (id != null && !ids.includes(id)) ids.push(id);
    if (ids.length >= MAX_GENRES) break;
  }
  return ids;
}

export interface ForYou {
  shows: TMDBTvResult[];
  movies: TMDBSearchResult[];
}

// Fed by lib/showStats.ts's already-computed genre breakdown (see
// topGenreIds above) rather than recomputing genre weighting from scratch —
// this is meant to be cheap enough to call every time Explore opens, and
// showStats.ts already did the expensive part (a full watch-history scan +
// TVmaze genre lookups) for the stats screen.
export async function fetchForYou(): Promise<ForYou> {
  const genreIds = await topGenreIds();
  if (genreIds.length === 0) return { shows: [], movies: [] };

  const [shows, movies] = await Promise.all([getForYouTv(genreIds), getForYouMovies(genreIds)]);
  return { shows: shows.slice(0, 12), movies: movies.slice(0, 12) };
}
