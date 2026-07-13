import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, getCurrentUserId } from "./supabase";

// Device-local, not per-account synced through Supabase — same reasoning as
// lib/theme.ts's theme preference: "have you seen the intro on this device"
// is a device fact, not an account fact, and a reinstall reasonably shows it
// again. Uses the default AsyncStorage (not createAsyncStorage's IndexedDB
// variant) since this is a single tiny boolean, not the kind of cache that
// risks the localStorage quota the other modules' comments warn about.
const STORAGE_KEY = "onboarding_completed_v1";

export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(STORAGE_KEY)) === "true";
  } catch {
    return true; // fail open — never block app access over a storage read error
  }
}

export async function markOnboardingComplete(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, "true");
  } catch {
    // Best-effort — worst case the intro shows again next launch.
  }
}

// What app/_layout.tsx actually gates the redirect on — the device flag
// alone would show the intro to an existing account logging in on a second
// device or after a reinstall, even though they already have shows/movies
// tracked and have nothing to be "onboarded" into. Checking for any existing
// content first (and marking the flag complete on the spot if found) makes
// this "new to the app," not just "new to this device."
export async function shouldShowOnboarding(): Promise<boolean> {
  if (await hasCompletedOnboarding()) return false;

  const userId = await getCurrentUserId();
  if (userId) {
    const [{ count: showCount }, { count: movieCount }] = await Promise.all([
      supabase.from("user_shows").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("user_movies").select("id", { count: "exact", head: true }).eq("user_id", userId),
    ]);
    if ((showCount ?? 0) > 0 || (movieCount ?? 0) > 0) {
      await markOnboardingComplete();
      return false;
    }
  }

  return true;
}
