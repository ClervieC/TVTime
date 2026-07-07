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
