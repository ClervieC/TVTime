import { createContext, useContext, useEffect, useMemo, useState, useCallback, PropsWithChildren } from "react";
import { Platform, useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const lightColors = {
  background: "#f7f7f8",
  backgroundAlt: "#f4f4f5",
  surface: "#ffffff",
  border: "#e6e6e8",
  text: "#111111",
  textMuted: "#6b6b70",
  textFaint: "#9a9aa0",
  accent: "#7c5cff",
  accentDark: "#5b3ff0",
  accentSoft: "#ece7ff",
  onAccent: "#ffffff",
  black: "#111111",
  green: "#05b920",
  greenLight: "#e9f8ea",
  blue: "#2f6fed",
  red: "#e0453c",
  yellow: "#e0a400",
  badgePremiere: "#111111",
  badgeNew: "#7c5cff",
  badgeAired: "#05b920",
  pillBg: "#eeeeee",
  starOn: "#7c5cff",
  starOff: "#e2e2e4",
};

const darkColors: typeof lightColors = {
  background: "#0d1524",
  backgroundAlt: "#131c30",
  surface: "#161f36",
  border: "#262f47",
  text: "#f4f5fb",
  textMuted: "#a3aac0",
  textFaint: "#6b7390",
  accent: "#8a72ff",
  accentDark: "#6b4bf5",
  accentSoft: "#241f3d",
  onAccent: "#ffffff",
  black: "#f4f5fb",
  green: "#05b920",
  greenLight: "#173a22",
  blue: "#6b93ff",
  red: "#ff6b62",
  yellow: "#f0b429",
  badgePremiere: "#2a3247",
  badgeNew: "#8a72ff",
  badgeAired: "#05b920",
  pillBg: "#1c2540",
  starOn: "#8a72ff",
  starOff: "#2c3550",
};

export type Colors = typeof lightColors;

export type ThemeMode = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "theme_mode";

interface ThemeContextValue {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  // The scheme actually in effect right now — "system" resolved against the
  // OS setting, or the explicit override otherwise. Only exposed for the
  // settings row's own display; every other consumer should go through
  // useColors() below instead of re-deriving this.
  resolvedScheme: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextValue>({
  themeMode: "system",
  setThemeMode: () => {},
  resolvedScheme: "light",
});

// Device-local, not synced through Supabase like language/spoiler mode (see
// lib/i18n.tsx) — theme is the kind of preference you'd want to set before
// ever logging in, and re-set per device, not per account.
export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY).then((stored) => {
      if (stored === "light" || stored === "dark" || stored === "system") {
        setThemeModeState(stored);
      }
    });
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    AsyncStorage.setItem(THEME_STORAGE_KEY, mode).catch(() => {});
  }, []);

  const resolvedScheme = themeMode === "system" ? (systemScheme === "dark" ? "dark" : "light") : themeMode;

  const value = useMemo(
    () => ({ themeMode, setThemeMode, resolvedScheme }),
    [themeMode, setThemeMode, resolvedScheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeMode() {
  return useContext(ThemeContext);
}

export function useColors(): Colors {
  const { resolvedScheme } = useContext(ThemeContext);
  return resolvedScheme === "dark" ? darkColors : lightColors;
}

// react-native-web warns that the shadow* props (shadowColor/Opacity/Radius/
// Offset) are deprecated in favor of the CSS `boxShadow` string — but plain
// RN (native) has no boxShadow support at all and still needs shadow*/
// elevation. This picks the right shape per platform from one call site
// instead of scattering Platform.select across every shadowed style.
export function dropShadow(opts: { color?: string; opacity: number; radius: number; offsetY?: number; elevation?: number }) {
  const { color = "#000", opacity, radius: blur, offsetY = 0, elevation } = opts;
  if (Platform.OS === "web") {
    return { boxShadow: `0px ${offsetY}px ${blur}px rgba(0, 0, 0, ${opacity})` } as const;
  }
  return {
    shadowColor: color,
    shadowOpacity: opacity,
    shadowRadius: blur,
    shadowOffset: { width: 0, height: offsetY },
    elevation: elevation ?? 1,
  };
}

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
};

export const spacing = (n: number) => n * 4;

// Every font size in the app should be one of these eight. `input` is the one
// deliberate exception to "smallest is best" — text inputs stay at 16 to
// avoid iOS Safari's auto-zoom-on-focus behavior, so don't shrink it.
// `subtitle` is for section headers *within* a screen ("Info", "Cast",
// "Nouveautés"); `title` is for the screen's own identity — there's usually
// one of those per screen, and several of the former.
export const type = {
  micro: 11,
  caption: 12,
  bodySm: 13,
  body: 14,
  input: 16,
  subtitle: 17,
  title: 20,
  display: 26,
};

// Ionicons `size` prop — inline/meta icons, default action icons, and
// hero/prominent icons. Avatars are a separate scale (see avatarSize) since
// they're photos/initials, not glyphs.
export const iconSize = {
  sm: 16,
  md: 20,
  lg: 28,
};

// Matches the pixel sizes every pre-existing hand-rolled avatar circle used
// (UserRow/notifications: 40px, profile header/cast: 64px, other-user
// profile: 84px) — don't shrink these without checking every call site.
export const avatarSize = {
  sm: 40,
  md: 64,
  lg: 84,
};

// Rotates posterless movie cards through a handful of the app's existing
// semantic hues instead of one flat gray box repeated hundreds of times —
// same trick as a Slack/Gmail avatar, picked deterministically from the
// title so a given movie always lands on the same tint. Shared by MovieCard
// and the movie detail screen, so both use the same color for the same film.
const POSTER_HUES = ["accent", "blue", "green", "red", "yellow"] as const;

export function hueForTitle(title: string): (typeof POSTER_HUES)[number] {
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) | 0;
  return POSTER_HUES[Math.abs(hash) % POSTER_HUES.length];
}
