import { supabase, getCurrentUserId } from "./supabase";
import { invalidateWatchedEpisodes } from "./showDataCache";

export type ShowStatus = "watching" | "want_to_watch" | "watched" | "dropped" | "paused";

export interface UserShow {
  id: string;
  user_id: string;
  tvmaze_id: number;
  show_name: string;
  show_image: string | null;
  status: ShowStatus;
  is_favorite: boolean;
  rating: number | null;
  current_season: number | null;
  current_episode: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchUserShows(userId?: string) {
  const targetUserId = userId ?? (await getCurrentUserId());
  if (!targetUserId) return [];

  const { data, error } = await supabase
    .from("user_shows")
    .select("*")
    .eq("user_id", targetUserId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data as UserShow[];
}

export async function upsertUserShow(params: {
  tvmaze_id: number;
  show_name: string;
  show_image: string | null;
  status: ShowStatus;
}) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("user_shows")
    .upsert(
      {
        user_id: userId,
        tvmaze_id: params.tvmaze_id,
        show_name: params.show_name,
        show_image: params.show_image,
        status: params.status,
      },
      { onConflict: "user_id,tvmaze_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return data as UserShow;
}

export async function removeUserShow(tvmazeId: number) {
  const { error } = await supabase.from("user_shows").delete().eq("tvmaze_id", tvmazeId);
  if (error) throw error;
}

export async function setShowStatus(tvmazeId: number, status: ShowStatus) {
  const { data, error } = await supabase
    .from("user_shows")
    .update({ status })
    .eq("tvmaze_id", tvmazeId)
    .select()
    .single();
  if (error) throw error;
  return data as UserShow;
}

export async function setShowFavorite(tvmazeId: number, isFavorite: boolean) {
  const { data, error } = await supabase
    .from("user_shows")
    .update({ is_favorite: isFavorite })
    .eq("tvmaze_id", tvmazeId)
    .select()
    .single();
  if (error) throw error;
  return data as UserShow;
}

export async function fetchFavorites(userId?: string) {
  const targetUserId = userId ?? (await getCurrentUserId());
  if (!targetUserId) return [];

  const { data, error } = await supabase
    .from("user_shows")
    .select("*")
    .eq("user_id", targetUserId)
    .eq("is_favorite", true)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data as UserShow[];
}

export interface ShowList {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface ListItem {
  id: string;
  list_id: string;
  user_id: string;
  tvmaze_id: number;
  show_name: string;
  show_image: string | null;
  created_at: string;
}

export async function fetchLists() {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("lists")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as ShowList[];
}

export async function createList(name: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase.from("lists").insert({ user_id: userId, name }).select().single();
  if (error) throw error;
  return data as ShowList;
}

export async function fetchListItems(listId: string) {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("list_items")
    .select("*")
    .eq("list_id", listId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as ListItem[];
}

export async function fetchAllListItems() {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("list_items")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as ListItem[];
}

export async function addShowToList(
  listId: string,
  show: { tvmaze_id: number; show_name: string; show_image: string | null }
) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase.from("list_items").upsert(
    {
      list_id: listId,
      user_id: userId,
      tvmaze_id: show.tvmaze_id,
      show_name: show.show_name,
      show_image: show.show_image,
    },
    { onConflict: "list_id,tvmaze_id" }
  );
  if (error) throw error;
}

export interface WatchedEpisode {
  id: string;
  user_id: string;
  tvmaze_show_id: number;
  tvmaze_episode_id: number;
  season: number;
  number: number;
  watched: boolean;
  watched_at: string;
  rating: number | null;
  feeling: string | null;
  times_watched: number;
}

export async function fetchEpisodeCount(userId?: string) {
  const targetUserId = userId ?? (await getCurrentUserId());
  if (!targetUserId) return 0;

  const { count, error } = await supabase
    .from("watched_episodes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", targetUserId);
  if (error) throw error;
  return count ?? 0;
}

export async function fetchWatchedEpisodes(showId: number) {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("watched_episodes")
    .select("*")
    .eq("user_id", userId)
    .eq("tvmaze_show_id", showId);
  if (error) throw error;
  return data as WatchedEpisode[];
}

// Global, paginated (across every followed show) history query — used to lazy
// load "Watched history" a page at a time instead of pulling every episode
// the user has ever watched into memory up front.
export async function fetchWatchedEpisodesPage(offset: number, limit: number) {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("watched_episodes")
    .select("*")
    .eq("user_id", userId)
    .order("watched_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data as WatchedEpisode[];
}

export async function setEpisodeWatched(params: {
  tvmaze_show_id: number;
  tvmaze_episode_id: number;
  season: number;
  number: number;
  watched: boolean;
}) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  if (!params.watched) {
    const { error } = await supabase
      .from("watched_episodes")
      .delete()
      .eq("user_id", userId)
      .eq("tvmaze_episode_id", params.tvmaze_episode_id);
    if (error) throw error;
    invalidateWatchedEpisodes(params.tvmaze_show_id);
    return null;
  }

  const { data, error } = await supabase
    .from("watched_episodes")
    .upsert(
      {
        user_id: userId,
        tvmaze_show_id: params.tvmaze_show_id,
        tvmaze_episode_id: params.tvmaze_episode_id,
        season: params.season,
        number: params.number,
        watched: true,
      },
      { onConflict: "user_id,tvmaze_episode_id" }
    )
    .select()
    .single();
  if (error) throw error;
  invalidateWatchedEpisodes(params.tvmaze_show_id);
  return data as WatchedEpisode;
}

export async function setEpisodesWatched(
  showId: number,
  episodes: { id: number; season: number; number: number }[]
) {
  if (episodes.length === 0) return;
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase.from("watched_episodes").upsert(
    episodes.map((ep) => ({
      user_id: userId,
      tvmaze_show_id: showId,
      tvmaze_episode_id: ep.id,
      season: ep.season,
      number: ep.number,
      watched: true,
    })),
    { onConflict: "user_id,tvmaze_episode_id" }
  );
  if (error) throw error;
  invalidateWatchedEpisodes(showId);
}

export async function setEpisodesUnwatched(showId: number, episodeIds: number[]) {
  if (episodeIds.length === 0) return;
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("watched_episodes")
    .delete()
    .eq("user_id", userId)
    .in("tvmaze_episode_id", episodeIds);
  if (error) throw error;
  invalidateWatchedEpisodes(showId);
}

// Bulk version of incrementRewatch — used to mark a whole season/show as
// rewatched at once. times_watched can't be incremented in a single set-based
// update (each row starts from a different count), so each row gets its own
// update, run concurrently since a season is at most a few dozen episodes.
export async function bulkIncrementRewatch(
  showId: number,
  episodes: { episodeId: number; timesWatched: number }[]
) {
  if (episodes.length === 0) return;
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const watchedAt = new Date().toISOString();
  const results = await Promise.all(
    episodes.map((e) =>
      supabase
        .from("watched_episodes")
        .update({ times_watched: e.timesWatched + 1, watched_at: watchedAt })
        .eq("user_id", userId)
        .eq("tvmaze_episode_id", e.episodeId)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
  invalidateWatchedEpisodes(showId);
}

export async function bulkUpsertWatchedEpisodes(
  showId: number,
  records: { episodeId: number; season: number; number: number; watchedAt: string; timesWatched: number }[]
) {
  if (records.length === 0) return;
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const CHUNK_SIZE = 300;
  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from("watched_episodes").upsert(
      chunk.map((r) => ({
        user_id: userId,
        tvmaze_show_id: showId,
        tvmaze_episode_id: r.episodeId,
        season: r.season,
        number: r.number,
        watched: true,
        watched_at: r.watchedAt,
        times_watched: r.timesWatched,
      })),
      { onConflict: "user_id,tvmaze_episode_id" }
    );
    if (error) throw error;
  }
  invalidateWatchedEpisodes(showId);
}

export async function rateEpisode(
  showId: number,
  tvmazeEpisodeId: number,
  rating: number | null,
  feeling: string | null
) {
  const { error } = await supabase
    .from("watched_episodes")
    .update({ rating, feeling })
    .eq("tvmaze_episode_id", tvmazeEpisodeId);
  if (error) throw error;
  invalidateWatchedEpisodes(showId);
}

// Aggregate, anonymous count of how everyone who's watched this episode felt
// about it — only the `feeling` column is selected, never the full row (no
// user_id, rating, or watch history leaks out), same spirit as the
// public-profile episode count query above.
export async function fetchEpisodeFeelingCounts(episodeId: number): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("watched_episodes")
    .select("feeling")
    .eq("tvmaze_episode_id", episodeId)
    .not("feeling", "is", null);
  if (error) throw error;

  const counts: Record<string, number> = {};
  for (const row of data as { feeling: string | null }[]) {
    if (!row.feeling) continue;
    counts[row.feeling] = (counts[row.feeling] ?? 0) + 1;
  }
  return counts;
}

export async function incrementRewatch(tvmazeEpisodeId: number, currentTimesWatched: number) {
  const { data, error } = await supabase
    .from("watched_episodes")
    .update({ times_watched: currentTimesWatched + 1, watched_at: new Date().toISOString() })
    .eq("tvmaze_episode_id", tvmazeEpisodeId)
    .select()
    .single();
  if (error) throw error;
  invalidateWatchedEpisodes(data.tvmaze_show_id);
  return data as WatchedEpisode;
}
