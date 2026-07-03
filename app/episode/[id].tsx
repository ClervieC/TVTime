import { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  FlatList,
  Pressable,
  StyleSheet,
  Image,
  ActivityIndicator,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getShow, getShowEpisodes, TVMazeEpisode, TVMazeShow } from "../../lib/tvmaze";
import { fetchWatchedEpisodes, incrementRewatch, rateEpisode, setEpisodeWatched, WatchedEpisode } from "../../lib/userShows";
import { colors, radius } from "../../lib/theme";
import { WatchedCheck } from "../../components/WatchedCheck";

const FEELINGS = [
  { key: "shocked", emoji: "😲", label: "SHOCKED" },
  { key: "frustrated", emoji: "😤", label: "FRUSTRATED" },
  { key: "sad", emoji: "😢", label: "SAD" },
  { key: "reflective", emoji: "🤔", label: "REFLECTIVE" },
];

const MAX_DOTS = 5;

function stripHtml(html: string | null) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "");
}

export default function EpisodeDetailScreen() {
  const { id, showId } = useLocalSearchParams<{ id: string; showId: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const showIdNum = Number(showId);
  const initialEpisodeId = Number(id);

  const [show, setShow] = useState<TVMazeShow | null>(null);
  const [episodes, setEpisodes] = useState<TVMazeEpisode[]>([]);
  const [watchedMap, setWatchedMap] = useState<Record<number, WatchedEpisode | null>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const listRef = useRef<FlatList<TVMazeEpisode>>(null);
  const hasScrolledToInitial = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      hasScrolledToInitial.current = false;
      Promise.all([
        showIdNum ? getShow(showIdNum) : Promise.resolve(null),
        showIdNum ? getShowEpisodes(showIdNum) : Promise.resolve([]),
        showIdNum ? fetchWatchedEpisodes(showIdNum) : Promise.resolve([]),
      ]).then(([sh, eps, watchedList]) => {
        if (!active) return;
        setShow(sh);
        setEpisodes(eps);
        const map: Record<number, WatchedEpisode | null> = {};
        for (const w of watchedList) map[w.tvmaze_episode_id] = w;
        setWatchedMap(map);
        const idx = eps.findIndex((e) => e.id === initialEpisodeId);
        setCurrentIndex(idx >= 0 ? idx : 0);
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }, [initialEpisodeId, showIdNum])
  );

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(e.nativeEvent.contentOffset.x / width);
    setCurrentIndex((prev) => (prev === index ? prev : index));
  }

  async function toggleWatched(episode: TVMazeEpisode) {
    const isWatched = !!watchedMap[episode.id];
    const result = await setEpisodeWatched({
      tvmaze_show_id: showIdNum,
      tvmaze_episode_id: episode.id,
      season: episode.season,
      number: episode.number,
      watched: !isWatched,
    });
    setWatchedMap((prev) => ({ ...prev, [episode.id]: result }));
  }

  async function rewatchEpisode(episode: TVMazeEpisode) {
    const current = watchedMap[episode.id];
    if (!current) return;
    const result = await incrementRewatch(episode.id, current.times_watched);
    setWatchedMap((prev) => ({ ...prev, [episode.id]: result }));
  }

  async function setRating(episode: TVMazeEpisode, value: number) {
    const current = watchedMap[episode.id];
    if (!current) return;
    await rateEpisode(episode.id, value, current.feeling);
    setWatchedMap((prev) => ({ ...prev, [episode.id]: { ...current, rating: value } }));
  }

  async function setFeeling(episode: TVMazeEpisode, key: string) {
    const current = watchedMap[episode.id];
    if (!current) return;
    const next = current.feeling === key ? null : key;
    await rateEpisode(episode.id, current.rating, next);
    setWatchedMap((prev) => ({ ...prev, [episode.id]: { ...current, feeling: next } }));
  }

  const watchedCount = Object.values(watchedMap).filter(Boolean).length;
  const remaining = episodes.length > 0 ? episodes.length - watchedCount : null;

  if (loading || episodes.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.black} />
      </View>
    );
  }

  let dotStart = Math.max(0, currentIndex - Math.floor(MAX_DOTS / 2));
  const dotEnd = Math.min(episodes.length, dotStart + MAX_DOTS);
  dotStart = Math.max(0, dotEnd - MAX_DOTS);
  const dotIndices = Array.from({ length: dotEnd - dotStart }, (_, i) => dotStart + i);

  return (
    <View style={styles.container}>
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.overlayTopRow}>
          <Pressable style={styles.iconBtn} onPress={() => router.replace("/(tabs)")}>
            <Ionicons name="chevron-down" size={22} color="#fff" />
          </Pressable>
          <View style={styles.dotsRow}>
            {dotIndices.map((i) => (
              <View key={i} style={[styles.dot, i === currentIndex && styles.dotActive]} />
            ))}
          </View>
          <Pressable style={styles.iconBtn}>
            <Ionicons name="share-outline" size={20} color="#fff" />
          </Pressable>
        </View>
        {show && (
          <Pressable style={styles.showPill} onPress={() => router.push(`/show/${show.id}`)}>
            <Text style={styles.showPillText}>{show.name.toUpperCase()}</Text>
            <Ionicons name="chevron-forward" size={12} color={colors.text} />
          </Pressable>
        )}
      </View>

      <FlatList
        ref={listRef}
        data={episodes}
        keyExtractor={(ep) => String(ep.id)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={currentIndex}
        getItemLayout={(_data, index) => ({ length: width, offset: width * index, index })}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollToIndexFailed={({ index }) => {
          requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: index * width, animated: false }));
        }}
        renderItem={({ item: episode }) => {
          const watched = watchedMap[episode.id] ?? null;
          return (
            <ScrollView
              style={{ width }}
              contentContainerStyle={styles.page}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.hero}>
                {episode.image ? (
                  <Image source={{ uri: episode.image.original }} style={styles.heroImage} />
                ) : (
                  <View style={[styles.heroImage, { backgroundColor: colors.backgroundAlt }]} />
                )}
              </View>

              <View style={styles.body}>
                <Text style={styles.code}>
                  S{String(episode.season).padStart(2, "0")} | E{String(episode.number).padStart(2, "0")}
                </Text>
                <Text style={styles.title}>{episode.name}</Text>

                {remaining !== null && (
                  <View style={styles.remainingBadge}>
                    <Ionicons name="film-outline" size={13} color={colors.textMuted} />
                    <Text style={styles.remainingText}>
                      {remaining === 0
                        ? "Tous les épisodes ont été vus"
                        : `${remaining} épisode${remaining > 1 ? "s" : ""} restant${remaining > 1 ? "s" : ""}`}
                    </Text>
                  </View>
                )}

                <View style={styles.metaRow}>
                  <View style={styles.metaItem}>
                    <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
                    <Text style={styles.metaText}>{episode.airdate}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Ionicons name="eye-outline" size={14} color={colors.textMuted} />
                    <Text style={styles.metaText}>
                      {watched ? watched.watched_at?.slice(0, 10) : "Not watched"}
                    </Text>
                  </View>
                  <View style={{ marginLeft: "auto" }}>
                    <WatchedCheck
                      watched={!!watched}
                      timesWatched={watched?.times_watched}
                      onToggle={() => toggleWatched(episode)}
                      onRewatch={() => rewatchEpisode(episode)}
                    />
                  </View>
                </View>

                {episode.summary && <Text style={styles.summary}>{stripHtml(episode.summary)}</Text>}

                <Text style={styles.sectionLabel}>RATE THIS EPISODE</Text>
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable key={n} onPress={() => setRating(episode, n)} style={styles.starCol}>
                      <Ionicons
                        name={watched?.rating && watched.rating >= n ? "star" : "star-outline"}
                        size={28}
                        color={watched?.rating && watched.rating >= n ? colors.starOn : colors.starOff}
                      />
                    </Pressable>
                  ))}
                </View>
                <View style={styles.starsLabelRow}>
                  {["BAD", "OK", "GOOD", "GREAT", "WOW"].map((l) => (
                    <Text key={l} style={styles.starLabel}>
                      {l}
                    </Text>
                  ))}
                </View>

                <Text style={styles.sectionLabel}>HOW DID YOU FEEL?</Text>
                <View style={styles.feelingsRow}>
                  {FEELINGS.map((f) => (
                    <Pressable
                      key={f.key}
                      style={[styles.feelingChip, watched?.feeling === f.key && styles.feelingChipActive]}
                      onPress={() => setFeeling(episode, f.key)}
                    >
                      <Text style={styles.feelingEmoji}>{f.emoji}</Text>
                      <Text style={styles.feelingLabel}>{f.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </ScrollView>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  overlayTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  iconBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  dotsRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.5)" },
  dotActive: { backgroundColor: colors.accent, width: 8, height: 8, borderRadius: 4 },
  showPill: {
    marginTop: 44,
    marginLeft: 16,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fff",
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  showPillText: { fontSize: 11, fontWeight: "800", color: colors.text },
  page: { flexGrow: 1 },
  hero: { height: 260, backgroundColor: "#111" },
  heroImage: { width: "100%", height: "100%", position: "absolute" },
  body: { padding: 16 },
  code: { color: colors.textMuted, fontWeight: "700", fontSize: 13 },
  title: { fontSize: 22, fontWeight: "800", color: colors.text, marginTop: 2, marginBottom: 10 },
  remainingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginBottom: 14,
  },
  remainingText: { fontSize: 12, fontWeight: "400", color: colors.textFaint },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 16 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { color: colors.textMuted, fontSize: 12 },
  summary: { color: colors.text, fontSize: 14, lineHeight: 21, marginBottom: 20 },
  sectionLabel: {
    textAlign: "center",
    fontWeight: "800",
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 12,
  },
  starsRow: { flexDirection: "row", justifyContent: "center", gap: 12 },
  starCol: { alignItems: "center" },
  starsLabelRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 8, marginTop: 6 },
  starLabel: { fontSize: 10, color: colors.textFaint, fontWeight: "700" },
  feelingsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  feelingChip: { alignItems: "center", gap: 4, padding: 8, borderRadius: radius.sm },
  feelingChipActive: { backgroundColor: colors.pillBg },
  feelingEmoji: { fontSize: 26 },
  feelingLabel: { fontSize: 9, fontWeight: "700", color: colors.textMuted },
});
