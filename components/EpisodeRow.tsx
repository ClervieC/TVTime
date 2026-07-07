import { useMemo, useRef } from "react";
import { View, Text, Pressable, Image, Animated, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import type { SwipeableMethods } from "react-native-gesture-handler/lib/typescript/components/ReanimatedSwipeable/ReanimatedSwipeableProps";
import Reanimated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { useColors, radius, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { useScalePress, useFlashPulse } from "../lib/animations";
import { WatchedCheck } from "./WatchedCheck";

interface EpisodeRowProps {
  showId: number;
  showName: string;
  showImage: string | null;
  episodeId: number;
  season: number;
  number: number;
  extraEpisodes?: number;
  title: string;
  isPremiere?: boolean;
  isNew?: boolean;
  hasAired?: boolean;
  watched: boolean;
  timesWatched?: number;
  time?: string;
  network?: string;
  daysAway?: number;
  dimmed?: boolean;
  expandIcon?: "up" | "down";
  onToggleWatched: () => void;
  onRewatch?: () => void;
  onPress?: () => void;
}

export function EpisodeRow({
  showId,
  showName,
  showImage,
  episodeId,
  season,
  number,
  extraEpisodes,
  title,
  isPremiere,
  isNew,
  hasAired,
  watched,
  timesWatched,
  time,
  network,
  daysAway,
  dimmed,
  expandIcon,
  onToggleWatched,
  onRewatch,
  onPress,
}: EpisodeRowProps) {
  const router = useRouter();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const { scale, onPressIn, onPressOut } = useScalePress(0.97);
  const { opacity: flashOpacity, flash } = useFlashPulse();
  const swipeableRef = useRef<SwipeableMethods>(null);

  function handleToggleWatched() {
    if (!watched) flash();
    onToggleWatched();
  }

  function handleRewatch() {
    flash();
    onRewatch?.();
  }

  // Swiping to mark watched only makes sense where the checkmark column is
  // shown (not for upcoming/unaired episodes) and for episodes not already
  // watched — unwatching goes through the tap + rewatch-prompt flow instead.
  const swipeToWatchEnabled =
    daysAway === undefined && time === undefined && !watched && !expandIcon;

  function renderRightActions(progress: SharedValue<number>) {
    const style = useAnimatedStyle(() => ({ opacity: progress.value }));
    return (
      <Reanimated.View style={[styles.swipeAction, style]}>
        <Ionicons name="checkmark-circle" size={26} color="#fff" />
        <Text style={styles.swipeActionText}>{t.episodeRow.markWatched}</Text>
      </Reanimated.View>
    );
  }

  function handleSwipeOpen() {
    swipeableRef.current?.close();
    handleToggleWatched();
  }

  const openEpisode =
    onPress ??
    (() =>
      router.push({
        pathname: "/episode/[id]",
        params: { id: String(episodeId), showId: String(showId) },
      }));

  const row = (
    <Pressable onPressIn={onPressIn} onPressOut={onPressOut} onPress={openEpisode}>
      <Animated.View style={[styles.row, dimmed && styles.rowDimmed, { transform: [{ scale }] }]}>
      <Pressable
        style={styles.thumbWrap}
        onPress={(e) => {
          e.stopPropagation();
          router.push(`/show/${showId}`);
        }}
      >
        {showImage ? (
          <Image source={{ uri: showImage }} style={[styles.thumb, dimmed && styles.thumbDimmed]} />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder, dimmed && styles.thumbDimmed]} />
        )}
      </Pressable>
      <View style={styles.info}>
        <Text style={[styles.showNameMain, dimmed && styles.textDimmed]} numberOfLines={1}>
          {showName}
        </Text>
        <View style={styles.positionRow}>
          <Text style={[styles.positionCode, dimmed && styles.textDimmed]}>
            S{String(season).padStart(2, "0")} · E{String(number).padStart(2, "0")}
          </Text>
          {!!extraEpisodes && (
            <Text style={styles.positionRemaining}>{t.episodeRow.remaining(extraEpisodes)}</Text>
          )}
        </View>
        <Text style={[styles.episodeTitle, dimmed && styles.textDimmed]} numberOfLines={1}>
          {title}
        </Text>
        {!dimmed && (
          <View style={styles.badgeRow}>
            {isPremiere && (
              <View style={[styles.badge, { backgroundColor: colors.badgePremiere }]}>
                <Text style={[styles.badgeText, { color: "#fff" }]}>{t.episodeRow.premiere}</Text>
              </View>
            )}
            {isNew && (
              <View style={[styles.badge, { backgroundColor: colors.badgeNew }]}>
                <Text style={[styles.badgeText, { color: colors.onAccent }]}>{t.episodeRow.new}</Text>
              </View>
            )}
            {hasAired && (
              <View style={[styles.badge, { backgroundColor: colors.badgeAired }]}>
                <Text style={[styles.badgeText, { color: "#fff" }]}>{t.episodeRow.aired}</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {daysAway !== undefined ? (
        <View style={styles.timeCol}>
          <Text style={styles.daysAwayNumber}>{daysAway}</Text>
          <Text style={styles.daysAwayLabel}>{t.episodeRow.days}</Text>
        </View>
      ) : time ? (
        <View style={styles.timeCol}>
          <Text style={styles.time}>{time}</Text>
          {network && <Text style={styles.network}>{network}</Text>}
        </View>
      ) : (
        // Grouped rows (expandIcon set) still need their own checkmark — the
        // group only collapses the *other* episodes of that day, the first
        // one shown on this row must stay individually markable.
        <View style={styles.checkCol}>
          <WatchedCheck
            watched={watched}
            timesWatched={timesWatched}
            onToggle={handleToggleWatched}
            onRewatch={handleRewatch}
            light={dimmed}
          />
        </View>
      )}
      {expandIcon && (
        <Ionicons
          name={expandIcon === "up" ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.textMuted}
          style={styles.expandCorner}
        />
      )}
      <Animated.View
        pointerEvents="none"
        style={[styles.flashOverlay, { backgroundColor: colors.green, opacity: flashOpacity }]}
      />
      </Animated.View>
    </Pressable>
  );

  if (!swipeToWatchEnabled) return row;

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      onSwipeableOpen={handleSwipeOpen}
      overshootRight={false}
    >
      {row}
    </Swipeable>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      overflow: "hidden",
      marginBottom: 12,
      shadowColor: "#000",
      shadowOpacity: 0.06,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
    flashOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
    swipeAction: {
      width: 88,
      marginBottom: 12,
      borderRadius: radius.md,
      backgroundColor: colors.green,
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    swipeActionText: { color: "#fff", fontSize: 11, fontWeight: "800", textAlign: "center" },
    rowDimmed: { backgroundColor: "transparent", shadowOpacity: 0 },
    thumbWrap: { width: 88, alignSelf: "stretch", position: "relative" },
    thumb: { width: "100%", height: "100%", backgroundColor: colors.backgroundAlt },
    thumbDimmed: { opacity: 0.45 },
    thumbPlaceholder: { backgroundColor: colors.backgroundAlt },
    info: { flex: 1, gap: 2, padding: 12, justifyContent: "center" },
    textDimmed: { color: colors.textFaint },
    // The three things that actually matter at a glance: which show, where
    // you are in it, and how much is left — the episode's own title is
    // secondary and shown smaller below.
    showNameMain: { color: colors.text, fontSize: 15, fontWeight: "800" },
    positionRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 1 },
    positionCode: { color: colors.accent, fontSize: 13, fontWeight: "800" },
    positionRemaining: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
    episodeTitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    badgeRow: { flexDirection: "row", gap: 6, marginTop: 4 },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
    badgeText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.3 },
    timeCol: { alignItems: "flex-end", justifyContent: "center", paddingRight: 12 },
    time: { fontWeight: "700", fontSize: 12, color: colors.text },
    network: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
    daysAwayNumber: { fontWeight: "800", fontSize: 24, color: colors.text },
    daysAwayLabel: { fontSize: 10, fontWeight: "700", color: colors.textMuted, marginTop: 1 },
    checkCol: { justifyContent: "center", paddingRight: 12 },
    expandCorner: { position: "absolute", top: 10, right: 10 },
  });
}
