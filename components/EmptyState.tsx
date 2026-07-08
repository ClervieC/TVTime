import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, iconSize, Colors } from "../lib/theme";

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
}

// One "nothing here yet" layout for every screen — icon, title, optional
// subtitle. Doesn't set flex:1 itself; wrap it if you want it to fill the
// screen (most lists just want it centered where the content would be).
export function EmptyState({ icon, title, subtitle }: EmptyStateProps) {
  const colors = useColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={iconSize.lg} color={colors.accentDark} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 32, paddingHorizontal: 24 },
    iconWrap: {
      width: 56,
      height: 56,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 4,
    },
    title: { fontSize: type.bodySm, fontWeight: "700", color: colors.text, textAlign: "center" },
    subtitle: { fontSize: type.caption, color: colors.textMuted, textAlign: "center" },
  });
}
