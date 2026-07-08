import { supabase, getCurrentUserId } from "./supabase";
import { fetchProfiles, Profile } from "./profiles";

// Mirrors lib/comments.ts's shape and shows/episodes comments, but keyed by
// TMDB id (movies have no tvmaze id) and kept in its own table (movie_comments)
// rather than reusing `comments` — see supabase/schema.sql for why.
export interface MovieComment {
  id: string;
  user_id: string;
  tmdb_id: number;
  body: string;
  created_at: string;
}

export interface EnrichedMovieComment extends MovieComment {
  author: Profile | null;
  reactionCount: number;
  reactedByMe: boolean;
}

async function enrichMovieComments(comments: MovieComment[]): Promise<EnrichedMovieComment[]> {
  if (comments.length === 0) return [];
  const userIds = [...new Set(comments.map((c) => c.user_id))];
  const commentIds = comments.map((c) => c.id);
  const myId = await getCurrentUserId();

  const [authors, reactions] = await Promise.all([
    fetchProfiles(userIds),
    supabase.from("movie_comment_reactions").select("comment_id, user_id").in("comment_id", commentIds),
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

export async function fetchMovieComments(tmdbId: number): Promise<EnrichedMovieComment[]> {
  const { data, error } = await supabase
    .from("movie_comments")
    .select("*")
    .eq("tmdb_id", tmdbId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return enrichMovieComments(data as MovieComment[]);
}

export async function postMovieComment(tmdbId: number, body: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase.from("movie_comments").insert({
    user_id: userId,
    tmdb_id: tmdbId,
    body: body.trim(),
  });
  if (error) throw error;
}

export async function deleteMovieComment(commentId: string): Promise<void> {
  const { error } = await supabase.from("movie_comments").delete().eq("id", commentId);
  if (error) throw error;
}

export async function toggleMovieCommentReaction(commentId: string, currentlyReacted: boolean): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  if (currentlyReacted) {
    const { error } = await supabase
      .from("movie_comment_reactions")
      .delete()
      .eq("comment_id", commentId)
      .eq("user_id", userId);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("movie_comment_reactions")
      .insert({ comment_id: commentId, user_id: userId });
    if (error) throw error;
  }
}
