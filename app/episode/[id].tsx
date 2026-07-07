import { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  FlatList,
  Pressable,
  Animated,
  StyleSheet,
  Image,
  ActivityIndicator,
  Share,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getShow, getShowEpisodes, TVMazeEpisode, TVMazeShow } from "../../lib/tvmaze";
import { getCachedEpisodes, getCachedShow, getCachedWatchedEpisodes } from "../../lib/showDataCache";
import { fetchWatchedEpisodes, incrementRewatch, rateEpisode, setEpisodeWatched, WatchedEpisode } from "../../lib/userShows";
import { useColors, radius, Colors } from "../../lib/theme";
import { useLanguage, Translations } from "../../lib/i18n";
import { useScalePress, useMountIn } from "../../lib/animations";
import { WatchedCheck } from "../../components/WatchedCheck";

const FEELING_EMOJIS = [
  { key: "lol", emoji: "😂" },
  { key: "shocked", emoji: "😱" },
  { key: "heartbroken", emoji: "💔" },
  { key: "mindblown", emoji: "🤯" },
  { key: "bored", emoji: "😴" },
] as const;

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
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t, spoilerMode } = useLanguage();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      hasScrolledToInitial.current = false;
      Promise.all([
        showIdNum ? getCachedShow(showIdNum, () => getShow(showIdNum)) : Promise.resolve(null),
        showIdNum ? getCachedEpisodes(showIdNum, () => getShowEpisodes(showIdNum)) : Promise.resolve([]),
        showIdNum ? getCachedWatchedEpisodes(showIdNum, () => fetchWatchedEpisodes(showIdNum)) : Promise.resolve([]),
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

  async function shareEpisode(episode: TVMazeEpisode) {
    const code = `S${String(episode.season).padStart(2, "0")}E${String(episode.number).padStart(2, "0")}`;
    const showName = show?.name ? `${show.name} — ` : "";
    await Share.share({ message: `${showName}${code} · ${episode.name}` });
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
          <Pressable style={styles.iconBtn} onPress={() => shareEpisode(episodes[currentIndex])}>
            <Ionicons name="share-outline" size={20} color="#fff" />
          </Pressable>
        </View>
        {show && (
          <Pressable style={styles.showPill} onPress={() => router.push(`/show/${show.id}`)}>
            <Text style={styles.showPillText}>{show.name.toUpperCase()}</Text>
            <Ionicons name="chevron-forward" size={12} color="#111" />
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
        renderItem={({ item: episode }) => (
          <EpisodePage
            episode={episode}
            width={width}
            watched={watchedMap[episode.id] ?? null}
            remaining={remaining}
            spoilerMode={spoilerMode}
            onToggleWatched={() => toggleWatched(episode)}
            onRewatch={() => rewatchEpisode(episode)}
            onRate={(n) => setRating(episode, n)}
            onFeeling={(key) => setFeeling(episode, key)}
            colors={colors}
            styles={styles}
            t={t}
          />
        )}
      />
    </View>
  );
}

type EpisodeStyles = ReturnType<typeof createStyles>;

function EpisodePage({
  episode,
  width,
  watched,
  remaining,
  spoilerMode,
  onToggleWatched,
  onRewatch,
  onRate,
  onFeeling,
  colors,
  styles,
  t,
}: {
  episode: TVMazeEpisode;
  width: number;
  watched: WatchedEpisode | null;
  remaining: number | null;
  spoilerMode: boolean;
  onToggleWatched: () => void;
  onRewatch: () => void;
  onRate: (value: number) => void;
  onFeeling: (key: string) => void;
  colors: Colors;
  styles: EpisodeStyles;
  t: Translations;
}) {
  const bodyIn = useMountIn();

  return (
    <ScrollView style={{ width }} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        {episode.image ? (
          <Image source={{ uri: episode.image.original }} style={styles.heroImage} />
        ) : (
          <View style={[styles.heroImage, { backgroundColor: colors.backgroundAlt }]} />
        )}
        <LinearGradient
          colors={["transparent", colors.background]}
          style={styles.heroGradient}
          pointerEvents="none"
        />
        <View style={styles.heroBottom}>
          <Text style={styles.code}>
            S{String(episode.season).padStart(2, "0")} · E{String(episode.number).padStart(2, "0")}
          </Text>
          <Text style={styles.title}>{episode.name}</Text>
        </View>
      </View>

      <Animated.View style={[styles.sheet, { opacity: bodyIn.opacity, transform: bodyIn.transform }]}>
        {remaining !== null && (
          <View style={styles.remainingBadge}>
            <Ionicons name="film-outline" size={13} color={colors.accent} />
            <Text style={styles.remainingText}>
              {remaining === 0 ? t.episodeDetail.remainingAll : t.episodeDetail.remaining(remaining)}
            </Text>
          </View>
        )}

        <View style={styles.metaRow}>
          <View style={styles.metaStack}>
            <View style={styles.metaItem}>
              <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
              <Text style={styles.metaText}>{episode.airdate}</Text>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="eye-outline" size={14} color={colors.textMuted} />
              <Text style={styles.metaText}>
                {watched ? watched.watched_at?.slice(0, 10) : t.episodeDetail.notWatched}
              </Text>
            </View>
          </View>
          <WatchedCheck
            watched={!!watched}
            timesWatched={watched?.times_watched}
            onToggle={onToggleWatched}
            onRewatch={onRewatch}
            size={40}
          />
        </View>

        {episode.summary && <Text style={styles.summary}>{stripHtml(episode.summary)}</Text>}

        {!watched && (
          <>
            <View style={styles.divider} />
            <View style={styles.unwatchedPrompt}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.textFaint} />
              <Text style={styles.unwatchedPromptText}>{t.episodeDetail.unwatchedPrompt}</Text>
            </View>
          </>
        )}

        {watched && (
          <>
            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>{t.episodeDetail.yourRating}</Text>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <RatingStar
                  key={n}
                  index={n}
                  filled={!!(watched?.rating && watched.rating >= n)}
                  onPress={() => onRate(n)}
                  colors={colors}
                  styles={styles}
                />
              ))}
            </View>

            <Text style={styles.sectionLabel}>{t.episodeDetail.howDidYouFeel}</Text>
            <View style={styles.feelingsRow}>
              {FEELING_EMOJIS.map((f) => (
                <FeelingChip
                  key={f.key}
                  emoji={f.emoji}
                  label={t.feelings[f.key]}
                  active={watched?.feeling === f.key}
                  onPress={() => onFeeling(f.key)}
                  colors={colors}
                  styles={styles}
                />
              ))}
            </View>
          </>
        )}

        {(watched || spoilerMode) && (
          <>
            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>{t.episodeDetail.comments}</Text>
            <View style={styles.commentsPlaceholder}>
              <Ionicons name="chatbubble-outline" size={18} color={colors.textFaint} />
              <Text style={styles.commentsPlaceholderText}>{t.episodeDetail.commentsSoon}</Text>
            </View>
          </>
        )}
      </Animated.View>
    </ScrollView>
  );
}

function RatingStar({
  index,
  filled,
  onPress,
  colors,
  styles,
}: {
  index: number;
  filled: boolean;
  onPress: () => void;
  colors: Colors;
  styles: EpisodeStyles;
}) {
  const { scale, onPressIn, onPressOut } = useScalePress(0.75);

  return (
    <Pressable onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress} style={styles.starCol}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Ionicons
          name={filled ? "star" : "star-outline"}
          size={28}
          color={filled ? colors.starOn : colors.starOff}
        />
      </Animated.View>
    </Pressable>
  );
}

function FeelingChip({
  emoji,
  label,
  active,
  onPress,
  colors,
  styles,
}: {
  emoji: string;
  label: string;
  active: boolean;
  onPress: () => void;
  colors: Colors;
  styles: EpisodeStyles;
}) {
  const { scale, onPressIn, onPressOut } = useScalePress(0.88);

  return (
    <Pressable onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress}>
      <Animated.View style={[styles.feelingChip, active && styles.feelingChipActive, { transform: [{ scale }] }]}>
        <Text style={styles.feelingEmoji}>{emoji}</Text>
        <Text style={[styles.feelingLabel, active && { color: colors.accent }]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
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
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  dotsRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.5)" },
  dotActive: { backgroundColor: colors.accent, width: 18, height: 6, borderRadius: 3 },
  showPill: {
    marginTop: 10,
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
  showPillText: { fontSize: 11, fontWeight: "800", color: "#111" },
  page: { flexGrow: 1 },
  hero: { height: 280, backgroundColor: "#111" },
  heroImage: { width: "100%", height: "100%", position: "absolute" },
  heroGradient: { position: "absolute", left: 0, right: 0, bottom: 0, height: 110 },
  heroBottom: { position: "absolute", left: 20, right: 20, bottom: 40 },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: 20,
  },
  code: { color: "rgba(255,255,255,0.85)", fontWeight: "700", fontSize: 13, letterSpacing: 0.3 },
  title: { fontSize: 24, fontWeight: "800", color: "#fff", marginTop: 4 },
  remainingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 16,
  },
  remainingText: { fontSize: 12, fontWeight: "700", color: colors.accent },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  metaStack: { gap: 6 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { color: colors.textMuted, fontSize: 12 },
  summary: { color: colors.text, fontSize: 14, lineHeight: 21 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 20 },
  sectionLabel: {
    textAlign: "center",
    fontWeight: "800",
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  starsRow: { flexDirection: "row", justifyContent: "center", gap: 12, marginBottom: 20 },
  starCol: { alignItems: "center" },
  feelingsRow: { flexDirection: "row", justifyContent: "space-between" },
  feelingChip: { alignItems: "center", gap: 4, padding: 8, borderRadius: radius.sm },
  feelingChipActive: { backgroundColor: colors.accentSoft },
  feelingEmoji: { fontSize: 26 },
  feelingLabel: { fontSize: 9, fontWeight: "700", color: colors.textMuted },
  commentsPlaceholder: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.backgroundAlt,
    borderRadius: radius.md,
    paddingVertical: 20,
  },
  commentsPlaceholderText: { color: colors.textFaint, fontSize: 13, fontWeight: "600" },
  unwatchedPrompt: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.backgroundAlt,
    borderRadius: radius.md,
    padding: 16,
  },
  unwatchedPromptText: { flex: 1, color: colors.textFaint, fontSize: 13, lineHeight: 18 },
  });
}
