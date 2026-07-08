import { supabase, getCurrentUserId } from "./supabase";

export type Language = "en" | "fr";

export interface UserSettings {
  user_id: string;
  spoiler_mode: boolean;
  language: Language;
}

export async function fetchUserSettings(): Promise<UserSettings> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data ?? { user_id: userId, spoiler_mode: false, language: "en" };
}

export async function setSpoilerMode(enabled: boolean) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: userId, spoiler_mode: enabled }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function setLanguage(language: Language) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: userId, language }, { onConflict: "user_id" });
  if (error) throw error;
}
