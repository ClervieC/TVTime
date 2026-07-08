import { useMemo } from "react";
import { View, Text, Pressable, Animated, StyleSheet } from "react-native";
import { useColors, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { useScalePress } from "../lib/animations";
import { FEELING_EMOJIS } from "../lib/feelings";
import { Sheet } from "./Sheet";

interface FeelingSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (key: string) => void;
}

// Quick-capture popup shown right after marking an episode watched from a
// list row (Watch List, Upcoming) — a lighter touch than navigating to the
// episode's own page just to log how it felt. Tapping outside (Sheet's
// backdrop) dismisses without saving, same as picking nothing.
export function FeelingSheet({ visible, onClose, onSelect }: FeelingSheetProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>{t.episodeDetail.howDidYouFeel}</Text>
      <View style={styles.row}>
        {FEELING_EMOJIS.map((f) => (
          <FeelingButton key={f.key} emoji={f.emoji} label={t.feelings[f.key]} onPress={() => onSelect(f.key)} styles={styles} />
        ))}
      </View>
    </Sheet>
  );
}

type Styles = ReturnType<typeof createStyles>;

function FeelingButton({
  emoji,
  label,
  onPress,
  styles,
}: {
  emoji: string;
  label: string;
  onPress: () => void;
  styles: Styles;
}) {
  const { scale, onPressIn, onPressOut } = useScalePress(0.88);

  return (
    <Pressable onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress} style={styles.chip}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Text style={styles.emoji}>{emoji}</Text>
      </Animated.View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    title: {
      textAlign: "center",
      fontWeight: "800",
      fontSize: 13,
      color: colors.textMuted,
      letterSpacing: 0.5,
      marginBottom: 16,
    },
    row: { flexDirection: "row", justifyContent: "space-between" },
    chip: { alignItems: "center", gap: 4, padding: 8 },
    emoji: { fontSize: 32 },
    label: { fontSize: type.micro, fontWeight: "700", color: colors.textMuted },
  });
}
