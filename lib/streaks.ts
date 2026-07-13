import { createAsyncStorage } from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { supabase, getCurrentUserId } from "./supabase";
import { fetchUserShows } from "./userShows";
import { fetchFollowingIds } from "./follows";
import type { Colors } from "./theme";
import type { Translations } from "./i18n";

const PAGE_SIZE = 1000;

// IndexedDB-backed local mirror (see the same comment in lib/showStats.ts)
// — paints app/streaks.tsx and the Shows tab's streak pill instantly from
// the last computed result, no network round trip, while a fresh compute
// runs in the background. This has no Supabase-side counterpart the way
// show_stats_cache does: streak/badge data is cheap enough to recompute
// (one watched_at scan, a handful of counts) that a per-device cache is
// all it needs — nothing here is expensive enough to justify syncing a
// precomputed copy across devices too.
const localStore = createAsyncStorage("streaks_cache");
const LOCAL_STORAGE_KEY = "streaks_v1";
const SCHEMA_VERSION = 4;

export type BadgeCategory = "episodes" | "movies" | "shows" | "streak" | "ratings" | "social" | "rewatch";

export interface Badge {
  id: string;
  category: BadgeCategory;
  threshold: number;
  achieved: boolean;
  // The moment this device/session first noticed the badge achieved (see
  // syncBadgeUnlocks below) — null while locked, or for an achieved badge
  // whose unlock row hasn't synced yet (e.g. offline).
  earnedAt: string | null;
  // The category's current raw metric value (e.g. totalEpisodesWatched for
  // every "episodes" badge) — same number on every badge in a category,
  // repeated per-badge so app/streaks.tsx can render a "12/50" progress bar
  // on the next locked badge without needing the category totals separately.
  progress: number;
}

export interface StreakData {
  schemaVersion: number;
  currentStreak: number;
  longestStreak: number;
  totalEpisodesWatched: number;
  totalMoviesWatched: number;
  showsCompleted: number;
  badges: Badge[];
  computedAt: string;
}

// Shared between app/streaks.tsx and the badge-unlock toast (see
// context/BadgeUnlockContext.tsx) so both render the exact same icon/color/
// label per badge instead of keeping two copies in sync by hand.
export const BADGE_ICON: Record<BadgeCategory, keyof typeof Ionicons.glyphMap> = {
  episodes: "checkmark-done-outline",
  movies: "film-outline",
  shows: "ribbon-outline",
  streak: "flame-outline",
  ratings: "star-outline",
  social: "people-outline",
  rewatch: "repeat-outline",
};

// One accent color per category so the badge grid (and the unlock toast)
// read as seven distinct collections rather than one undifferentiated wall
// of purple.
export function categoryColor(colors: Colors, category: BadgeCategory): string {
  const map: Record<BadgeCategory, string> = {
    episodes: colors.blue,
    movies: colors.red,
    shows: colors.yellow,
    streak: "#ff9f43",
    ratings: colors.accent,
    social: colors.green,
    rewatch: colors.blue,
  };
  return map[category];
}

export function badgeLabel(t: Translations, badge: Badge): string {
  const BADGE_LABEL: Record<BadgeCategory, (n: number) => string> = {
    episodes: t.profile.badgeEpisodes,
    movies: t.profile.badgeMovies,
    shows: t.profile.badgeShows,
    streak: t.profile.badgeStreak,
    ratings: t.profile.badgeRatings,
    social: t.profile.badgeSocial,
    rewatch: t.profile.badgeRewatch,
  };
  return BADGE_LABEL[badge.category](badge.threshold);
}

const EPISODE_THRESHOLDS = [10, 50, 100, 500, 1000];
const MOVIE_THRESHOLDS = [5, 25, 50, 100];
const SHOW_THRESHOLDS = [1, 5, 10, 25];
const STREAK_THRESHOLDS = [3, 7, 30, 100];
const RATINGS_THRESHOLDS = [5, 25, 100, 250];
const SOCIAL_THRESHOLDS = [1, 5, 10, 25];
const REWATCH_THRESHOLDS = [1, 5, 15, 50];

async function fetchWatchedDays(): Promise<Set<string>> {
  const userId = await getCurrentUserId();
  const days = new Set<string>();
  if (!userId) return days;

  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("watched_episodes")
      .select("watched_at")
      .eq("user_id", userId)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    for (const row of page) {
      if (row.watched_at) days.add(row.watched_at.slice(0, 10));
    }
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const { data: movieRows, error: movieError } = await supabase
    .from("user_movies")
    .select("watched_at")
    .eq("user_id", userId)
    .eq("status", "watched");
  if (movieError) throw movieError;
  for (const row of movieRows ?? []) {
    if (row.watched_at) days.add(row.watched_at.slice(0, 10));
  }

  return days;
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Longest run of consecutive calendar days with at least one watch, and the
// current run — which stays "alive" through today even if today itself has
// no activity yet (same forgiving semantics as Duolingo/GitHub streaks: the
// streak only actually breaks once a full day passes with nothing watched).
function computeStreaks(days: Set<string>): { current: number; longest: number } {
  if (days.size === 0) return { current: 0, longest: 0 };

  let longest = 0;
  let run = 0;
  const sorted = [...days].sort();
  let prev: Date | null = null;
  for (const key of sorted) {
    const d = new Date(key + "T00:00:00Z");
    if (prev) {
      const diffDays = Math.round((d.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000));
      run = diffDays === 1 ? run + 1 : 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    prev = d;
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const cursor = new Date(today);
  if (!days.has(toDateKey(cursor))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  let current = 0;
  while (days.has(toDateKey(cursor))) {
    current += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return { current, longest };
}

function buildBadges(
  totalEpisodesWatched: number,
  totalMoviesWatched: number,
  showsCompleted: number,
  longestStreak: number,
  ratingsGiven: number,
  followingCount: number,
  rewatchCount: number
): Badge[] {
  const badges: Badge[] = [];
  for (const threshold of EPISODE_THRESHOLDS) {
    badges.push({ id: `episodes-${threshold}`, category: "episodes", threshold, achieved: totalEpisodesWatched >= threshold, earnedAt: null, progress: totalEpisodesWatched });
  }
  for (const threshold of MOVIE_THRESHOLDS) {
    badges.push({ id: `movies-${threshold}`, category: "movies", threshold, achieved: totalMoviesWatched >= threshold, earnedAt: null, progress: totalMoviesWatched });
  }
  for (const threshold of SHOW_THRESHOLDS) {
    badges.push({ id: `shows-${threshold}`, category: "shows", threshold, achieved: showsCompleted >= threshold, earnedAt: null, progress: showsCompleted });
  }
  for (const threshold of STREAK_THRESHOLDS) {
    badges.push({ id: `streak-${threshold}`, category: "streak", threshold, achieved: longestStreak >= threshold, earnedAt: null, progress: longestStreak });
  }
  for (const threshold of RATINGS_THRESHOLDS) {
    badges.push({ id: `ratings-${threshold}`, category: "ratings", threshold, achieved: ratingsGiven >= threshold, earnedAt: null, progress: ratingsGiven });
  }
  for (const threshold of SOCIAL_THRESHOLDS) {
    badges.push({ id: `social-${threshold}`, category: "social", threshold, achieved: followingCount >= threshold, earnedAt: null, progress: followingCount });
  }
  for (const threshold of REWATCH_THRESHOLDS) {
    badges.push({ id: `rewatch-${threshold}`, category: "rewatch", threshold, achieved: rewatchCount >= threshold, earnedAt: null, progress: rewatchCount });
  }
  return badges;
}

async function countRows(table: string, userId: string, extra?: (q: any) => any): Promise<number> {
  let q = supabase.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (extra) q = extra(q);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

// Mutates badges in place, filling in earnedAt for any achieved badge — reads
// this user's existing public.badge_unlocks rows, inserts a fresh row (now())
// for any achieved badge that doesn't have one yet, and leaves earnedAt null
// for anything still locked. Best-effort: a failure here (e.g. offline, or
// the migration hasn't been run yet — see supabase/schema.sql) just leaves
// every earnedAt null rather than breaking the rest of the streak compute.
//
// Returns the badges that are genuinely newly earned (for a celebratory
// banner — see computeStreakData's onNewlyUnlocked) — but only when this
// user already had at least one badge_unlocks row. Without that guard, the
// very first compute after this table existed would insert a row for every
// already-achieved badge in one go and report all of them as "just earned,"
// flooding a long-time user with a banner for a dozen badges they actually
// earned months ago.
async function syncBadgeUnlocks(userId: string, badges: Badge[]): Promise<Badge[]> {
  try {
    const { data, error } = await supabase
      .from("badge_unlocks")
      .select("badge_id, earned_at")
      .eq("user_id", userId);
    if (error) throw error;
    const existing = new Map((data ?? []).map((r) => [r.badge_id, r.earned_at as string]));
    const isBackfill = existing.size === 0;

    const toInsert: Badge[] = [];
    for (const badge of badges) {
      if (!badge.achieved) continue;
      const earnedAt = existing.get(badge.id);
      if (earnedAt) {
        badge.earnedAt = earnedAt;
      } else {
        toInsert.push(badge);
      }
    }
    if (toInsert.length === 0) return [];

    const now = new Date().toISOString();
    const { error: insertError } = await supabase.from("badge_unlocks").upsert(
      toInsert.map((badge) => ({ user_id: userId, badge_id: badge.id, earned_at: now })),
      { onConflict: "user_id,badge_id", ignoreDuplicates: true }
    );
    if (insertError) throw insertError;
    for (const badge of toInsert) badge.earnedAt = now;
    return isBackfill ? [] : toInsert;
  } catch {
    // Best-effort — see comment above.
    return [];
  }
}

// Not cached server-side the way lib/showStats.ts's heavier stats are — this
// only needs one lightweight watched_at scan plus a handful of counts (no
// per-show TVmaze calls), cheap enough to recompute on every visit. Still
// mirrored into IndexedDB (see loadLocalStreakData/saveLocalStreakData
// below) purely for an instant first paint / offline read, same pattern as
// showStats's local cache.
export async function computeStreakData(onNewlyUnlocked?: (badges: Badge[]) => void): Promise<StreakData> {
  const userId = await getCurrentUserId();

  // All independent of each other — running them concurrently instead of
  // one after another is most of the win here (six count queries plus the
  // watched-days scan were previously six-plus sequential round trips).
  const [days, shows, followingIds, totalEpisodesWatched, ratedEpisodes, rewatchedEpisodesCount, totalMoviesWatched, ratedMovies, rewatchedMoviesCount] =
    await Promise.all([
      fetchWatchedDays(),
      fetchUserShows(),
      userId ? fetchFollowingIds(userId) : Promise.resolve([]),
      userId ? countRows("watched_episodes", userId) : Promise.resolve(0),
      userId ? countRows("watched_episodes", userId, (q) => q.not("rating", "is", null)) : Promise.resolve(0),
      userId ? countRows("watched_episodes", userId, (q) => q.gt("times_watched", 1)) : Promise.resolve(0),
      userId ? countRows("user_movies", userId, (q) => q.eq("status", "watched")) : Promise.resolve(0),
      userId ? countRows("user_movies", userId, (q) => q.eq("status", "watched").not("rating", "is", null)) : Promise.resolve(0),
      userId ? countRows("user_movies", userId, (q) => q.eq("status", "watched").gt("times_watched", 1)) : Promise.resolve(0),
    ]);
  const { current, longest } = computeStreaks(days);

  const showsCompleted = shows.filter((s) => s.status === "watched").length;
  const ratingsGiven = ratedEpisodes + ratedMovies;
  const rewatchCount = rewatchedEpisodesCount + rewatchedMoviesCount;

  const badges = buildBadges(totalEpisodesWatched, totalMoviesWatched, showsCompleted, longest, ratingsGiven, followingIds.length, rewatchCount);
  if (userId) {
    const newlyUnlocked = await syncBadgeUnlocks(userId, badges);
    if (newlyUnlocked.length > 0) onNewlyUnlocked?.(newlyUnlocked);
  }

  const data: StreakData = {
    schemaVersion: SCHEMA_VERSION,
    currentStreak: current,
    longestStreak: longest,
    totalEpisodesWatched,
    totalMoviesWatched,
    showsCompleted,
    badges,
    computedAt: new Date().toISOString(),
  };
  saveLocalStreakData(data);
  return data;
}

// Instant, no-network read — call before computeStreakData() for a fast
// first paint (see app/streaks.tsx and the Shows tab's streak pill).
export async function loadLocalStreakData(): Promise<StreakData | null> {
  try {
    const raw = await localStore.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as StreakData;
    if (data.schemaVersion !== SCHEMA_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

async function saveLocalStreakData(data: StreakData): Promise<void> {
  try {
    await localStore.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Best-effort.
  }
}

// Called on sign-out (see context/AuthContext.tsx) — this key has no user id
// in it, so without clearing it, signing into a different account on the
// same device would briefly show the previous account's streak/badges
// straight from disk before the fresh compute overwrites it.
export async function clearLocalStreakData(): Promise<void> {
  try {
    await localStore.removeItem(LOCAL_STORAGE_KEY);
  } catch {
    // Best-effort.
  }
}
