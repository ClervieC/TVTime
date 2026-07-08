import { parseCSV } from "./csv";
import { searchShows, getShowEpisodes, lookupShowByTvdbId, TVMazeEpisode, TVMazeShow } from "./tvmaze";
import { fetchUserShows, upsertUserShow, bulkUpsertWatchedEpisodes, setShowFavorite, ShowStatus } from "./userShows";
import { bulkUpsertUserMovies } from "./userMovies";
import { mapWithConcurrency } from "./concurrency";

// TVmaze's rate limit is now enforced globally in lib/tvmaze.ts's fetchWithRetry
// (a shared pacing gate all callers funnel through), so this concurrency only
// controls how many shows are matched/processed in parallel — the actual
// network dispatch rate stays safe no matter how high this is.
const IMPORT_CONCURRENCY = 4;

interface TvTimeRow {
  mediaType: string;
  title: string;
  year: number | null;
  season: number | null;
  number: number | null;
  watchedAt: string;
}

function stripYearSuffix(title: string) {
  return title.replace(/\s*\(\d{4}\)\s*$/, "").trim();
}

function parseTvTimeRows(csvText: string): TvTimeRow[] {
  const table = parseCSV(csvText.trim());
  if (table.length === 0) return [];

  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iMediaType = col("media_type");
  const iTitle = col("title");
  const iYear = col("year");
  const iSeason = col("season");
  const iEpisode = col("episode");
  const iWatchedAt = col("watched_at");

  const rows: TvTimeRow[] = [];
  for (let r = 1; r < table.length; r++) {
    const cols = table[r];
    const title = cols[iTitle]?.trim();
    const watchedAt = cols[iWatchedAt]?.trim();
    if (!title || !watchedAt) continue;

    const year = Number(cols[iYear]);
    const season = Number(cols[iSeason]);
    const number = Number(cols[iEpisode]);

    rows.push({
      mediaType: cols[iMediaType]?.trim() ?? "",
      title,
      year: Number.isFinite(year) ? year : null,
      season: Number.isFinite(season) ? season : null,
      number: Number.isFinite(number) ? number : null,
      watchedAt,
    });
  }
  return rows;
}

async function findBestShowMatch(title: string) {
  const tryQuery = async (query: string) => {
    try {
      const results = await searchShows(query);
      return results[0]?.show ?? null;
    } catch {
      return null;
    }
  };

  let match = await tryQuery(title);

  if (!match) {
    const stripped = stripYearSuffix(title);
    if (stripped !== title) {
      match = await tryQuery(stripped);
    }
  }

  return match;
}

export interface ImportProgress {
  phase: "matching" | "importing";
  current: number;
  total: number;
  label: string;
}

export interface ImportSummary {
  showsImported: number;
  showsUnmatched: string[];
  episodesImported: number;
  moviesImported: number;
}

export async function importTvTimeCsv(
  csvText: string,
  onProgress?: (progress: ImportProgress) => void
): Promise<ImportSummary> {
  const allRows = parseTvTimeRows(csvText);
  const episodeRows = allRows.filter((r) => r.mediaType === "episode" && r.season !== null && r.number !== null);
  const movieRows = allRows.filter((r) => r.mediaType === "movie");

  const moviesByKey = new Map<
    string,
    { title: string; year: number | null; watchedAt: string; timesWatched: number }
  >();
  for (const row of movieRows) {
    const key = `${row.title}__${row.year ?? ""}`;
    const existing = moviesByKey.get(key);
    if (!existing) {
      moviesByKey.set(key, { title: row.title, year: row.year, watchedAt: row.watchedAt, timesWatched: 1 });
    } else {
      existing.timesWatched += 1;
      if (new Date(row.watchedAt).getTime() > new Date(existing.watchedAt).getTime()) {
        existing.watchedAt = row.watchedAt;
      }
    }
  }
  const movieRecords = [...moviesByKey.values()];
  if (movieRecords.length > 0) {
    await bulkUpsertUserMovies(movieRecords);
  }

  const rowsByTitle = new Map<string, TvTimeRow[]>();
  for (const row of episodeRows) {
    const list = rowsByTitle.get(row.title) ?? [];
    list.push(row);
    rowsByTitle.set(row.title, list);
  }

  const titles = [...rowsByTitle.keys()];
  const unmatched: string[] = [];
  let episodesImported = 0;

  // Same resume-friendly skip as the JSON import: if this show is already tracked
  // (e.g. a previous run of this same import got interrupted), don't redo the
  // expensive episode fetch + rewrite, just count it and move on.
  const alreadyImported = new Set((await fetchUserShows()).map((s) => s.tvmaze_id));

  let completed = 0;

  await mapWithConcurrency(titles, IMPORT_CONCURRENCY, async (title) => {
    onProgress?.({ phase: "matching", current: completed + 1, total: titles.length, label: title });

    const show = await findBestShowMatch(title);
    if (!show) {
      unmatched.push(title);
      completed += 1;
      return;
    }

    if (alreadyImported.has(show.id)) {
      completed += 1;
      return;
    }

    let episodes: TVMazeEpisode[];
    try {
      episodes = await getShowEpisodes(show.id);
    } catch {
      unmatched.push(title);
      completed += 1;
      return;
    }

    const episodeByKey = new Map<string, TVMazeEpisode>();
    for (const ep of episodes) episodeByKey.set(`${ep.season}-${ep.number}`, ep);

    const watchedByEpisodeId = new Map<
      number,
      { season: number; number: number; watchedAt: string; timesWatched: number }
    >();

    for (const row of rowsByTitle.get(title)!) {
      const ep = episodeByKey.get(`${row.season}-${row.number}`);
      if (!ep) continue;

      const existing = watchedByEpisodeId.get(ep.id);
      if (!existing) {
        watchedByEpisodeId.set(ep.id, {
          season: ep.season,
          number: ep.number,
          watchedAt: row.watchedAt,
          timesWatched: 1,
        });
      } else {
        existing.timesWatched += 1;
        if (new Date(row.watchedAt).getTime() > new Date(existing.watchedAt).getTime()) {
          existing.watchedAt = row.watchedAt;
        }
      }
    }

    const records = [...watchedByEpisodeId.entries()].map(([episodeId, v]) => ({
      episodeId,
      season: v.season,
      number: v.number,
      watchedAt: v.watchedAt,
      timesWatched: v.timesWatched,
    }));

    completed += 1;
    onProgress?.({ phase: "importing", current: completed, total: titles.length, label: show.name });

    if (records.length === 0) return;

    const airedEpisodeCount = episodes.filter((ep) => new Date(ep.airstamp).getTime() <= Date.now()).length;
    const isEnded = show.status === "Ended";
    // Independent writes to unrelated tables (watched_episodes vs. user_shows)
    // — running them in parallel roughly halves this show's share of a
    // large-library import's total time.
    await Promise.all([
      bulkUpsertWatchedEpisodes(show.id, records),
      upsertUserShow({
        tvmaze_id: show.id,
        show_name: show.name,
        show_image: show.image?.medium ?? null,
        status: isEnded && records.length >= airedEpisodeCount ? "watched" : "watching",
      }),
    ]);
    episodesImported += records.length;
  });

  return {
    showsImported: titles.length - unmatched.length,
    showsUnmatched: unmatched,
    episodesImported,
    moviesImported: movieRecords.length,
  };
}

// Structure of TV Time's (by Refract) full JSON export, as opposed to its older CSV export above.
interface TvTimeJsonEpisode {
  number: number;
  is_watched: boolean;
  watched_at: string | null;
  rewatch_count: number;
  watched_count: number;
}

interface TvTimeJsonSeason {
  number: number;
  episodes: TvTimeJsonEpisode[];
}

interface TvTimeJsonShow {
  id: { tvdb: number | null };
  created_at: string;
  title: string;
  status: string;
  is_favorite: boolean;
  seasons: TvTimeJsonSeason[];
}

interface TvTimeJsonMovie {
  title: string;
  year: number | null;
  created_at: string;
  watched_at: string | null;
  is_watched: boolean;
  rewatch_count: number;
}

function parseTvTimeJsonEntries(jsonText: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Fichier JSON invalide.");
  }

  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as any)?.shows)
      ? (parsed as any).shows
      : Array.isArray((parsed as any)?.movies)
        ? (parsed as any).movies
        : null;
  if (!list) {
    throw new Error("Format JSON invalide : une liste de séries ou de films est attendue.");
  }
  return list;
}

// Known TV Time statuses: "stopped", "not_started_yet", "watch_later", "up_to_date",
// "continuing". Any other/future status (unrecognized or absent) falls through to the
// last line, which derives watching/watched from actual per-episode watch data instead
// of trusting the raw string — so an unknown status can't crash or silently mis-tag a show.
function mapTvTimeJsonStatus(rawStatus: string, watchedCount: number, airedCount: number, isEnded: boolean): ShowStatus {
  if (rawStatus === "stopped") return "dropped";
  if (rawStatus === "not_started_yet" || rawStatus === "watch_later") return "want_to_watch";
  return isEnded && watchedCount > 0 && watchedCount >= airedCount ? "watched" : "watching";
}

export async function importTvTimeJson(
  jsonText: string,
  onProgress?: (progress: ImportProgress) => void
): Promise<ImportSummary> {
  const entries = parseTvTimeJsonEntries(jsonText);
  const isMovies = entries.length > 0 && !Array.isArray((entries[0] as any)?.seasons);

  if (isMovies) {
    const moviesImported = await importTvTimeMoviesJson(entries as TvTimeJsonMovie[]);
    return { showsImported: 0, showsUnmatched: [], episodesImported: 0, moviesImported };
  }

  return importTvTimeShowsJson(entries as TvTimeJsonShow[], onProgress);
}

async function importTvTimeMoviesJson(rawMovies: TvTimeJsonMovie[]): Promise<number> {
  const watched = rawMovies.filter((m) => m.is_watched);
  if (watched.length === 0) return 0;

  const records = watched.map((m) => ({
    title: m.title,
    year: m.year,
    watchedAt: m.watched_at ?? m.created_at,
    timesWatched: m.rewatch_count + 1,
  }));

  await bulkUpsertUserMovies(records);
  return records.length;
}

async function importTvTimeShowsJson(
  rawShows: TvTimeJsonShow[],
  onProgress?: (progress: ImportProgress) => void
): Promise<ImportSummary> {
  const unmatched: string[] = [];
  let showsImported = 0;
  let episodesImported = 0;

  // On a very large export, an import can take a long time (roughly one TVmaze
  // round trip per show). If it gets interrupted partway and the user re-runs it
  // on the same file, there's no reason to redo the expensive part (fetching every
  // episode + rewriting watch history) for shows already fully imported — just the
  // cheap lookup, then skip straight to the next one.
  const alreadyImported = new Set((await fetchUserShows()).map((s) => s.tvmaze_id));

  let completed = 0;

  await mapWithConcurrency(rawShows, IMPORT_CONCURRENCY, async (raw) => {
    onProgress?.({ phase: "matching", current: completed + 1, total: rawShows.length, label: raw.title });

    let show: TVMazeShow | null = null;
    if (raw.id?.tvdb) {
      try {
        show = await lookupShowByTvdbId(raw.id.tvdb);
      } catch {
        show = null;
      }
    }
    if (!show) {
      show = await findBestShowMatch(raw.title);
    }
    if (!show) {
      unmatched.push(raw.title);
      completed += 1;
      return;
    }

    if (alreadyImported.has(show.id)) {
      showsImported += 1;
      completed += 1;
      return;
    }

    let episodes: TVMazeEpisode[];
    try {
      episodes = await getShowEpisodes(show.id);
    } catch {
      unmatched.push(raw.title);
      completed += 1;
      return;
    }

    const episodeByKey = new Map<string, TVMazeEpisode>();
    for (const ep of episodes) episodeByKey.set(`${ep.season}-${ep.number}`, ep);

    const records: { episodeId: number; season: number; number: number; watchedAt: string; timesWatched: number }[] =
      [];
    for (const season of raw.seasons ?? []) {
      for (const ep of season.episodes ?? []) {
        if (!ep.is_watched) continue;
        const match = episodeByKey.get(`${season.number}-${ep.number}`);
        if (!match) continue;
        records.push({
          episodeId: match.id,
          season: match.season,
          number: match.number,
          watchedAt: ep.watched_at ?? raw.created_at,
          timesWatched: ep.watched_count > 0 ? ep.watched_count : ep.rewatch_count + 1,
        });
      }
    }

    completed += 1;
    onProgress?.({ phase: "importing", current: completed, total: rawShows.length, label: show.name });

    const airedEpisodeCount = episodes.filter((ep) => new Date(ep.airstamp).getTime() <= Date.now()).length;
    const status = mapTvTimeJsonStatus(raw.status, records.length, airedEpisodeCount, show.status === "Ended");

    // watched_episodes and user_shows are independent writes and can run
    // concurrently; setShowFavorite has to wait since it updates the
    // user_shows row upsertUserShow above just created (a favorite toggle on
    // a not-yet-existing row would silently affect zero rows).
    await Promise.all([
      records.length > 0 ? bulkUpsertWatchedEpisodes(show.id, records) : Promise.resolve(),
      upsertUserShow({
        tvmaze_id: show.id,
        show_name: show.name,
        show_image: show.image?.medium ?? null,
        status,
      }),
    ]);
    if (records.length > 0) episodesImported += records.length;

    if (raw.is_favorite) {
      await setShowFavorite(show.id, true);
    }

    showsImported += 1;
  });

  return {
    showsImported,
    showsUnmatched: unmatched,
    episodesImported,
    moviesImported: 0,
  };
}
