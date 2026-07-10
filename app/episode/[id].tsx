import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Animated,
  StyleSheet,
  Image,
  ActivityIndicator,
  Share,
  Platform,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Gesture, GestureDetector, ScrollView as GestureScrollView } from "react-native-gesture-handler";
import Reanimated from "react-native-reanimated";
import {
  getShow,
  getShowCast,
  getShowEpisodes,
  CastMember,
  TVMazeEpisode,
  TVMazeShow,
} from "../../lib/tvmaze";
import {
  getCachedEpisodes,
  getCachedShow,
  getCachedWatchedEpisodes,
} from "../../lib/showDataCache";
import {
  fetchEpisodeFeelingCounts,
  fetchWatchedEpisodes,
  incrementRewatch,
  rateEpisode,
  setEpisodeFavorite,
  setEpisodeWatched,
  WatchedEpisode,
} from "../../lib/userShows";
import { useColors, radius, type, Colors } from "../../lib/theme";
import { useLanguage, Translations } from "../../lib/i18n";
import {
  useScalePress,
  useMountIn,
  useSwipeDownToDismiss,
  useSwipeHorizontal,
} from "../../lib/animations";
import { WatchedCheck } from "../../components/WatchedCheck";
import { CommentsSection } from "../../components/CommentsSection";
import { CharacterVote } from "../../components/CharacterVote";
import { ReportModal } from "../../components/ReportModal";
import { getCurrentUserId } from "../../lib/supabase";
import { useGoBack } from "../../lib/useGoBack";
import {
  deleteComment,
  fetchEpisodeComments,
  postEpisodeComment,
  toggleCommentReaction,
  EnrichedComment,
} from "../../lib/comments";
import {
  fetchCharacterVotes,
  removeCharacterVote,
  voteForCharacter,
  CharacterVoteTally,
} from "../../lib/characterVotes";
import { FEELING_EMOJIS } from "../../lib/feelings";

const MAX_DOTS = 5;
const SIDEBAR_WIDTH = 340;
// Left/right offset (16) + button width (44) + a small gap, so the floating
// prev/next buttons on desktop web never sit on top of text.
const SIDE_NAV_INSET = 76;
const SIDEBAR_HEADER_HEIGHT = 32;
const SIDEBAR_ROW_HEIGHT = 72;

function stripHtml(html: string | null) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "");
}

export default function EpisodeDetailScreen() {
  const { id, showId } = useLocalSearchParams<{ id: string; showId: string }>();
  const router = useRouter();
  const goBack = useGoBack("/(tabs)");
  const { width } = useWindowDimensions();
  const showIdNum = Number(showId);
  const initialEpisodeId = Number(id);

  const [show, setShow] = useState<TVMazeShow | null>(null);
  const [episodes, setEpisodes] = useState<TVMazeEpisode[]>([]);
  const [cast, setCast] = useState<CastMember[]>([]);
  const [watchedMap, setWatchedMap] = useState<
    Record<number, WatchedEpisode | null>
  >({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reporting, setReporting] = useState(false);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t, spoilerMode } = useLanguage();
  // A horizontally-paged list with vertical scrolling content nested inside
  // each page is fragile with real touch input — getting a Pan-based swipe
  // gesture, a nested scroll view, and a native horizontal pager to all
  // agree on who owns a given touch turned out not to be reliably fixable
  // (see git history on this file for the escalating attempts). Only the
  // current episode is ever rendered instead, with a dedicated swipe gesture
  // scoped to the hero image driving next/previous directly — no nested
  // scrollable pager at all, so there's nothing left to compete with the
  // page's own vertical scroll. Desktop web is the one exception: mouse/
  // keyboard input has no swipe gesture to begin with, so it gets a sidebar
  // + prev/next buttons instead (see isDesktopWeb below).
  const isDesktopWeb = Platform.OS === "web" && width >= 700;

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);

      // Episodes + watched status are the only two things this page actually
      // needs to render and position itself correctly, and both are already
      // warm from the Watch List's own background load for every "watching"
      // show — so this resolves near-instantly in the common case of opening
      // an episode from there. The show object (used only for the small pill
      // above the title) and cast (used only by the vote section, well below
      // the fold) are never prefetched anywhere, so gating the whole page on
      // them turned every episode open into a fresh cold TVmaze round trip on
      // top of data we already had. Let those two populate whenever they're
      // ready instead of blocking first paint on them.
      Promise.all([
        showIdNum
          ? getCachedEpisodes(showIdNum, () => getShowEpisodes(showIdNum))
          : Promise.resolve([]),
        showIdNum
          ? getCachedWatchedEpisodes(showIdNum, () =>
              fetchWatchedEpisodes(showIdNum),
            )
          : Promise.resolve([]),
      ]).then(([eps, watchedList]) => {
        if (!active) return;
        setEpisodes(eps);
        const map: Record<number, WatchedEpisode | null> = {};
        for (const w of watchedList) map[w.tvmaze_episode_id] = w;
        setWatchedMap(map);
        const idx = eps.findIndex((e) => e.id === initialEpisodeId);
        setCurrentIndex(idx >= 0 ? idx : 0);
        setLoading(false);
      });

      if (showIdNum) {
        getCachedShow(showIdNum, () => getShow(showIdNum)).then(
          (sh) => active && setShow(sh),
        );
        getShowCast(showIdNum)
          .then((c) => active && setCast(c))
          .catch(() => {});
      }

      return () => {
        active = false;
      };
    }, [initialEpisodeId, showIdNum]),
  );

  // Only used by the desktop sidebar, but computed unconditionally since
  // hooks can't be called after the early loading return below.
  const seasonGroups = useMemo(() => {
    const bySeason = new Map<number, TVMazeEpisode[]>();
    for (const ep of episodes) {
      if (!bySeason.has(ep.season)) bySeason.set(ep.season, []);
      bySeason.get(ep.season)!.push(ep);
    }
    return [...bySeason.entries()].sort((a, b) => a[0] - b[0]);
  }, [episodes]);

  function goToIndex(i: number) {
    setCurrentIndex(Math.max(0, Math.min(episodes.length - 1, i)));
  }

  // Desktop web only (see isDesktopWeb below) — left/right arrow keys move
  // between episodes the same way the on-screen prev/next buttons do.
  useEffect(() => {
    if (!isDesktopWeb) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") goToIndex(currentIndex - 1);
      else if (e.key === "ArrowRight") goToIndex(currentIndex + 1);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isDesktopWeb, currentIndex, episodes.length]);

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
    // Tapping the star that's already the current rating clears it instead
    // of re-setting the same value — otherwise there was no way to remove a
    // rating once given short of re-watching the episode.
    const next = current.rating === value ? null : value;
    await rateEpisode(showIdNum, episode.id, next, current.feeling);
    setWatchedMap((prev) => ({
      ...prev,
      [episode.id]: { ...current, rating: next },
    }));
  }

  async function toggleFavorite(episode: TVMazeEpisode) {
    const current = watchedMap[episode.id];
    if (!current) return;
    const next = !current.is_favorite;
    await setEpisodeFavorite(showIdNum, episode.id, next);
    setWatchedMap((prev) => ({
      ...prev,
      [episode.id]: { ...current, is_favorite: next },
    }));
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
    await rateEpisode(showIdNum, episode.id, current.rating, next);
    setWatchedMap((prev) => ({
      ...prev,
      [episode.id]: { ...current, feeling: next },
    }));
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
  const dotIndices = Array.from(
    { length: dotEnd - dotStart },
    (_, i) => dotStart + i,
  );

  if (isDesktopWeb) {
    const currentEpisode = episodes[currentIndex];
    const mainWidth = width - SIDEBAR_WIDTH;
    const atStart = currentIndex === 0;
    const atEnd = currentIndex === episodes.length - 1;
    return (
      <View style={styles.container}>
        <View
          style={[styles.overlay, { right: SIDEBAR_WIDTH }]}
          pointerEvents="box-none"
        >
          <View style={styles.overlayTopRow}>
            <Pressable
              style={styles.iconBtn}
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="chevron-down" size={22} color="#fff" />
            </Pressable>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                style={styles.iconBtn}
                onPress={() => shareEpisode(currentEpisode)}
                accessibilityRole="button"
                accessibilityLabel="Share"
              >
                <Ionicons name="share-outline" size={20} color="#fff" />
              </Pressable>
              <Pressable
                style={styles.iconBtn}
                onPress={() => setReporting(true)}
                accessibilityRole="button"
                accessibilityLabel={t.report.reportEpisode}
              >
                <Ionicons name="flag-outline" size={18} color="#fff" />
              </Pressable>
            </View>
          </View>
          {show && (
            <Pressable
              style={styles.showPill}
              onPress={() => router.push(`/show/${show.id}`)}
            >
              <Text style={styles.showPillText}>{show.name.toUpperCase()}</Text>
              <Ionicons name="chevron-forward" size={12} color="#111" />
            </Pressable>
          )}
        </View>

        <Pressable
          style={[
            styles.sideNavBtn,
            styles.sideNavBtnLeft,
            atStart && styles.sideNavBtnDisabled,
          ]}
          onPress={() => goToIndex(currentIndex - 1)}
          disabled={atStart}
          accessibilityRole="button"
          accessibilityLabel="Previous episode"
        >
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <Pressable
          style={[
            styles.sideNavBtn,
            styles.sideNavBtnRight,
            atEnd && styles.sideNavBtnDisabled,
          ]}
          onPress={() => goToIndex(currentIndex + 1)}
          disabled={atEnd}
          accessibilityRole="button"
          accessibilityLabel="Next episode"
        >
          <Ionicons name="chevron-forward" size={22} color="#fff" />
        </Pressable>

        <View style={styles.desktopLayout}>
          <View style={{ width: mainWidth }}>
            <EpisodePage
              key={currentEpisode.id}
              episode={currentEpisode}
              showId={showIdNum}
              cast={cast}
              width={mainWidth}
              watched={watchedMap[currentEpisode.id] ?? null}
              remaining={remaining}
              spoilerMode={spoilerMode}
              sideInset={SIDE_NAV_INSET}
              onToggleWatched={() => toggleWatched(currentEpisode)}
              onRewatch={() => rewatchEpisode(currentEpisode)}
              onRate={(n) => setRating(currentEpisode, n)}
              onFeeling={(key) => setFeeling(currentEpisode, key)}
              onToggleFavorite={() => toggleFavorite(currentEpisode)}
              colors={colors}
              styles={styles}
              t={t}
            />
          </View>
          <EpisodeSidebar
            seasonGroups={seasonGroups}
            currentIndex={currentIndex}
            watchedMap={watchedMap}
            onSelect={goToIndex}
            colors={colors}
            styles={styles}
            t={t}
          />
        </View>
        <ReportModal
          visible={reporting}
          onClose={() => setReporting(false)}
          target={{
            targetType: "episode",
            targetTvmazeShowId: showIdNum,
            targetTvmazeEpisodeId: currentEpisode.id,
          }}
        />
      </View>
    );
  }

  // Everything that isn't desktop web (native iOS/Android, and mobile web)
  // shares this one render: a single current episode, no horizontal pager.
  // Swiping to the next/previous episode goes through the hero-scoped
  // gesture (see useSwipeHorizontal in lib/animations.ts) driving goToIndex
  // directly, with no scrollable horizontal container involved at all — see
  // the isDesktopWeb comment above for why that matters.
  const currentEpisode = episodes[currentIndex];
  return (
    <View style={styles.container}>
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.overlayTopRow}>
          <Pressable
            style={styles.iconBtn}
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="chevron-down" size={22} color="#fff" />
          </Pressable>
          <View style={[styles.dotsRow, { flex: 1, justifyContent: "center" }]}>
            {dotIndices.map((i) => (
              <View
                key={i}
                style={[styles.dot, i === currentIndex && styles.dotActive]}
              />
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              style={styles.iconBtn}
              onPress={() => shareEpisode(currentEpisode)}
              accessibilityRole="button"
              accessibilityLabel="Share"
            >
              <Ionicons name="share-outline" size={20} color="#fff" />
            </Pressable>
            <Pressable
              style={styles.iconBtn}
              onPress={() => setReporting(true)}
              accessibilityRole="button"
              accessibilityLabel={t.report.reportEpisode}
            >
              <Ionicons name="flag-outline" size={18} color="#fff" />
            </Pressable>
          </View>
        </View>
        {show && (
          <Pressable
            style={styles.showPill}
            onPress={() => router.push(`/show/${show.id}`)}
          >
            <Text style={styles.showPillText}>{show.name.toUpperCase()}</Text>
            <Ionicons name="chevron-forward" size={12} color="#111" />
          </Pressable>
        )}
      </View>

      <EpisodePage
        key={currentEpisode.id}
        episode={currentEpisode}
        showId={showIdNum}
        cast={cast}
        width={width}
        watched={watchedMap[currentEpisode.id] ?? null}
        remaining={remaining}
        spoilerMode={spoilerMode}
        onToggleWatched={() => toggleWatched(currentEpisode)}
        onRewatch={() => rewatchEpisode(currentEpisode)}
        onRate={(n) => setRating(currentEpisode, n)}
        onFeeling={(key) => setFeeling(currentEpisode, key)}
        onToggleFavorite={() => toggleFavorite(currentEpisode)}
        onSwipeNext={() => goToIndex(currentIndex + 1)}
        onSwipePrev={() => goToIndex(currentIndex - 1)}
        colors={colors}
        styles={styles}
        t={t}
      />
      <ReportModal
        visible={reporting}
        onClose={() => setReporting(false)}
        target={{
          targetType: "episode",
          targetTvmazeShowId: showIdNum,
          targetTvmazeEpisodeId: currentEpisode.id,
        }}
      />
    </View>
  );
}

type EpisodeStyles = ReturnType<typeof createStyles>;

type SidebarRow =
  | { type: "header"; season: number }
  | { type: "episode"; episode: TVMazeEpisode; index: number };

function EpisodeSidebar({
  seasonGroups,
  currentIndex,
  watchedMap,
  onSelect,
  colors,
  styles,
  t,
}: {
  seasonGroups: [number, TVMazeEpisode[]][];
  currentIndex: number;
  watchedMap: Record<number, WatchedEpisode | null>;
  onSelect: (index: number) => void;
  colors: Colors;
  styles: EpisodeStyles;
  t: Translations;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const hasScrolledOnce = useRef(false);

  // Fixed row heights let the currently open episode be scrolled into view
  // by computed offset, without waiting on onLayout measurement.
  const { rows, currentOffset } = useMemo(() => {
    const rows: SidebarRow[] = [];
    let index = 0;
    for (const [season, eps] of seasonGroups) {
      rows.push({ type: "header", season });
      for (const ep of eps) {
        rows.push({ type: "episode", episode: ep, index });
        index += 1;
      }
    }
    let acc = 0;
    let currentOffset = 0;
    for (const row of rows) {
      if (row.type === "episode" && row.index === currentIndex)
        currentOffset = acc;
      acc += row.type === "header" ? SIDEBAR_HEADER_HEIGHT : SIDEBAR_ROW_HEIGHT;
    }
    return { rows, currentOffset };
  }, [seasonGroups, currentIndex]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      y: Math.max(0, currentOffset - SIDEBAR_ROW_HEIGHT * 2),
      animated: hasScrolledOnce.current,
    });
    hasScrolledOnce.current = true;
  }, [currentOffset]);

  return (
    <View style={styles.sidebar}>
      <Text style={styles.sidebarTitle}>{t.showDetail.episodes}</Text>
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false}>
        {rows.map((row) => {
          if (row.type === "header") {
            return (
              <Text key={`h-${row.season}`} style={styles.sidebarSeasonHeader}>
                {t.showDetail.season(row.season)}
              </Text>
            );
          }
          const ep = row.episode;
          const selected = row.index === currentIndex;
          const isWatched = !!watchedMap[ep.id];
          return (
            <Pressable
              key={ep.id}
              style={[styles.sidebarRow, selected && styles.sidebarRowActive]}
              onPress={() => onSelect(row.index)}
            >
              {ep.image ? (
                <Image
                  source={{ uri: ep.image.medium }}
                  style={styles.sidebarThumb}
                />
              ) : (
                <View
                  style={[
                    styles.sidebarThumb,
                    { backgroundColor: colors.backgroundAlt },
                  ]}
                />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.sidebarEpisodeCode}>
                  S{String(ep.season).padStart(2, "0")}E
                  {String(ep.number).padStart(2, "0")}
                </Text>
                <Text style={styles.sidebarEpisodeTitle} numberOfLines={1}>
                  {ep.name}
                </Text>
              </View>
              {isWatched && (
                <Ionicons
                  name="checkmark-circle"
                  size={16}
                  color={colors.green}
                />
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function EpisodePage({
  episode,
  showId,
  cast,
  width,
  watched,
  remaining,
  spoilerMode,
  sideInset,
  onToggleWatched,
  onRewatch,
  onRate,
  onFeeling,
  onToggleFavorite,
  onSwipeNext,
  onSwipePrev,
  colors,
  styles,
  t,
}: {
  episode: TVMazeEpisode;
  showId: number;
  cast: CastMember[];
  width: number;
  watched: WatchedEpisode | null;
  remaining: number | null;
  spoilerMode: boolean;
  sideInset?: number;
  onToggleWatched: () => void;
  onRewatch: () => void;
  onRate: (value: number) => void;
  onFeeling: (key: string) => void;
  onToggleFavorite: () => void;
  onSwipeNext?: () => void;
  onSwipePrev?: () => void;
  colors: Colors;
  styles: EpisodeStyles;
  t: Translations;
}) {
  const bodyIn = useMountIn();
  const unlocked = !!watched || spoilerMode;
  const goBack = useGoBack("/(tabs)");
  const { gesture: swipeDownGesture, animatedStyle: swipeDownStyle } =
    useSwipeDownToDismiss(goBack);
  // Swiping left means "go to next episode", right means previous.
  const swipeHorizontalGesture = useSwipeHorizontal(
    () => onSwipeNext?.(),
    () => onSwipePrev?.()
  );
  // Desktop web doesn't pass onSwipeNext/onSwipePrev — it navigates with the
  // sidebar and prev/next buttons instead (see the isDesktopWeb branch in
  // EpisodeDetailScreen), so there's nothing for the horizontal gesture to do.
  const canSwipeHorizontally = !!(onSwipeNext || onSwipePrev);
  // Both gestures are scoped to the hero image only, not the whole scrollable
  // page — on web this matters a lot more than the activeOffsetX/failOffsetY
  // locking suggests: react-native-gesture-handler's web backend expresses a
  // Pan gesture's directions as a static CSS touch-action on the element it's
  // attached to, which the browser commits to upfront rather than releasing
  // mid-touch the way a native recognizer can. Wrapping the *entire*
  // vertically-scrolling page in this gesture was quietly telling mobile
  // Safari not to hand any touch there to native scrolling at all, no matter
  // what the gesture's own JS-side logic decided — hence swiping not
  // scrolling anywhere on the page, not just over the hero. Keeping both
  // gestures confined to the small hero area means only that area is ever
  // subject to that restriction; everything below it is a plain native touch
  // scroll with no gesture-handler involvement whatsoever.
  const heroGesture = canSwipeHorizontally
    ? Gesture.Race(swipeDownGesture, swipeHorizontalGesture)
    : swipeDownGesture;

  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [comments, setComments] = useState<EnrichedComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [feelingCounts, setFeelingCounts] = useState<Record<string, number>>(
    {},
  );
  const [voteTally, setVoteTally] = useState<CharacterVoteTally[]>([]);
  const [myCharacterId, setMyCharacterId] = useState<number | null>(null);
  // Tracks the feeling feelingCounts was last reconciled against — either
  // the server fetch below, or this device's own most recent toggle — so the
  // effect further down can tell "the user just changed their feeling" apart
  // from "the fetch below just landed with this same value already baked in"
  // and avoid double-counting either way.
  const lastCountedFeeling = useRef<string | null>(watched?.feeling ?? null);

  // Comments/votes/feelings are spoiler-sensitive, same as the rest of this
  // gated section — nothing is fetched until the episode is unlocked.
  useEffect(() => {
    if (!unlocked) return;
    let isCurrent = true;
    getCurrentUserId().then((id) => isCurrent && setMyUserId(id ?? null));
    setCommentsLoading(true);
    fetchEpisodeComments(episode.id)
      .then((data) => isCurrent && setComments(data))
      .finally(() => isCurrent && setCommentsLoading(false));
    fetchEpisodeFeelingCounts(episode.id).then((data) => {
      if (!isCurrent) return;
      setFeelingCounts(data);
      lastCountedFeeling.current = watched?.feeling ?? null;
    });
    fetchCharacterVotes(episode.id).then(({ tally, myCharacterId: mine }) => {
      if (!isCurrent) return;
      setVoteTally(tally);
      setMyCharacterId(mine);
    });
    return () => {
      isCurrent = false;
    };
  }, [unlocked, episode.id]);

  // Reflects the user's own feeling toggle in "How others felt" immediately
  // instead of waiting for the next full page load — fetchEpisodeFeelingCounts
  // above only ever runs once per episode/unlock, so without this the tally
  // stayed stale until a hard refresh. Diffs against lastCountedFeeling
  // (rather than always subtracting/adding blindly) so the one-time sync from
  // the fetch above doesn't get double-counted as a toggle.
  useEffect(() => {
    const next = watched?.feeling ?? null;
    const prev = lastCountedFeeling.current;
    if (prev === next) return;
    lastCountedFeeling.current = next;
    setFeelingCounts((counts) => {
      const updated = { ...counts };
      if (prev) updated[prev] = Math.max(0, (updated[prev] ?? 0) - 1);
      if (next) updated[next] = (updated[next] ?? 0) + 1;
      return updated;
    });
  }, [watched?.feeling]);

  async function handlePostComment(body: string) {
    await postEpisodeComment(showId, episode.id, body);
    setComments(await fetchEpisodeComments(episode.id));
  }

  function handleDeleteComment(id: string) {
    setComments((prev) => prev.filter((c) => c.id !== id));
    deleteComment(id).catch(() =>
      fetchEpisodeComments(episode.id).then(setComments),
    );
  }

  function handleToggleReaction(id: string, currentlyReacted: boolean) {
    setComments((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              reactedByMe: !currentlyReacted,
              reactionCount: c.reactionCount + (currentlyReacted ? -1 : 1),
            }
          : c,
      ),
    );
    toggleCommentReaction(id, currentlyReacted).catch(() =>
      fetchEpisodeComments(episode.id).then(setComments),
    );
  }

  async function handleVote(member: CastMember) {
    const choice = {
      personId: member.person.id,
      personName: member.person.name,
      personImage: member.person.image?.medium ?? null,
      characterId: member.character.id,
      characterName: member.character.name,
    };
    const previousCharacterId = myCharacterId;
    setMyCharacterId(member.character.id);
    try {
      await voteForCharacter(showId, episode.id, choice);
    } catch {
      // Roll back the optimistic selection — the server never recorded it.
      setMyCharacterId(previousCharacterId);
      return;
    }
    // The vote is recorded either way now — a failure here only means the
    // tally display is stale, not that the vote itself should be undone.
    fetchCharacterVotes(episode.id)
      .then((res) => setVoteTally(res.tally))
      .catch(() => {});
  }

  async function handleRemoveVote() {
    const previousCharacterId = myCharacterId;
    setMyCharacterId(null);
    try {
      await removeCharacterVote(episode.id);
    } catch {
      setMyCharacterId(previousCharacterId);
      return;
    }
    fetchCharacterVotes(episode.id)
      .then((res) => setVoteTally(res.tally))
      .catch(() => {});
  }

  return (
    <GestureScrollView
      style={{ width, height: "100%" }}
      contentContainerStyle={styles.page}
      showsVerticalScrollIndicator={false}
    >
      <GestureDetector gesture={heroGesture}>
        <Reanimated.View style={[styles.hero, swipeDownStyle]}>
          {episode.image ? (
            <Image
              source={{ uri: episode.image.original }}
              style={styles.heroImage}
            />
          ) : (
            <View
              style={[
                styles.heroImage,
                { backgroundColor: colors.backgroundAlt },
              ]}
            />
          )}
          <LinearGradient
            colors={["transparent", colors.background]}
            style={styles.heroGradient}
            pointerEvents="none"
          />
          <View style={styles.heroBottom}>
            <Text style={styles.code}>
              S{String(episode.season).padStart(2, "0")} · E
              {String(episode.number).padStart(2, "0")}
            </Text>
            <Text style={styles.title}>{episode.name}</Text>
          </View>
        </Reanimated.View>
      </GestureDetector>

      <Animated.View
        style={[
          styles.sheet,
          sideInset
            ? { paddingLeft: sideInset, paddingRight: sideInset }
            : null,
          { opacity: bodyIn.opacity, transform: bodyIn.transform },
        ]}
      >
        {remaining !== null && (
          <View style={styles.remainingBadge}>
            <Ionicons name="film-outline" size={13} color={colors.accent} />
            <Text style={styles.remainingText}>
              {remaining === 0
                ? t.episodeDetail.remainingAll
                : t.episodeDetail.remaining(remaining)}
            </Text>
          </View>
        )}

        <View style={styles.metaRow}>
          <View style={styles.metaStack}>
            <View style={styles.metaItem}>
              <Ionicons
                name="calendar-outline"
                size={14}
                color={colors.textMuted}
              />
              <Text style={styles.metaText}>{episode.airdate}</Text>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="eye-outline" size={14} color={colors.textMuted} />
              <Text style={styles.metaText}>
                {watched
                  ? watched.watched_at?.slice(0, 10)
                  : t.episodeDetail.notWatched}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {watched && (
              <Pressable
                onPress={onToggleFavorite}
                accessibilityRole="button"
                accessibilityLabel={watched.is_favorite ? t.episodeDetail.removeFavorite : t.episodeDetail.addFavorite}
                hitSlop={8}
              >
                <Ionicons
                  name={watched.is_favorite ? "heart" : "heart-outline"}
                  size={24}
                  color={watched.is_favorite ? colors.red : colors.textMuted}
                />
              </Pressable>
            )}
            <WatchedCheck
              watched={!!watched}
              timesWatched={watched?.times_watched}
              onToggle={onToggleWatched}
              onRewatch={onRewatch}
              size={40}
            />
          </View>
        </View>

        {episode.summary && (
          <Text style={styles.summary}>{stripHtml(episode.summary)}</Text>
        )}

        {!watched && (
          <>
            <View style={styles.divider} />
            <View style={styles.unwatchedPrompt}>
              <Ionicons
                name="lock-closed-outline"
                size={20}
                color={colors.textFaint}
              />
              <Text style={styles.unwatchedPromptText}>
                {t.episodeDetail.unwatchedPrompt}
              </Text>
            </View>
          </>
        )}

        {watched && (
          <>
            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>
              {t.episodeDetail.yourRating}
            </Text>
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

            <Text style={styles.sectionLabel}>
              {t.episodeDetail.howDidYouFeel}
            </Text>
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

        {unlocked && (
          <>
            {Object.keys(feelingCounts).length > 0 && (
              <>
                <View style={styles.divider} />
                <Text style={styles.sectionLabel}>
                  {t.episodeDetail.othersFelt}
                </Text>
                <View style={styles.feelingsRow}>
                  {FEELING_EMOJIS.filter((f) => feelingCounts[f.key] > 0).map(
                    (f) => (
                      <View key={f.key} style={styles.feelingTally}>
                        <Text style={styles.feelingEmoji}>{f.emoji}</Text>
                        <Text style={styles.feelingTallyCount}>
                          {feelingCounts[f.key]}
                        </Text>
                      </View>
                    ),
                  )}
                </View>
              </>
            )}

            {cast.length > 0 && (
              <>
                <View style={styles.divider} />
                <CharacterVote
                  cast={cast}
                  tally={voteTally}
                  myCharacterId={myCharacterId}
                  onVote={handleVote}
                  onRemoveVote={handleRemoveVote}
                />
              </>
            )}

            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>{t.episodeDetail.comments}</Text>
            <CommentsSection
              comments={comments}
              loading={commentsLoading}
              myUserId={myUserId}
              onSubmit={handlePostComment}
              onDelete={handleDeleteComment}
              onToggleReaction={handleToggleReaction}
              reportTargetType="comment"
            />
          </>
        )}
      </Animated.View>
    </GestureScrollView>
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
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={onPress}
      style={styles.starCol}
      accessibilityRole="button"
      accessibilityLabel={`Rate ${index} star${index > 1 ? "s" : ""}`}
    >
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
      <Animated.View
        style={[
          styles.feelingChip,
          active && styles.feelingChipActive,
          { transform: [{ scale }] },
        ]}
      >
        <Text style={styles.feelingEmoji}>{emoji}</Text>
        <Text style={[styles.feelingLabel, active && { color: colors.accent }]}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.background,
    },
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
      borderRadius: radius.pill,
      backgroundColor: "rgba(0,0,0,0.35)",
      alignItems: "center",
      justifyContent: "center",
    },
    dotsRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    sideNavBtn: {
      position: "absolute",
      top: "50%",
      marginTop: -22,
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      backgroundColor: "rgba(0,0,0,0.35)",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 15,
    },
    sideNavBtnLeft: { left: 16 },
    sideNavBtnRight: { right: SIDEBAR_WIDTH + 16 },
    sideNavBtnDisabled: { opacity: 0.3 },
    desktopLayout: { flex: 1, flexDirection: "row" },
    sidebar: {
      width: SIDEBAR_WIDTH,
      borderLeftWidth: 1,
      borderLeftColor: colors.border,
      backgroundColor: colors.background,
      paddingTop: 20,
    },
    sidebarTitle: {
      fontSize: type.subtitle,
      fontWeight: "800",
      color: colors.text,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    sidebarSeasonHeader: {
      fontSize: 11,
      fontWeight: "800",
      color: colors.textMuted,
      letterSpacing: 0.5,
      paddingHorizontal: 16,
      height: SIDEBAR_HEADER_HEIGHT,
      lineHeight: SIDEBAR_HEADER_HEIGHT,
    },
    sidebarRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      height: SIDEBAR_ROW_HEIGHT,
      paddingHorizontal: 16,
    },
    sidebarRowActive: { backgroundColor: colors.accentSoft },
    sidebarThumb: {
      width: 72,
      height: 48,
      borderRadius: radius.sm,
      backgroundColor: colors.backgroundAlt,
    },
    sidebarEpisodeCode: {
      fontSize: 11,
      fontWeight: "800",
      color: colors.textMuted,
    },
    sidebarEpisodeTitle: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.text,
      marginTop: 2,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: "rgba(255,255,255,0.5)",
    },
    dotActive: {
      backgroundColor: colors.accent,
      width: 18,
      height: 6,
      borderRadius: 3,
    },
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
    heroGradient: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      height: 110,
    },
    heroBottom: { position: "absolute", left: 20, right: 20, bottom: 40 },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: 20,
    },
    code: {
      color: "rgba(255,255,255,0.85)",
      fontWeight: "700",
      fontSize: 13,
      letterSpacing: 0.3,
    },
    title: {
      fontSize: type.display,
      fontWeight: "800",
      color: "#fff",
      marginTop: 4,
    },
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
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 16,
    },
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
    starsRow: {
      flexDirection: "row",
      justifyContent: "center",
      gap: 12,
      marginBottom: 20,
    },
    starCol: { alignItems: "center" },
    feelingsRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 4 },
    feelingChip: {
      alignItems: "center",
      gap: 4,
      padding: 8,
      borderRadius: radius.sm,
    },
    feelingChipActive: { backgroundColor: colors.accentSoft },
    feelingEmoji: { fontSize: 26 },
    feelingLabel: {
      fontSize: type.micro,
      fontWeight: "700",
      color: colors.textMuted,
    },
    feelingTally: { alignItems: "center", gap: 4, padding: 8 },
    feelingTallyCount: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.textMuted,
    },
    unwatchedPrompt: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.backgroundAlt,
      borderRadius: radius.md,
      padding: 16,
    },
    unwatchedPromptText: {
      flex: 1,
      color: colors.textFaint,
      fontSize: 13,
      lineHeight: 18,
    },
  });
}
