import { useRef } from "react";
import { Animated, Pressable, StyleSheet, GestureResponderEvent, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../lib/theme";
import { useRewatchPrompt } from "../context/RewatchPromptContext";

interface WatchedCheckProps {
  watched: boolean;
  timesWatched?: number;
  onToggle: () => void;
  onRewatch?: () => void;
  size?: number;
  light?: boolean;
}

export function WatchedCheck({ watched, timesWatched, onToggle, onRewatch, size = 30, light }: WatchedCheckProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const askRewatch = useRewatchPrompt();

  function bounce() {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.7, duration: 80, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 3, tension: 200, useNativeDriver: true }),
    ]).start();
  }

  async function handlePress(e: GestureResponderEvent) {
    e.stopPropagation();
    if (!watched) {
      bounce();
      onToggle();
      return;
    }
    const choice = await askRewatch();
    bounce();
    if (choice === "rewatch") {
      onRewatch?.();
    } else {
      onToggle();
    }
  }

  const rewatched = watched && (timesWatched ?? 1) > 1;

  return (
    <Pressable onPress={handlePress} hitSlop={10}>
      <Animated.View
        style={[
          styles.check,
          { width: size, height: size, borderRadius: size / 2, transform: [{ scale }] },
          watched && (light ? styles.checkOnLight : styles.checkOn),
        ]}
      >
        {rewatched ? (
          <Text style={[styles.timesText, { fontSize: size * 0.42 }]}>×{timesWatched}</Text>
        ) : (
          <Ionicons name="checkmark" size={size * 0.53} color={watched ? "#fff" : colors.textFaint} />
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  check: {
    backgroundColor: colors.pillBg,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  checkOn: { backgroundColor: colors.green },
  checkOnLight: { backgroundColor: "#a8dfa9" },
  timesText: { color: "#fff", fontWeight: "800" },
});
