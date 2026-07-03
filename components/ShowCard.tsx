import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { colors, radius } from "../lib/theme";

interface ShowCardProps {
  id: number;
  name: string;
  imageUrl: string | null;
  subtitle?: string;
}

export function ShowCard({ id, name, imageUrl, subtitle }: ShowCardProps) {
  const router = useRouter();

  return (
    <Pressable style={styles.card} onPress={() => router.push(`/show/${id}`)}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={styles.image} contentFit="cover" />
      ) : (
        <View style={[styles.image, styles.placeholder]}>
          <Text style={styles.placeholderText}>{name[0]}</Text>
        </View>
      )}
      <Text style={styles.name} numberOfLines={2}>
        {name}
      </Text>
      {subtitle && (
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: 110, marginRight: 12 },
  image: { width: 110, height: 155, borderRadius: radius.sm, backgroundColor: colors.backgroundAlt },
  placeholder: { alignItems: "center", justifyContent: "center" },
  placeholderText: { color: colors.textFaint, fontSize: 30, fontWeight: "700" },
  name: { color: colors.text, fontSize: 13, fontWeight: "600", marginTop: 6 },
  subtitle: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
});
