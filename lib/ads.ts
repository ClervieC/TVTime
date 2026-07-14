import { Platform } from "react-native";
import { TestIds } from "react-native-google-mobile-ads";

// Falls back to Google's test unit (never real ads) until
// EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID_* is set for each platform, so a build
// without those env vars configured still shows (test) ads instead of
// crashing or showing nothing.
export function bannerAdUnitId(): string {
  if (__DEV__) return TestIds.BANNER;

  const id =
    Platform.OS === "ios"
      ? process.env.EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID_IOS
      : process.env.EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID_ANDROID;

  return id || TestIds.BANNER;
}
