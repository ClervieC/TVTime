import { supabase } from "./supabase";

export type ShowStatus = "watching" | "want_to_watch" | "watched" | "dropped";

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

export async function fetchUserShows() {
  const { data, error } = await supabase
    .from("user_shows")
    .select("*")
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
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
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

export async function fetchFavorites() {
  const { data, error } = await supabase
    .from("user_shows")
    .select("*")
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
  const { data, error } = await supabase.from("lists").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data as ShowList[];
}

export async function createList(name: string) {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase.from("lists").insert({ user_id: userId, name }).select().single();
  if (error) throw error;
  return data as ShowList;
}

export async function fetchListItems(listId: string) {
  const { data, error } = await supabase
    .from("list_items")
    .select("*")
    .eq("list_id", listId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as ListItem[];
}

export async function fetchAllListItems() {
  const { data, error } = await supabase
    .from("list_items")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as ListItem[];
}

export async function addShowToList(
  listId: string,
  show: { tvmaze_id: number; show_name: string; show_image: string | null }
) {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
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

export async function fetchWatchedEpisode(episodeId: number) {
  const { data, error } = await supabase
    .from("watched_episodes")
    .select("*")
    .eq("tvmaze_episode_id", episodeId)
    .maybeSingle();
  if (error) throw error;
  return data as WatchedEpisode | null;
}

export async function fetchWatchedEpisodes(showId: number) {
  const { data, error } = await supabase
    .from("watched_episodes")
    .select("*")
    .eq("tvmaze_show_id", showId);
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
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not authenticated");

  if (!params.watched) {
    const { error } = await supabase
      .from("watched_episodes")
      .delete()
      .eq("user_id", userId)
      .eq("tvmaze_episode_id", params.tvmaze_episode_id);
    if (error) throw error;
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
  return data as WatchedEpisode;
}

export async function setEpisodesWatched(
  showId: number,
  episodes: { id: number; season: number; number: number }[]
) {
  if (episodes.length === 0) return;
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
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
}

export async function rateEpisode(tvmazeEpisodeId: number, rating: number | null, feeling: string | null) {
  const { error } = await supabase
    .from("watched_episodes")
    .update({ rating, feeling })
    .eq("tvmaze_episode_id", tvmazeEpisodeId);
  if (error) throw error;
}

export async function incrementRewatch(tvmazeEpisodeId: number, currentTimesWatched: number) {
  const { data, error } = await supabase
    .from("watched_episodes")
    .update({ times_watched: currentTimesWatched + 1, watched_at: new Date().toISOString() })
    .eq("tvmaze_episode_id", tvmazeEpisodeId)
    .select()
    .single();
  if (error) throw error;
  return data as WatchedEpisode;
}
