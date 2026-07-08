import { supabase, getCurrentUserId } from "./supabase";
import { fetchProfiles, Profile } from "./profiles";

export interface AppNotification {
  id: string;
  user_id: string;
  type: string;
  actor_id: string | null;
  read: boolean;
  created_at: string;
}

export interface EnrichedNotification extends AppNotification {
  actor: Profile | null;
}

export async function fetchNotifications(): Promise<EnrichedNotification[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;

  const actorIds = [...new Set(data.map((n) => n.actor_id).filter((id): id is string => !!id))];
  const actors = await fetchProfiles(actorIds);
  const actorById = new Map(actors.map((a) => [a.user_id, a]));

  return data.map((n) => ({ ...n, actor: n.actor_id ? actorById.get(n.actor_id) ?? null : null }));
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const userId = await getCurrentUserId();
  if (!userId) return 0;

  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("read", false);
  if (error) throw error;
  return count ?? 0;
}

export async function markAllNotificationsRead() {
  const userId = await getCurrentUserId();
  if (!userId) return;

  const { error } = await supabase.from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false);
  if (error) throw error;
}
