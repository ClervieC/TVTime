import { ReactNode } from "react";
import { Text, Pressable, StyleSheet } from "react-native";
import { useColors, type, Colors } from "../lib/theme";
import { Avatar } from "./Avatar";

interface UserRowProps {
  username: string;
  onPress: () => void;
  trailing?: ReactNode;
}

export function UserRow({ username, onPress, trailing }: UserRowProps) {
  const colors = useColors();
  const styles = createStyles(colors);

  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Avatar name={username} size="sm" />
      <Text style={styles.username} numberOfLines={1}>
        {username}
      </Text>
      {trailing}
    </Pressable>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
    username: { flex: 1, fontWeight: "700", fontSize: type.body, color: colors.text },
  });
}
