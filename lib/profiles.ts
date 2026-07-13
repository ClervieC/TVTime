import { supabase, getCurrentUserId } from "./supabase";

export interface Profile {
  user_id: string;
  username: string;
  is_admin: boolean;
  is_banned: boolean;
  avatar_url: string | null;
}

export async function fetchMyProfile(): Promise<Profile | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createProfile(username: string): Promise<Profile> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("profiles")
    .insert({ user_id: userId, username })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchProfiles(userIds: string[]): Promise<Profile[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await supabase.from("profiles").select("*").in("user_id", userIds);
  if (error) throw error;
  return data;
}

export async function searchProfiles(query: string): Promise<Profile[]> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .ilike("username", `%${query}%`)
    .neq("user_id", userId ?? "")
    .limit(20);
  if (error) throw error;
  return data;
}

// Admin-only in practice (RLS lets anyone select any profile, but only an
// admin's own update policy can flip is_banned — see supabase/schema.sql).
export async function fetchAllProfilesForAdmin(query: string): Promise<Profile[]> {
  let q = supabase.from("profiles").select("*").order("username", { ascending: true }).limit(50);
  if (query.trim()) q = q.ilike("username", `%${query.trim()}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function setUserBanned(userId: string, banned: boolean): Promise<void> {
  const { error } = await supabase.from("profiles").update({ is_banned: banned }).eq("user_id", userId);
  if (error) throw error;
}

// `uri` is whatever DocumentPicker handed back (see app/(tabs)/profile.tsx)
// — a local file:// URI on native, a blob:/data: URI on web. fetch() reads
// either into a Blob uniformly, which is what supabase-js's storage upload
// wants; a File-system-specific read (like the CSV import elsewhere in this
// file's caller) would need separate native/web branches for no benefit
// here. Always uploaded to the same fixed path (not one per photo) with
// upsert — a user only ever has one current avatar, so nothing but the
// current one needs to stick around in the bucket, and this dodges the "old
// image still cached under the old URL" problem an ever-growing path would
// have (see the cache-busting query param below instead).
export async function uploadAvatar(uri: string, mimeType: string): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const response = await fetch(uri);
  const blob = await response.blob();
  const ext = mimeType.split("/")[1] ?? "jpg";
  const path = `${userId}/avatar.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, blob, { contentType: mimeType, upsert: true });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  // Cache-busting: the URL itself doesn't change across re-uploads (fixed
  // path + upsert), so without this a client that already cached the old
  // image (its own, or another user viewing this profile) would keep
  // showing it after a new photo is uploaded.
  const avatarUrl = `${data.publicUrl}?v=${Date.now()}`;

  const { error: updateError } = await supabase.from("profiles").update({ avatar_url: avatarUrl }).eq("user_id", userId);
  if (updateError) throw updateError;

  return avatarUrl;
}
