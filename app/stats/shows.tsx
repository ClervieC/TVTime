import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet, ImageStyle, ViewStyle } from "react-native";
import { Image } from "expo-image";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { computeShowStats, fetchCachedShowStats, loadLocalShowStats, saveShowStats, ShowStats, TopMovie } from "../../lib/showStats";
import { posterUrl, searchMovie } from "../../lib/tmdb";
import { useColors, radius, type, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";
import { EmptyState } from "../../components/EmptyState";
import { useGoBack } from "../../lib/useGoBack";

// Cached stats older than this get silently recomputed in the background on
// open (see fetchCachedShowStats/saveShowStats in lib/showStats.ts) — fresh
// enough that a stat rarely feels stale, without recomputing (several TVmaze
// calls + a full watched_episodes scan) on every single visit.
const STATS_TTL_MS = 6 * 60 * 60 * 1000;

export default function ShowStatsScreen() {
  const router = useRouter();
  const { tab: initialTabParam } = useLocalSearchParams<{ tab?: string }>();
  const goBack = useGoBack("/(tabs)/profile");
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t, language } = useLanguage();
  const [stats, setStats] = useState<ShowStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"shows" | "movies">(initialTabParam === "movies" ? "movies" : "shows");

  useFocusEffect(
    useCallback(() => {
      let active = true;
      // Local IndexedDB read first — no network round trip, so this paints
      // before fetchCachedShowStats() (Supabase) even resolves, and still
      // works offline. Supabase stays authoritative below since it's what
      // syncs across a user's devices; this is just the same-device fast path.
      loadLocalShowStats().then((local) => {
        if (active && local) setStats(local);
      });
      fetchCachedShowStats().then((cached) => {
        if (!active) return;
        if (cached) setStats(cached);
        const isStale = !cached || Date.now() - new Date(cached.computedAt).getTime() > STATS_TTL_MS;
        if (!isStale) return;
        setRefreshing(true);
        computeShowStats()
          .then((fresh) => {
            if (!active) return;
            setStats(fresh);
            saveShowStats(fresh).catch(() => {});
          })
          .finally(() => active && setRefreshing(false));
      });
      return () => {
        active = false;
      };
    }, [])
  );

  // Defensive fallbacks throughout below: a cache row from a since-changed
  // ShowStats shape is meant to be filtered out by fetchCachedShowStats()'s
  // own schemaVersion check, but a stale bundle (dev Fast Refresh keeping an
  // old module around) or a partially-written row can still slip one
  // through — better to render zeros/empty than crash the whole screen.
  const episodesPerWeek = stats?.episodesPerWeek ?? [];
  const episodesPerMonth = stats?.episodesPerMonth ?? [];
  const genreBreakdown = stats?.genreBreakdown ?? [];
  const topShows = stats?.topShows ?? [];
  const moviesPerMonth = stats?.moviesPerMonth ?? [];
  const topMovies = stats?.topMovies ?? [];
  const maxWeekCount = Math.max(1, ...episodesPerWeek.map((w) => w.count));
  const maxMonthCount = Math.max(1, ...episodesPerMonth.map((m) => m.count));
  const maxMovieMonthCount = Math.max(1, ...moviesPerMonth.map((m) => m.count));
  const maxGenreCount = genreBreakdown.length > 0 ? genreBreakdown[0].count : 1;
  const hasShowHistory = !!stats && (episodesPerWeek.some((w) => w.count > 0) || genreBreakdown.length > 0);
  const hasMovieHistory = !!stats && (stats.totalMoviesWatched ?? 0) > 0;
  const hasAnyHistory = hasShowHistory || hasMovieHistory;
  const hasCurrentTabHistory = tab === "shows" ? hasShowHistory : hasMovieHistory;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t.showStats.title}</Text>
        <View style={{ width: 24, alignItems: "flex-end" }}>{refreshing && <ActivityIndicator size="small" color={colors.textFaint} />}</View>
      </View>

      {stats && hasAnyHistory && (
        <View style={styles.subTabs}>
          <Pressable style={[styles.subTab, tab === "shows" && styles.subTabActive]} onPress={() => setTab("shows")}>
            <Text style={[styles.subTabText, tab === "shows" && styles.subTabTextActive]}>{t.showStats.showsTab}</Text>
          </Pressable>
          <Pressable style={[styles.subTab, tab === "movies" && styles.subTabActive]} onPress={() => setTab("movies")}>
            <Text style={[styles.subTabText, tab === "movies" && styles.subTabTextActive]}>{t.showStats.moviesSection}</Text>
          </Pressable>
        </View>
      )}

      {!stats ? (
        <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
      ) : !hasAnyHistory ? (
        <EmptyState icon="stats-chart-outline" title={t.showStats.noHistory} />
      ) : !hasCurrentTabHistory ? (
        <EmptyState icon="stats-chart-outline" title={t.showStats.noHistory} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {tab === "shows" && (
          <>
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>{t.showStats.episodesPerWeek}</Text>
              <Text style={styles.cardHeaderMeta}>{t.showStats.avgPerWeek((stats?.averagePerWeek ?? 0).toFixed(1))}</Text>
            </View>
            <View style={styles.chartRow}>
              {episodesPerWeek.map((week) => (
                <View key={week.weekStart} style={styles.barColumn}>
                  <Text style={styles.barValue}>{week.count > 0 ? week.count : ""}</Text>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: Math.max(4, (week.count / maxWeekCount) * 96),
                        backgroundColor: week.count > 0 ? colors.accent : colors.pillBg,
                      },
                    ]}
                  />
                  <Text style={styles.barLabel}>
                    {new Date(week.weekStart).toLocaleDateString(language === "fr" ? "fr-FR" : "en-US", {
                      day: "numeric",
                      month: "short",
                    })}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>{t.showStats.episodesPerMonth}</Text>
              <Text style={styles.cardHeaderMeta}>{t.showStats.avgPerMonth((stats?.averagePerMonth ?? 0).toFixed(1))}</Text>
            </View>
            <View style={styles.chartRow}>
              {episodesPerMonth.map((month) => (
                <View key={month.monthStart} style={styles.barColumn}>
                  <Text style={styles.barValue}>{month.count > 0 ? month.count : ""}</Text>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: Math.max(4, (month.count / maxMonthCount) * 96),
                        backgroundColor: month.count > 0 ? colors.accent : colors.pillBg,
                      },
                    ]}
                  />
                  <Text style={styles.barLabel}>
                    {new Date(month.monthStart).toLocaleDateString(language === "fr" ? "fr-FR" : "en-US", {
                      month: "short",
                    })}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.remainingRow}>
              <View style={styles.remainingIcon}>
                <Ionicons name="checkmark-done-outline" size={20} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.remainingValue}>{(stats?.totalEpisodesWatched ?? 0).toLocaleString()}</Text>
                <Text style={styles.cardTitle}>{t.showStats.totalEpisodesWatched}</Text>
                <Text style={styles.cardSubtitle}>{t.showStats.totalEpisodesWatchedSubtitle}</Text>
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.remainingRow}>
              <View style={styles.remainingIcon}>
                <Ionicons name="hourglass-outline" size={20} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.remainingValue}>{(stats?.remainingEpisodes ?? 0).toLocaleString()}</Text>
                <Text style={styles.cardTitle}>{t.showStats.remainingEpisodes}</Text>
                <Text style={styles.cardSubtitle}>{t.showStats.remainingEpisodesSubtitle}</Text>
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.remainingRow}>
              <View style={styles.remainingIcon}>
                <Ionicons name="play-skip-forward-outline" size={20} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.remainingValue}>{(stats?.notStartedEpisodes ?? 0).toLocaleString()}</Text>
                <Text style={styles.cardTitle}>{t.showStats.notStartedEpisodes}</Text>
                <Text style={styles.cardSubtitle}>{t.showStats.notStartedEpisodesSubtitle}</Text>
              </View>
            </View>
          </View>

          {genreBreakdown.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t.showStats.genreBreakdown}</Text>
              <View style={{ marginTop: 12, gap: 10 }}>
                {genreBreakdown.map((g) => (
                  <View key={g.genre}>
                    <View style={styles.genreLabelRow}>
                      <Text style={styles.genreLabel}>{g.genre}</Text>
                      <Text style={styles.genreCount}>{t.showStats.genreShowCount(g.count)}</Text>
                    </View>
                    <View style={styles.genreTrack}>
                      <View
                        style={[
                          styles.genreFill,
                          { width: `${Math.max(4, (g.count / maxGenreCount) * 100)}%` },
                        ]}
                      />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          {topShows.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t.showStats.topShows}</Text>
              <View style={{ marginTop: 12, gap: 12 }}>
                {topShows.map((s, i) => (
                  <View key={s.showId} style={styles.topRow}>
                    <Text style={styles.topRank}>{i + 1}</Text>
                    {s.image ? (
                      <Image source={{ uri: s.image }} style={styles.topPoster} contentFit="cover" />
                    ) : (
                      <View style={[styles.topPoster, styles.topPosterFallback]} />
                    )}
                    <Text style={styles.topTitle} numberOfLines={2}>
                      {s.name}
                    </Text>
                    <Text style={styles.topCount}>{t.showStats.bingeCount(s.episodeCount)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
          </>
        )}

        {tab === "movies" && (
          <>
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>{t.showStats.moviesPerMonth}</Text>
              <Text style={styles.cardHeaderMeta}>
                {t.showStats.avgPerMonth((stats?.averageMoviesPerMonth ?? 0).toFixed(1))}
              </Text>
            </View>
            <View style={styles.chartRow}>
              {moviesPerMonth.map((month) => (
                <View key={month.monthStart} style={styles.barColumn}>
                  <Text style={styles.barValue}>{month.count > 0 ? month.count : ""}</Text>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: Math.max(4, (month.count / maxMovieMonthCount) * 96),
                        backgroundColor: month.count > 0 ? colors.accent : colors.pillBg,
                      },
                    ]}
                  />
                  <Text style={styles.barLabel}>
                    {new Date(month.monthStart).toLocaleDateString(language === "fr" ? "fr-FR" : "en-US", {
                      month: "short",
                    })}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.remainingRow}>
              <View style={styles.remainingIcon}>
                <Ionicons name="film-outline" size={20} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.remainingValue}>{(stats?.totalMoviesWatched ?? 0).toLocaleString()}</Text>
                <Text style={styles.cardTitle}>{t.showStats.totalMoviesWatched}</Text>
              </View>
            </View>
          </View>

          {topMovies.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t.showStats.topMovies}</Text>
              <View style={{ marginTop: 12, gap: 12 }}>
                {topMovies.map((m, i) => (
                  <View key={m.movieId} style={styles.topRow}>
                    <Text style={styles.topRank}>{i + 1}</Text>
                    <TopMoviePoster movie={m} style={styles.topPoster} fallbackStyle={styles.topPosterFallback} />
                    <Text style={styles.topTitle} numberOfLines={2}>
                      {m.title}
                    </Text>
                    <Text style={styles.topCount}>
                      {m.timesWatched > 1 ? t.showStats.watchCount(m.timesWatched) : ""}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}
          </>
        )}

          {stats && (
            <Text style={styles.updatedAt}>
              {t.showStats.computedAt(new Date(stats.computedAt).toLocaleString(language === "fr" ? "fr-FR" : "en-US"))}
            </Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// Mirrors MovieCard's own fallback (components/MovieCard.tsx) — rows watched
// before poster_path was persisted on user_movies have it null, and without
// this, Top Movies just showed an empty placeholder box for every one of
// those instead of a poster.
function TopMoviePoster({
  movie,
  style,
  fallbackStyle,
}: {
  movie: TopMovie;
  style: ImageStyle;
  fallbackStyle: ViewStyle;
}) {
  const [searchedPosterPath, setSearchedPosterPath] = useState<string | null>(null);
  useEffect(() => {
    if (movie.posterPath) return;
    let active = true;
    searchMovie(movie.title, movie.year)
      .then((match) => active && setSearchedPosterPath(match?.poster_path ?? null))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [movie.title, movie.year, movie.posterPath]);
  const poster = posterUrl(movie.posterPath ?? searchedPosterPath, "w200");

  return poster ? (
    <Image source={{ uri: poster }} style={style} contentFit="cover" />
  ) : (
    <View style={[style, fallbackStyle]} />
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 12,
    },
    title: { fontSize: type.title, fontWeight: "800", color: colors.text },
    subTabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
    subTab: { flex: 1, paddingVertical: 8, borderRadius: radius.pill, alignItems: "center", backgroundColor: colors.pillBg },
    subTabActive: { backgroundColor: colors.accent },
    subTabText: { fontSize: type.bodySm, fontWeight: "700", color: colors.textMuted },
    subTabTextActive: { color: colors.onAccent },
    content: { padding: 16, paddingBottom: 40, gap: 14 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
    },
    cardHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    cardTitle: { fontSize: type.bodySm, fontWeight: "800", color: colors.text },
    cardHeaderMeta: { fontSize: type.caption, fontWeight: "700", color: colors.accentDark },
    cardSubtitle: { fontSize: type.caption, color: colors.textMuted, marginTop: 2 },
    chartRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: 20, height: 130 },
    barColumn: { alignItems: "center", flex: 1, gap: 4 },
    barValue: { fontSize: type.micro, color: colors.textFaint, fontWeight: "700", height: 14 },
    bar: { width: 14, borderRadius: 7 },
    barLabel: { fontSize: type.micro, color: colors.textFaint, marginTop: 2 },
    remainingRow: { flexDirection: "row", alignItems: "center", gap: 14 },
    remainingIcon: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    remainingValue: { fontSize: type.display, fontWeight: "800", color: colors.text },
    genreLabelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
    genreLabel: { fontSize: type.caption, fontWeight: "700", color: colors.text },
    genreCount: { fontSize: type.caption, color: colors.textFaint },
    genreTrack: { height: 8, borderRadius: 4, backgroundColor: colors.pillBg, overflow: "hidden" },
    genreFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
    updatedAt: { fontSize: type.micro, color: colors.textFaint, textAlign: "center", marginTop: 4 },
    sectionDivider: {
      fontSize: type.caption,
      fontWeight: "800",
      color: colors.textFaint,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginTop: 8,
      marginBottom: 2,
    },
    topRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    topRank: { width: 18, fontSize: type.bodySm, fontWeight: "800", color: colors.textFaint },
    topPoster: { width: 36, height: 52, borderRadius: radius.sm, backgroundColor: colors.pillBg },
    topPosterFallback: {},
    topTitle: { flex: 1, fontSize: type.bodySm, fontWeight: "700", color: colors.text },
    topCount: { fontSize: type.caption, color: colors.textFaint },
  });
}
