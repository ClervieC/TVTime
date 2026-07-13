import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, iconSize, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";

interface DetailErrorStateProps {
  onBack: () => void;
}

// Shown in place of a show/movie detail screen's content when loading it
// failed outright (a bad/stale id, a deleted title, a network error) —
// previously these screens had no failure branch at all and just sat on
// their loading spinner forever (`loading || !data` stays true when `data`
// never arrives), giving no indication anything was wrong or way back.
export function DetailErrorState({ onBack }: DetailErrorStateProps) {
  const colors = useColors();
  const { t } = useLanguage();
  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Ionicons name="alert-circle-outline" size={iconSize.lg} color={colors.red} />
      </View>
      <Text style={styles.title}>{t.common.somethingWentWrong}</Text>
      <Text style={styles.subtitle}>{t.common.somethingWentWrongDetail}</Text>
      <Pressable style={styles.button} onPress={onBack} accessibilityRole="button">
        <Text style={styles.buttonText}>{t.common.backToShows}</Text>
      </Pressable>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, padding: 32 },
    iconWrap: {
      width: 56,
      height: 56,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 4,
    },
    title: { fontSize: type.subtitle, fontWeight: "800", color: colors.text, textAlign: "center" },
    subtitle: { fontSize: type.bodySm, color: colors.textMuted, textAlign: "center", marginBottom: 12 },
    button: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: 12, paddingHorizontal: 24 },
    buttonText: { color: colors.onAccent, fontWeight: "700", fontSize: type.body },
  });
}
