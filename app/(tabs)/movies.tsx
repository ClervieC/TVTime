import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../lib/theme";

export default function MoviesScreen() {
  return (
    <View style={styles.container}>
      <Ionicons name="film-outline" size={40} color={colors.textFaint} />
      <Text style={styles.title}>Films</Text>
      <Text style={styles.subtitle}>Le suivi des films arrive bientôt.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", gap: 8 },
  title: { fontSize: 20, fontWeight: "800", color: colors.text },
  subtitle: { color: colors.textMuted },
});
