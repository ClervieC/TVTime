import { memo, useMemo, useRef } from "react";
import { View, Text, Pressable, Animated, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import type { SwipeableMethods } from "react-native-gesture-handler/lib/typescript/components/ReanimatedSwipeable/ReanimatedSwipeableProps";
import Reanimated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { useColors, radius, type, dropShadow, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { useScalePress, useFlashPulse } from "../lib/animations";
import { WatchedCheck } from "./WatchedCheck";
import { Pill } from "./Pill";

interface EpisodeRowProps {
  showId: number;
  showName: string;
  showImage: string | null;
  episodeId: number;
  season: number;
  number: number;
  extraEpisodes?: number;
  totalEpisodes?: number;
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

// Wrapped in memo() since this app's biggest lists (Watch List, Upcoming)
// render dozens of these at once, each with its own Swipeable/gesture
// handler and image — skipping a re-render (and everything it triggers
// underneath) when this row's own props haven't actually changed matters a
// lot more here than for a typical list item. Relies on callers passing
// stable primitive props and stable callback references (see
// WatchListEpisodeRow in app/(tabs)/index.tsx) — an inline arrow function
// recreated every render would defeat this regardless.
export const EpisodeRow = memo(function EpisodeRow({
  showId,
  showName,
  showImage,
  episodeId,
  season,
  number,
  extraEpisodes,
  totalEpisodes,
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
          <Image source={{ uri: showImage }} style={[styles.thumb, dimmed && styles.thumbDimmed]} contentFit="cover" />
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
          {!!totalEpisodes && (
            <Text style={styles.positionRemaining}>{t.episodeRow.totalEpisodes(totalEpisodes)}</Text>
          )}
          {!dimmed && isPremiere && (
            <Pill size="sm" uppercase color={colors.badgePremiere} textColor="#fff">
              {t.episodeRow.premiere}
            </Pill>
          )}
          {!dimmed && isNew && (
            <Pill size="sm" uppercase color={colors.badgeNew} textColor={colors.onAccent}>
              {t.episodeRow.new}
            </Pill>
          )}
          {!dimmed && hasAired && (
            <Pill size="sm" uppercase color={colors.badgeAired} textColor="#fff">
              {t.episodeRow.aired}
            </Pill>
          )}
        </View>
        <Text style={[styles.episodeTitle, dimmed && styles.textDimmed]} numberOfLines={1}>
          {title}
        </Text>
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
        style={[styles.flashOverlay, { backgroundColor: colors.green, opacity: flashOpacity, pointerEvents: "none" }]}
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
});

function createStyles(colors: Colors) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      overflow: "hidden",
      marginBottom: 12,
      ...dropShadow({ opacity: 0.06, radius: 6, offsetY: 2, elevation: 1 }),
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
    rowDimmed: { backgroundColor: "transparent", ...dropShadow({ opacity: 0, radius: 0 }) },
    thumbWrap: { width: 88, alignSelf: "stretch", position: "relative" },
    thumb: { width: "100%", height: "100%", backgroundColor: colors.backgroundAlt },
    thumbDimmed: { opacity: 0.45 },
    thumbPlaceholder: { backgroundColor: colors.backgroundAlt },
    info: { flex: 1, gap: 2, padding: 12, justifyContent: "center" },
    textDimmed: { color: colors.textFaint },
    // The three things that actually matter at a glance: which show, where
    // you are in it, and how much is left — the episode's own title is
    // secondary and shown smaller below.
    showNameMain: { color: colors.text, fontSize: type.body, fontWeight: "800" },
    // flexWrap so code + remaining-count + a badge don't clip/overlap on a
    // narrow screen — wraps to a second line instead. alignItems: "center"
    // rather than "baseline" since the badge Pills are Views, not Text, and
    // have no baseline to align against.
    positionRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 1 },
    positionCode: { color: colors.accent, fontSize: 13, fontWeight: "800" },
    positionRemaining: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
    episodeTitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    timeCol: { alignItems: "flex-end", justifyContent: "center", paddingRight: 12 },
    time: { fontWeight: "700", fontSize: 12, color: colors.text },
    network: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
    daysAwayNumber: { fontWeight: "800", fontSize: type.display, color: colors.text },
    daysAwayLabel: { fontSize: type.micro, fontWeight: "700", color: colors.textMuted, marginTop: 1 },
    checkCol: { justifyContent: "center", paddingRight: 12 },
    expandCorner: { position: "absolute", top: 10, right: 10 },
  });
}
