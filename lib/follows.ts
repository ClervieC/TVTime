import { supabase, getCurrentUserId } from "./supabase";

export async function followUser(followedId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase.from("follows").insert({ follower_id: userId, followed_id: followedId });
  if (error) throw error;
}

export async function unfollowUser(followedId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", userId)
    .eq("followed_id", followedId);
  if (error) throw error;
}

export async function fetchIsFollowing(followedId: string): Promise<boolean> {
  const userId = await getCurrentUserId();
  if (!userId) return false;

  const { data, error } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("follower_id", userId)
    .eq("followed_id", followedId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function fetchFollowCounts(userId: string) {
  const [followers, following] = await Promise.all([
    supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("followed_id", userId),
    supabase.from("follows").select("followed_id", { count: "exact", head: true }).eq("follower_id", userId),
  ]);
  if (followers.error) throw followers.error;
  if (following.error) throw following.error;
  return { followers: followers.count ?? 0, following: following.count ?? 0 };
}

export async function fetchFollowerIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from("follows").select("follower_id").eq("followed_id", userId);
  if (error) throw error;
  return data.map((row) => row.follower_id);
}

export async function fetchFollowingIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from("follows").select("followed_id").eq("follower_id", userId);
  if (error) throw error;
  return data.map((row) => row.followed_id);
}
