import { useColorScheme } from "react-native";

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

export function useColors(): Colors {
  const scheme = useColorScheme();
  return scheme === "dark" ? darkColors : lightColors;
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
