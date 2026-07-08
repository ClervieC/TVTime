import { ReactNode, useMemo } from "react";
import { Pressable, Text, View, StyleSheet } from "react-native";
import { useColors, radius, type, Colors } from "../lib/theme";

type PillSize = "sm" | "md";
type PillTone = "neutral" | "accent" | "solid";

interface PillProps {
  children: ReactNode;
  size?: PillSize;
  tone?: PillTone;
  onPress?: () => void;
  uppercase?: boolean;
  // Escape hatch for the handful of pills with a fixed semantic meaning
  // (episode badges: premiere/new/aired) that need a specific color rather
  // than one of the three tones — shape/sizing still comes from the token.
  color?: string;
  textColor?: string;
}

// The one badge/chip/label shape in the app — section headers ("HISTORIQUE"),
// episode badges (PREMIERE/NEW), language switch options, vote-count chips.
// Two sizes, three tones; reach for this before hand-rolling another pill.
export function Pill({ children, size = "sm", tone = "neutral", onPress, uppercase, color, textColor }: PillProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const Wrapper = onPress ? Pressable : View;

  return (
    <Wrapper
      style={[styles.base, styles[size], styles[tone], color ? { backgroundColor: color } : null]}
      onPress={onPress}
    >
      <Text
        style={[
          styles.text,
          styles[`text_${size}` as const],
          styles[`text_${tone}` as const],
          uppercase && styles.uppercase,
          textColor ? { color: textColor } : null,
        ]}
        numberOfLines={1}
      >
        {children}
      </Text>
    </Wrapper>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    base: { borderRadius: radius.pill, alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },
    sm: { paddingHorizontal: 10, paddingVertical: 4 },
    md: { paddingHorizontal: 14, paddingVertical: 6 },
    neutral: { backgroundColor: colors.pillBg },
    accent: { backgroundColor: colors.accentSoft },
    solid: { backgroundColor: colors.accent },
    text: { fontWeight: "800" },
    text_sm: { fontSize: type.micro },
    text_md: { fontSize: type.caption },
    text_neutral: { color: colors.textMuted },
    text_accent: { color: colors.accentDark },
    text_solid: { color: colors.onAccent },
    uppercase: { letterSpacing: 0.5, textTransform: "uppercase" },
  });
}
