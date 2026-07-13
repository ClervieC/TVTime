import { ReactNode, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Reanimated from "react-native-reanimated";
import { GestureDetector } from "react-native-gesture-handler";
import { backdropUrl, posterUrl, profileUrl, TMDBMovieDetails, TMDBCastMember, WatchProviders } from "../lib/tmdb";
import { useColors, radius, type, hueForTitle, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { useSwipeDownToDismiss } from "../lib/animations";
import { ReportModal } from "./ReportModal";
import { WatchInfo } from "./WatchInfo";
import { RecommendationsRow, RecommendationItem } from "./RecommendationsRow";

interface MovieDetailViewProps {
  title: string;
  year: number | null;
  tmdb: TMDBMovieDetails | null;
  tmdbNotFound: boolean;
  cast: TMDBCastMember[];
  // Null while a movie added before TMDB matching existed hasn't resolved
  // one yet — the report button is hidden in that case (see the render
  // below), same spirit as isFavorite/onToggleFavorite being optional.
  tmdbId: number | null;
  // Slot for the user's own watched-date/rewatch-count pills — absent when
  // browsing a TMDB movie that isn't necessarily in the user's own history
  // (see app/movie/tmdb/[id].tsx).
  watchedPills?: ReactNode;
  onBack: () => void;
  // Undefined hides the star entirely (e.g. while it's still loading whether
  // this movie is even in the user's list yet).
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  // Rating/feeling/comments — only meaningful once the movie is marked
  // watched, so the caller decides when (if ever) to pass this in rather
  // than this component gating it itself.
  extraContent?: ReactNode;
  // TMDB-only data (TVmaze has none of this) — all optional/nullable since
  // they load after the initial details fetch and may end up empty (not
  // every title has a trailer or regional provider on file).
  trailerUrl?: string | null;
  watchProviders?: WatchProviders | null;
  recommendations?: RecommendationItem[];
}

// Shared by app/movie/[id].tsx (a movie from the user's own watched history)
// and app/movie/tmdb/[id].tsx (browsing/searching any TMDB movie) — both
// screens differ only in where the initial title/year come from and whether
// there's watched data to show; the hero/meta/cast/overview layout is
// identical either way.
export function MovieDetailView({
  title,
  year,
  tmdb,
  tmdbNotFound,
  cast,
  tmdbId,
  watchedPills,
  onBack,
  isFavorite,
  onToggleFavorite,
  extraContent,
  trailerUrl,
  watchProviders,
  recommendations,
}: MovieDetailViewProps) {
  const colors = useColors();
  const { t } = useLanguage();
  const posterHue = colors[hueForTitle(title)];
  const styles = useMemo(() => createStyles(colors, posterHue), [colors, posterHue]);
  const { gesture: swipeDownGesture, animatedStyle: swipeDownStyle } = useSwipeDownToDismiss(onBack);
  const [reporting, setReporting] = useState(false);

  const heroImage = tmdb && (backdropUrl(tmdb.backdrop_path) ?? posterUrl(tmdb.poster_path, "w500"));
  const metaParts = tmdb
    ? [
        tmdb.genres.map((g) => g.name).join(", "),
        tmdb.runtime ? `${tmdb.runtime} min` : null,
        tmdb.vote_average ? `⭐ ${tmdb.vote_average.toFixed(1)}` : null,
      ].filter(Boolean)
    : [];
  const stillLoadingTmdb = !tmdb && !tmdbNotFound;

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <GestureDetector gesture={swipeDownGesture}>
          <Reanimated.View style={[styles.hero, swipeDownStyle]}>
            {heroImage ? (
              <>
                <Image source={{ uri: heroImage }} style={styles.heroImage} contentFit="cover" />
                <LinearGradient colors={["transparent", colors.background]} style={[styles.heroGradient, { pointerEvents: "none" }]} />
              </>
            ) : (
              <Text style={styles.heroPlaceholder}>{title[0]?.toUpperCase()}</Text>
            )}
            <View style={styles.heroTopRow}>
              <Pressable
                style={styles.iconBtn}
                onPress={onBack}
                accessibilityRole="button"
                accessibilityLabel="Back"
              >
                <Ionicons name="chevron-down" size={22} color="#fff" />
              </Pressable>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {onToggleFavorite && (
                  <Pressable
                    style={styles.iconBtn}
                    onPress={onToggleFavorite}
                    accessibilityRole="button"
                    accessibilityLabel={isFavorite ? t.showDetail.removeFavorite : t.showDetail.addFavorite}
                  >
                    <Ionicons
                      name={isFavorite ? "star" : "star-outline"}
                      size={19}
                      color={isFavorite ? colors.accent : "#fff"}
                    />
                  </Pressable>
                )}
                {tmdbId != null && (
                  <Pressable
                    style={styles.iconBtn}
                    onPress={() => setReporting(true)}
                    accessibilityRole="button"
                    accessibilityLabel={t.report.reportMovie}
                  >
                    <Ionicons name="flag-outline" size={18} color="#fff" />
                  </Pressable>
                )}
              </View>
            </View>
          </Reanimated.View>
        </GestureDetector>
        {tmdbId != null && (
          <ReportModal
            visible={reporting}
            onClose={() => setReporting(false)}
            target={{ targetType: "movie", targetTmdbId: tmdbId }}
          />
        )}

        <View style={styles.sheet}>
          <Text style={styles.title}>
            {title}
            {year ? ` (${year})` : ""}
          </Text>
          {metaParts.length > 0 && <Text style={styles.meta}>{metaParts.join(" · ")}</Text>}
          {watchedPills && <View style={styles.pillRow}>{watchedPills}</View>}

          {tmdb?.overview ? (
            <>
              <Text style={styles.sectionHeader}>{t.movies.overview}</Text>
              <Text style={styles.overview}>{tmdb.overview}</Text>
            </>
          ) : stillLoadingTmdb ? (
            <ActivityIndicator color={colors.textFaint} style={styles.overviewLoading} />
          ) : null}

          <WatchInfo trailerUrl={trailerUrl ?? null} providers={watchProviders ?? null} />

          {extraContent}

          {cast.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>{t.showDetail.cast}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {cast.slice(0, 20).map((c) => (
                  <View key={c.id} style={styles.castCard}>
                    {c.profile_path ? (
                      <Image source={{ uri: profileUrl(c.profile_path)! }} style={styles.castImage} contentFit="cover" />
                    ) : (
                      <View style={[styles.castImage, styles.castImagePlaceholder]}>
                        <Ionicons name="person" size={24} color={colors.textFaint} />
                      </View>
                    )}
                    <Text style={styles.castName} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={styles.castCharacter} numberOfLines={1}>
                      {c.character}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </>
          )}

          <RecommendationsRow items={recommendations ?? []} />
        </View>
      </ScrollView>
    </View>
  );
}

export function MovieDetailLoading() {
  const colors = useColors();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.black} />
    </View>
  );
}

function createStyles(colors: Colors, hue: string) {
  return StyleSheet.create({
    screen: { flex: 1 },
    container: { flex: 1, backgroundColor: colors.background },
    hero: {
      height: 320,
      backgroundColor: `${hue}1f`,
      alignItems: "center",
      justifyContent: "center",
    },
    heroImage: { width: "100%", height: "100%", position: "absolute" },
    heroGradient: { position: "absolute", left: 0, right: 0, bottom: 0, height: 150 },
    heroPlaceholder: { color: hue, fontSize: 96, fontWeight: "800" },
    heroTopRow: {
      position: "absolute",
      top: 16,
      left: 16,
      right: 16,
      flexDirection: "row",
      justifyContent: "space-between",
    },
    iconBtn: {
      width: 36,
      height: 36,
      borderRadius: radius.pill,
      backgroundColor: "rgba(0,0,0,0.35)",
      alignItems: "center",
      justifyContent: "center",
    },
    sheet: {
      backgroundColor: colors.background,
      paddingTop: 20,
      paddingHorizontal: 16,
      paddingBottom: 32,
    },
    title: { color: colors.text, fontSize: type.display, fontWeight: "800" },
    meta: { color: colors.textMuted, fontSize: type.body, marginTop: 6 },
    pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
    sectionHeader: { color: colors.text, fontSize: type.subtitle, fontWeight: "800", marginTop: 24, marginBottom: 8 },
    overview: { color: colors.textMuted, fontSize: type.body, lineHeight: 21 },
    overviewLoading: { marginTop: 24, alignSelf: "flex-start" },
    castCard: { width: 84, marginRight: 12 },
    castImage: { width: 84, height: 84, borderRadius: radius.md, backgroundColor: colors.backgroundAlt },
    castImagePlaceholder: { alignItems: "center", justifyContent: "center" },
    castName: { fontWeight: "700", fontSize: 12, color: colors.text, marginTop: 6 },
    castCharacter: { fontSize: 11, color: colors.textMuted },
  });
}
