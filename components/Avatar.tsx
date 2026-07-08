import { useMemo } from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, avatarSize, Colors } from "../lib/theme";

type AvatarSizeToken = keyof typeof avatarSize;

const FONT_SIZES: Record<AvatarSizeToken, number> = { sm: 13, md: 17, lg: 28 };
const ICON_SIZES: Record<AvatarSizeToken, number> = { sm: 14, md: 20, lg: 32 };

interface AvatarProps {
  // Either a display name (renders its first letter) or a photo URL — pass
  // whichever you have. If both are given, the photo wins and `name` is only
  // used as the alt/fallback when the photo is missing.
  name?: string;
  imageUri?: string | null;
  size?: AvatarSizeToken;
}

// One avatar for the whole app — a photo when there is one, otherwise an
// initial-letter circle, otherwise a generic person glyph. Pick one of the
// three sizes rather than a new box.
export function Avatar({ name, imageUri, size = "md" }: AvatarProps) {
  const colors = useColors();
  const boxSize = avatarSize[size];
  const hasInitial = !imageUri && !!name;
  const styles = useMemo(
    () => createStyles(colors, boxSize, FONT_SIZES[size]),
    [colors, boxSize, size]
  );

  return (
    <View style={[styles.circle, { backgroundColor: hasInitial ? colors.accent : colors.backgroundAlt }]}>
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={styles.photo} />
      ) : hasInitial ? (
        <Text style={styles.initial}>{name[0]?.toUpperCase() ?? "?"}</Text>
      ) : (
        <Ionicons name="person" size={ICON_SIZES[size]} color={colors.textFaint} />
      )}
    </View>
  );
}

function createStyles(colors: Colors, boxSize: number, fontSize: number) {
  return StyleSheet.create({
    circle: {
      width: boxSize,
      height: boxSize,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    photo: { width: boxSize, height: boxSize },
    initial: { fontSize, fontWeight: "800", color: colors.onAccent },
  });
}
