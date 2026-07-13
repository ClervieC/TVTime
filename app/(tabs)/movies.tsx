import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, Animated, FlatList, StyleSheet, ActivityIndicator, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useFocusEffect } from "expo-router";
import { fetchUserMovies, fetchMovieWatchlist, setMovieWatched, UserMovie } from "../../lib/userMovies";
import { getMovieDetails, posterUrl, TMDBMovieDetails } from "../../lib/tmdb";
import { mapWithConcurrency } from "../../lib/concurrency";
import { diffDaysFromToday } from "../../lib/dates";
import { MovieCard } from "../../components/MovieCard";
import { EmptyState } from "../../components/EmptyState";
import { Pill } from "../../components/Pill";
import { WatchedCheck } from "../../components/WatchedCheck";
import { useColors, radius, type, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";
import { useGrowIn, useMountIn, useScalePress } from "../../lib/animations";
import { useScrollToTopOnTabPress } from "../../lib/useScrollToTopOnTabPress";

const SCREEN_PADDING = 16;
const GAP = 12;
// Target poster width matches ShowCard's 110px elsewhere in the app — fixed
// 3 columns stretched edge-to-edge looks fine on a phone but turns into
// three enormous tiles on a wide desktop-web viewport, so the column count
// grows with the available width instead of the tiles.
const TARGET_COLUMN_WIDTH = 110;

type Block =
  | { type: "header"; key: string; year: number }
  | { type: "row"; key: string; items: UserMovie[] };

type MoviesTab = "list" | "upcoming";
type UpcomingEntry = { movie: UserMovie; tmdb: TMDBMovieDetails | null };

// Mirrors app/(tabs)/profile.tsx's own reload throttle — this screen's
// useFocusEffect fires on every return to the Movies tab, and reload() was
// unconditionally refetching both collections every time, which in turn
// re-triggered the Upcoming tab's TMDB-lookup effect below even while
// sitting on the "list" sub-tab.
const MIN_RELOAD_INTERVAL_MS = 10_000;

export default function MoviesScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<MoviesTab>("list");
  const [movies, setMovies] = useState<UserMovie[]>([]);
  const [watchlist, setWatchlist] = useState<UserMovie[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingEntry[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const { width } = useWindowDimensions();
  const columns = Math.max(3, Math.floor((width - SCREEN_PADDING * 2 + GAP) / (TARGET_COLUMN_WIDTH + GAP)));
  const underlineGrow = useGrowIn(tab);
  const listRef = useRef<FlatList<Block>>(null);
  const upcomingListRef = useRef<FlatList<UpcomingEntry>>(null);
  useScrollToTopOnTabPress(() => {
    const ref = tab === "list" ? listRef : upcomingListRef;
    ref.current?.scrollToOffset({ offset: 0, animated: true });
  });

  const lastLoadedAt = useRef(0);
  const reload = useCallback(() => {
    lastLoadedAt.current = Date.now();
    Promise.all([fetchUserMovies(), fetchMovieWatchlist()])
      .then(([w, wl]) => {
        setMovies(w);
        setWatchlist(wl);
      })
      .finally(() => setLoaded(true));
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (Date.now() - lastLoadedAt.current < MIN_RELOAD_INTERVAL_MS) return;
      reload();
    }, [reload])
  );

  // Stable references (empty deps, functional setState) so MovieCard's
  // memo() can actually skip re-rendering every other card in the grid when
  // just one is unwatched/rewatched — an inline arrow function recreated on
  // every render would defeat that regardless of memo.
  const handleUnwatched = useCallback((id: string) => {
    setMovies((prev) => prev.filter((m) => m.id !== id));
  }, []);
  const handleRewatched = useCallback((updated: UserMovie) => {
    setMovies((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  }, []);

  // This tab is the personal "haven't watched yet" queue — everything added
  // to the watchlist (from Explore or a movie's detail page), regardless of
  // whether it's actually released yet. It used to only show movies with a
  // future release date, which meant most additions (anything from
  // Popular/Top Rated/In theaters — already-released movies) never showed
  // up anywhere at all. Sorted purely by release date, oldest first — since
  // not-yet-released movies have a release date in the future, this puts
  // them at the bottom automatically (soonest-releasing first among those),
  // with everything already out above them in chronological order. A
  // missing release date (no TMDB match) sorts to the very top rather than
  // being guessed at. Cross-references TMDB for release dates — resets to
  // null (not []) on every watchlist change so the tab shows a spinner
  // instead of a flash of "empty" while this resolves. Gated on the
  // "upcoming" sub-tab being active: without this, every watchlist change
  // (i.e. every reload() on focus) redid this TMDB lookup pass and flashed
  // a spinner even while the user was sitting on "list" and never opened
  // "upcoming" at all — this defers the work until the tab is actually
  // opened, at which point it fetches with whatever watchlist is current.
  useEffect(() => {
    if (tab !== "upcoming") return;
    let active = true;
    setUpcoming(null);
    mapWithConcurrency(watchlist, 4, (m) =>
      m.tmdb_id
        ? getMovieDetails(m.tmdb_id)
            .then((tmdb) => ({ movie: m, tmdb }))
            .catch(() => ({ movie: m, tmdb: null }))
        : Promise.resolve({ movie: m, tmdb: null })
    ).then((results) => {
      if (!active) return;
      results.sort((a, b) => {
        const aTime = a.tmdb?.release_date ? new Date(a.tmdb.release_date).getTime() : -Infinity;
        const bTime = b.tmdb?.release_date ? new Date(b.tmdb.release_date).getTime() : -Infinity;
        return aTime - bTime;
      });
      setUpcoming(results);
    });
    return () => {
      active = false;
    };
  }, [watchlist, tab]);

  async function handleMarkWatched(movie: UserMovie) {
    await setMovieWatched(movie.title, movie.year, true, movie.tmdb_id ?? undefined);
    reload();
  }

  // Movies already arrive sorted by watched_at descending, so grouping by
  // year and chunking each group into rows of `columns` is a single pass —
  // no re-sorting needed.
  const blocks = useMemo(() => {
    const result: Block[] = [];
    let currentYear: number | null = null;
    let row: UserMovie[] = [];
    function flushRow() {
      if (row.length > 0) {
        result.push({ type: "row", key: `row-${result.length}`, items: row });
        row = [];
      }
    }
    for (const movie of movies) {
      const year = new Date(movie.watched_at ?? movie.created_at).getFullYear();
      if (year !== currentYear) {
        flushRow();
        result.push({ type: "header", key: `year-${year}`, year });
        currentYear = year;
      }
      row.push(movie);
      if (row.length === columns) flushRow();
    }
    flushRow();
    return result;
  }, [movies, columns]);

  if (!loaded) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator color={colors.black} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={[`${colors.accent}1f`, "transparent"]} style={styles.headerGlow} />
      <View style={styles.header}>
        <Text style={styles.title}>{t.movies.title}</Text>
        {/* accent tone rather than the default neutral pillBg — neutral was
            close enough to the header gradient's own tint to nearly vanish
            into it. */}
        {tab === "list" && <Pill tone="accent">{movies.length}</Pill>}
      </View>

      <View style={styles.tabsRow}>
        <Pressable style={styles.tabBtn} onPress={() => setTab("list")}>
          <Text style={[styles.tabText, tab === "list" && styles.tabTextActive]}>{t.movies.tabList}</Text>
          {tab === "list" && <Animated.View style={[styles.tabUnderline, { transform: [{ scaleX: underlineGrow }] }]} />}
        </Pressable>
        <Pressable style={styles.tabBtn} onPress={() => setTab("upcoming")}>
          <Text style={[styles.tabText, tab === "upcoming" && styles.tabTextActive]}>{t.movies.tabUpcoming}</Text>
          {tab === "upcoming" && <Animated.View style={[styles.tabUnderline, { transform: [{ scaleX: underlineGrow }] }]} />}
        </Pressable>
      </View>

      {tab === "list" ? (
        movies.length === 0 ? (
          <View style={styles.empty}>
            <EmptyState icon="film-outline" title={t.movies.title} subtitle={t.movies.empty} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            contentContainerStyle={styles.list}
            data={blocks}
            keyExtractor={(block) => block.key}
            renderItem={({ item: block }) =>
              block.type === "header" ? (
                <View style={styles.yearHeaderRow}>
                  <Pill uppercase>{block.year}</Pill>
                </View>
              ) : (
                <View style={styles.row}>
                  {block.items.map((m) => (
                    <MovieCard
                      key={m.id}
                      id={m.id}
                      title={m.title}
                      year={m.year}
                      posterPath={m.poster_path}
                      watchedAt={m.watched_at ?? m.created_at}
                      timesWatched={m.times_watched}
                      onUnwatched={handleUnwatched}
                      onRewatched={handleRewatched}
                    />
                  ))}
                  {/* Pad an incomplete last row so its cards stay left-aligned
                      and the same width as a full row, instead of stretching. */}
                  {Array.from({ length: columns - block.items.length }, (_, i) => (
                    <View key={`spacer-${i}`} style={{ flex: 1 }} />
                  ))}
                </View>
              )
            }
          />
        )
      ) : upcoming === null ? (
        <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
      ) : upcoming.length === 0 ? (
        <View style={styles.empty}>
          <EmptyState icon="calendar-outline" title={t.movies.tabUpcoming} subtitle={t.movies.emptyUpcoming} />
        </View>
      ) : (
        <FlatList
          ref={upcomingListRef}
          contentContainerStyle={styles.upcomingList}
          data={upcoming}
          keyExtractor={(entry) => entry.movie.id}
          renderItem={({ item }) => (
            <UpcomingRow
              entry={item}
              onPress={() => item.movie.tmdb_id && router.push(`/movie/tmdb/${item.movie.tmdb_id}`)}
              onMarkWatched={() => handleMarkWatched(item.movie)}
              colors={colors}
              styles={styles}
              t={t}
            />
          )}
        />
      )}
    </View>
  );
}

type MoviesStyles = ReturnType<typeof createStyles>;

function UpcomingRow({
  entry,
  onPress,
  onMarkWatched,
  colors,
  styles,
  t,
}: {
  entry: UpcomingEntry;
  onPress: () => void;
  onMarkWatched: () => void;
  colors: Colors;
  styles: MoviesStyles;
  t: ReturnType<typeof useLanguage>["t"];
}) {
  const { scale, onPressIn, onPressOut } = useScalePress();
  const mountIn = useMountIn();
  const poster = entry.tmdb ? posterUrl(entry.tmdb.poster_path, "w200") : null;
  const releaseTime = entry.tmdb?.release_date ? new Date(entry.tmdb.release_date).getTime() : null;
  const isFuture = releaseTime !== null && releaseTime > Date.now();
  const releaseDate = releaseTime
    ? new Date(releaseTime).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
    : null;
  // Mirrors EpisodeRow's daysAway treatment — a day-count badge takes the
  // checkmark's spot for not-yet-released movies, since there's nothing to
  // mark watched yet; the checkmark returns once it's actually out.
  const daysUntil = isFuture && entry.tmdb ? diffDaysFromToday(entry.tmdb.release_date) : null;

  return (
    <Pressable onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress}>
      <Animated.View
        style={[styles.upcomingRow, { opacity: mountIn.opacity, transform: [...mountIn.transform, { scale }] }]}
      >
        {poster ? (
          <Image source={{ uri: poster }} style={styles.upcomingPoster} contentFit="cover" />
        ) : (
          <View style={[styles.upcomingPoster, styles.upcomingPosterPlaceholder]}>
            <Text style={styles.upcomingPlaceholderText}>{entry.movie.title[0]?.toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.upcomingTitle} numberOfLines={1}>
            {entry.movie.title}
          </Text>
          {/* Only not-yet-released movies get a release-date line — an
              already-released one just sits in the queue with nothing more
              to say about it until it's actually watched. */}
          {isFuture && releaseDate && <Text style={styles.upcomingRelease}>{t.movies.releasesOn(releaseDate)}</Text>}
        </View>
        {daysUntil !== null ? (
          <View style={styles.upcomingDaysCol}>
            <Text style={styles.upcomingDaysNumber}>{daysUntil}</Text>
            <Text style={styles.upcomingDaysLabel}>{t.episodeRow.days}</Text>
          </View>
        ) : (
          <WatchedCheck watched={false} onToggle={onMarkWatched} size={26} />
        )}
      </Animated.View>
    </Pressable>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    headerGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 140, pointerEvents: "none" },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 16,
      paddingTop: 20,
      paddingBottom: 4,
    },
    title: { fontSize: type.title, fontWeight: "800", color: colors.text },
    tabsRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      marginTop: 10,
    },
    tabBtn: { flex: 1, alignItems: "center", paddingVertical: 12 },
    tabText: { fontWeight: "800", fontSize: 13, color: colors.textFaint, letterSpacing: 0.4 },
    tabTextActive: { color: colors.accent },
    tabUnderline: { height: 2, backgroundColor: colors.accent, width: "60%", marginTop: 6 },
    list: { padding: 16, paddingTop: 4 },
    yearHeaderRow: { paddingTop: 20, paddingBottom: 12 },
    row: { flexDirection: "row", gap: 12, marginBottom: 20 },
    empty: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
    upcomingList: { padding: 16 },
    upcomingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: 10,
      marginBottom: 10,
    },
    upcomingPoster: { width: 52, height: 74, borderRadius: radius.sm, backgroundColor: colors.backgroundAlt },
    upcomingPosterPlaceholder: { alignItems: "center", justifyContent: "center" },
    upcomingPlaceholderText: { color: colors.textFaint, fontSize: type.title, fontWeight: "800" },
    upcomingTitle: { fontWeight: "700", fontSize: type.body, color: colors.text },
    upcomingRelease: { fontSize: type.caption, color: colors.textMuted, marginTop: 2 },
    upcomingDaysCol: { alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
    upcomingDaysNumber: { fontWeight: "800", fontSize: type.title, color: colors.text },
    upcomingDaysLabel: { fontSize: type.micro, fontWeight: "700", color: colors.textMuted, marginTop: 1 },
  });
}
