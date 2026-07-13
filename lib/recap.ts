import { supabase, getCurrentUserId } from "./supabase";
import { getCachedShow } from "./showDataCache";
import { getShow } from "./tvmaze";
import { mapWithConcurrency } from "./concurrency";

const AVG_EPISODE_MINUTES = 42;
const AVG_MOVIE_MINUTES = 110;
const TOP_SHOWS_FOR_GENRE = 15;
const RECAP_FETCH_CONCURRENCY = 4;
const PAGE_SIZE = 1000;

export interface RecapShow {
  showId: number;
  name: string;
  image: string | null;
  episodeCount: number;
}

export interface RecapData {
  year: number;
  totalEpisodesWatched: number;
  totalMoviesWatched: number;
  totalWatchTimeMinutes: number;
  topShow: RecapShow | null;
  topGenre: string | null;
  newShowsStarted: number;
  daysActive: number;
}

// The Recap is only surfaced (Profile's banner, and the screen itself)
// during a "year in review" window — the last week of December through the
// first two weeks of January — same seasonal framing as Spotify Wrapped
// rather than a stat you'd stumble on any random Tuesday in March. The data
// itself doesn't disappear outside this window (computeRecap works
// year-round for any year passed in), only the surfaced entry points do.
export function isRecapAvailable(date: Date = new Date()): boolean {
  const month = date.getMonth(); // 0 = January, 11 = December
  const day = date.getDate();
  return (month === 11 && day >= 25) || (month === 0 && day <= 14);
}

function yearBounds(year: number) {
  return {
    start: new Date(Date.UTC(year, 0, 1)).toISOString(),
    end: new Date(Date.UTC(year + 1, 0, 1)).toISOString(),
  };
}

// A once-a-year computation (see app/recap.tsx), not cached anywhere the way
// lib/showStats.ts's day-to-day stats are — the underlying data (a past
// year's watch history) never changes once the year is over, so there's no
// staleness to guard against, and re-running it on repeat visits to the
// screen is cheap enough (one page of history, not the full account like
// showStats scans).
export async function computeRecap(year: number): Promise<RecapData> {
  const userId = await getCurrentUserId();
  if (!userId) {
    return {
      year,
      totalEpisodesWatched: 0,
      totalMoviesWatched: 0,
      totalWatchTimeMinutes: 0,
      topShow: null,
      topGenre: null,
      newShowsStarted: 0,
      daysActive: 0,
    };
  }

  const { start, end } = yearBounds(year);

  const episodes: { tvmaze_show_id: number; watched_at: string }[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("watched_episodes")
      .select("tvmaze_show_id, watched_at")
      .eq("user_id", userId)
      .gte("watched_at", start)
      .lt("watched_at", end)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    episodes.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const { count: moviesWatched, error: movieError } = await supabase
    .from("user_movies")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "watched")
    .gte("watched_at", start)
    .lt("watched_at", end);
  if (movieError) throw movieError;

  const countByShow = new Map<number, number>();
  const daysActive = new Set<string>();
  for (const ep of episodes) {
    countByShow.set(ep.tvmaze_show_id, (countByShow.get(ep.tvmaze_show_id) ?? 0) + 1);
    daysActive.add(ep.watched_at.slice(0, 10));
  }

  // Shows first watched (anywhere, not just this year) in this exact year —
  // "started" means the earliest watched_at for that show falls in range,
  // which needs each show's full history, not just this year's slice above.
  const showIdsThisYear = [...countByShow.keys()];
  let newShowsStarted = 0;
  if (showIdsThisYear.length > 0) {
    const { data: firstWatchRows, error: firstWatchError } = await supabase
      .from("watched_episodes")
      .select("tvmaze_show_id, watched_at")
      .eq("user_id", userId)
      .in("tvmaze_show_id", showIdsThisYear)
      .order("watched_at", { ascending: true });
    if (firstWatchError) throw firstWatchError;
    const firstWatchByShow = new Map<number, string>();
    for (const row of firstWatchRows ?? []) {
      if (!firstWatchByShow.has(row.tvmaze_show_id)) firstWatchByShow.set(row.tvmaze_show_id, row.watched_at);
    }
    for (const showId of showIdsThisYear) {
      const first = firstWatchByShow.get(showId);
      if (first && first >= start && first < end) newShowsStarted += 1;
    }
  }

  const topShowEntry = [...countByShow.entries()].sort((a, b) => b[1] - a[1])[0];
  let topShow: RecapShow | null = null;
  const genreTotals = new Map<string, number>();

  const topShowIdsForGenre = [...countByShow.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_SHOWS_FOR_GENRE)
    .map(([id]) => id);

  await mapWithConcurrency(topShowIdsForGenre, RECAP_FETCH_CONCURRENCY, async (showId) => {
    try {
      const show = await getCachedShow(showId, () => getShow(showId));
      const episodeCount = countByShow.get(showId) ?? 0;
      for (const genre of show.genres) {
        genreTotals.set(genre, (genreTotals.get(genre) ?? 0) + episodeCount);
      }
      if (topShowEntry && showId === topShowEntry[0]) {
        topShow = { showId, name: show.name, image: show.image?.medium ?? null, episodeCount };
      }
    } catch {
      // Show metadata unavailable — skip it for both the top-show card and
      // the genre tally.
    }
  });

  const topGenre = [...genreTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const totalEpisodesWatched = episodes.length;
  const totalMoviesWatched = moviesWatched ?? 0;
  const totalWatchTimeMinutes = totalEpisodesWatched * AVG_EPISODE_MINUTES + totalMoviesWatched * AVG_MOVIE_MINUTES;

  return {
    year,
    totalEpisodesWatched,
    totalMoviesWatched,
    totalWatchTimeMinutes,
    topShow,
    topGenre,
    newShowsStarted,
    daysActive: daysActive.size,
  };
}
