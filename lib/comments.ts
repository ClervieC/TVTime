import { supabase, getCurrentUserId } from "./supabase";
import { fetchProfiles, Profile } from "./profiles";

export type CommentTarget = "show" | "episode";

export interface Comment {
  id: string;
  user_id: string;
  target_type: CommentTarget;
  tvmaze_show_id: number;
  tvmaze_episode_id: number | null;
  body: string;
  created_at: string;
}

export interface EnrichedComment extends Comment {
  author: Profile | null;
  reactionCount: number;
  reactedByMe: boolean;
}

async function enrichComments(comments: Comment[]): Promise<EnrichedComment[]> {
  if (comments.length === 0) return [];
  const userIds = [...new Set(comments.map((c) => c.user_id))];
  const commentIds = comments.map((c) => c.id);
  const myId = await getCurrentUserId();

  const [authors, reactions] = await Promise.all([
    fetchProfiles(userIds),
    supabase.from("comment_reactions").select("comment_id, user_id").in("comment_id", commentIds),
  ]);
  if (reactions.error) throw reactions.error;

  const authorById = new Map(authors.map((a) => [a.user_id, a]));
  const countByComment = new Map<string, number>();
  const mineByComment = new Set<string>();
  for (const r of reactions.data as { comment_id: string; user_id: string }[]) {
    countByComment.set(r.comment_id, (countByComment.get(r.comment_id) ?? 0) + 1);
    if (r.user_id === myId) mineByComment.add(r.comment_id);
  }

  return comments.map((c) => ({
    ...c,
    author: authorById.get(c.user_id) ?? null,
    reactionCount: countByComment.get(c.id) ?? 0,
    reactedByMe: mineByComment.has(c.id),
  }));
}

export async function fetchShowComments(showId: number): Promise<EnrichedComment[]> {
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("target_type", "show")
    .eq("tvmaze_show_id", showId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return enrichComments(data as Comment[]);
}

export async function fetchEpisodeComments(episodeId: number): Promise<EnrichedComment[]> {
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("target_type", "episode")
    .eq("tvmaze_episode_id", episodeId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return enrichComments(data as Comment[]);
}

export async function postShowComment(showId: number, body: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase.from("comments").insert({
    user_id: userId,
    target_type: "show",
    tvmaze_show_id: showId,
    body: body.trim(),
  });
  if (error) throw error;
}

export async function postEpisodeComment(showId: number, episodeId: number, body: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase.from("comments").insert({
    user_id: userId,
    target_type: "episode",
    tvmaze_show_id: showId,
    tvmaze_episode_id: episodeId,
    body: body.trim(),
  });
  if (error) throw error;
}

export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await supabase.from("comments").delete().eq("id", commentId);
  if (error) throw error;
}

export async function toggleCommentReaction(commentId: string, currentlyReacted: boolean): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  if (currentlyReacted) {
    const { error } = await supabase
      .from("comment_reactions")
      .delete()
      .eq("comment_id", commentId)
      .eq("user_id", userId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("comment_reactions").insert({ comment_id: commentId, user_id: userId });
    if (error) throw error;
  }
}
