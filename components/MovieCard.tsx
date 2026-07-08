import { memo, useEffect, useMemo, useState } from "react";
import { View, Text, Image, Pressable, Animated, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useColors, radius, type, hueForTitle, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { useScalePress, useMountIn } from "../lib/animations";
import { searchMovie, posterUrl } from "../lib/tmdb";
import { setMovieWatched, incrementMovieRewatch, UserMovie } from "../lib/userMovies";
import { WatchedCheck } from "./WatchedCheck";

interface MovieCardProps {
  id: string;
  title: string;
  year: number | null;
  // Stored on the row for movies added going forward (see
  // lib/userMovies.ts) — when present, skips the per-card TMDB search
  // entirely. Rows written before this existed have it null and fall back
  // to the search, same as always.
  posterPath: string | null;
  watchedAt: string;
  timesWatched: number;
  // Report exactly what changed (and take the id as a parameter rather than
  // being a per-card closure) instead of a single generic onChanged, so the
  // parent can (a) patch its own local list in place rather than refetching
  // the whole collection over the network on every single card's toggle, and
  // (b) pass the same stable function reference to every card, which is
  // what lets memo() below actually skip re-rendering unrelated cards —
  // mattered a lot for a grid of ~700 watched movies, where one checkbox tap
  // used to trigger a full reload + full-grid re-render.
  onUnwatched: (id: string) => void;
  onRewatched: (updated: UserMovie) => void;
}

export const MovieCard = memo(function MovieCard({
  id,
  title,
  year,
  posterPath: storedPosterPath,
  watchedAt,
  timesWatched,
  onUnwatched,
  onRewatched,
}: MovieCardProps) {
  const router = useRouter();
  const colors = useColors();
  const hue = colors[hueForTitle(title)];
  const styles = useMemo(() => createStyles(colors, hue), [colors, hue]);
  const { t } = useLanguage();
  const { scale, onPressIn, onPressOut } = useScalePress();
  const mountIn = useMountIn();
  const watchedDate = new Date(watchedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // Only falls back to a live TMDB search for rows written before poster_path
  // was persisted (see lib/userMovies.ts) — most cards now skip this network/
  // cache lookup entirely. Cards still mount/unmount as the grid scrolls
  // (FlatList virtualization), which paces whatever searches do still happen
  // to roughly what's on screen; lib/tmdb.ts caches each title+year search
  // for a day on top of that. Falls back to the colored-letter placeholder
  // if there's no TMDB match either way.
  const [searchedPosterPath, setSearchedPosterPath] = useState<string | null>(null);
  useEffect(() => {
    if (storedPosterPath) return;
    let active = true;
    searchMovie(title, year)
      .then((match) => active && setSearchedPosterPath(match?.poster_path ?? null))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [title, year, storedPosterPath]);
  const poster = posterUrl(storedPosterPath ?? searchedPosterPath, "w200");

  async function handleUnwatch() {
    await setMovieWatched(title, year, false);
    onUnwatched(id);
  }
  async function handleRewatch() {
    const updated = await incrementMovieRewatch(id, timesWatched);
    onRewatched(updated);
  }

  return (
    <Pressable
      // flex:1 has to be on the Pressable itself, not just the Animated.View
      // below — the outer row's flex distribution stops at its direct
      // children. Without this, each Pressable shrink-wraps to its own
      // title's content width instead of sharing an equal column width,
      // which is what caused the grid's uneven columns/misaligned rows.
      style={styles.card}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={() => router.push(`/movie/${id}`)}
    >
      <Animated.View style={{ opacity: mountIn.opacity, transform: [...mountIn.transform, { scale }] }}>
        <View style={styles.image}>
          {poster ? (
            <Image source={{ uri: poster }} style={styles.posterImage} resizeMode="cover" />
          ) : (
            <Text style={styles.placeholderText}>{title[0]?.toUpperCase()}</Text>
          )}
          <View style={styles.watchedCheckWrap}>
            <WatchedCheck
              watched
              timesWatched={timesWatched}
              onToggle={handleUnwatch}
              onRewatch={handleRewatch}
              size={26}
            />
          </View>
        </View>
        <View style={styles.titleBox}>
          <Text style={styles.name} numberOfLines={2}>
            {title}
            {year ? ` (${year})` : ""}
          </Text>
        </View>
        <Text style={styles.subtitle} numberOfLines={1}>
          {t.movies.watchedOn(watchedDate)}
        </Text>
      </Animated.View>
    </Pressable>
  );
});

function createStyles(colors: Colors, hue: string) {
  return StyleSheet.create({
    // minWidth: 0 stops the title text's intrinsic content width from
    // overriding flex:1's equal split — without it, a row's three cards end
    // up different widths (and therefore different poster/title heights)
    // depending on how long each movie's title is.
    card: { flex: 1, minWidth: 0 },
    image: {
      width: "100%",
      aspectRatio: 110 / 155,
      borderRadius: radius.sm,
      backgroundColor: `${hue}1f`,
      alignItems: "center",
      justifyContent: "center",
    },
    placeholderText: { color: hue, fontSize: type.display, fontWeight: "800" },
    posterImage: { width: "100%", height: "100%", borderRadius: radius.sm },
    watchedCheckWrap: { position: "absolute", right: 6, bottom: 6 },
    // A fixed-height box (not just minHeight on the Text itself, which RN-web
    // doesn't reliably honor together with numberOfLines) reserves two lines'
    // worth of space even for one-line titles, so subtitles stay aligned
    // across a row instead of the grid looking jagged.
    titleBox: { height: 34, marginTop: 8, justifyContent: "flex-start", overflow: "hidden" },
    name: { color: colors.text, fontSize: type.bodySm, fontWeight: "700", lineHeight: 17 },
    subtitle: { color: colors.textMuted, fontSize: type.micro, marginTop: 2 },
  });
}
