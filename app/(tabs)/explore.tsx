import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  ScrollView,
  Pressable,
  Animated,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect, useNavigation } from "expo-router";
import { searchShows, TVMazeShow } from "../../lib/tvmaze";
import {
  fetchUserShows,
  removeUserShow,
  setShowFavorite,
  upsertUserShow,
} from "../../lib/userShows";
import {
  searchMovies,
  getPopularMovies,
  getTopRatedMovies,
  getNowPlayingMovies,
  getUpcomingMovies,
  getPopularTv,
  getTopRatedTv,
  getOnTheAirTv,
  getUpcomingTv,
  findTvmazeShowFromTmdbTv,
  posterUrl,
  TMDBSearchResult,
  TMDBTvResult,
} from "../../lib/tmdb";
import { fetchUserMovieTmdbMap, addMovieToWatchlist, removeUserMovie, setMovieFavorite, UserMovie } from "../../lib/userMovies";
import { useColors, radius, type, Colors } from "../../lib/theme";
import { useLanguage, Translations } from "../../lib/i18n";
import { useScalePress, useMountIn, useGrowIn } from "../../lib/animations";
import { mapWithConcurrency } from "../../lib/concurrency";
import { EmptyState } from "../../components/EmptyState";

type ExploreTab = "shows" | "movies";
type Category<T> = { key: string; title: string; data: T[] };

export default function ExploreScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const [subTab, setSubTab] = useState<ExploreTab>("shows");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TVMazeShow[]>([]);
  const [movieSearchResults, setMovieSearchResults] = useState<TMDBSearchResult[]>([]);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set());
  const [movieTmdbMap, setMovieTmdbMap] = useState<Map<number, UserMovie>>(new Map());
  // TMDB show id -> resolved TVmaze show, filled in either by a card's first
  // tap (see resolveTvmazeShow) or by the background prefetch below. Without
  // this, a card's add/favorite icon never reflected the real
  // addedIds/favoriteIds state (both keyed by TVmaze id): a show added
  // through any other route (search results, its own detail page, a TV Time
  // import) would show as "not added" here forever, since nothing had ever
  // resolved its TVmaze id — the prefetch below is what makes that check
  // reliably persist without requiring the user to tap every card once.
  const [resolvedTvShows, setResolvedTvShows] = useState<Map<number, TVMazeShow>>(new Map());
  // Tracks which TMDB show ids a resolution has already been attempted for,
  // so the prefetch effect below doesn't re-resolve the same ~40-80 visible
  // cards every time showCategories's array identity changes (e.g. a
  // language switch re-fetching the same categories with new titles).
  const attemptedResolveIds = useRef<Set<number>>(new Set());
  const [showCategories, setShowCategories] = useState<Category<TMDBTvResult>[]>([]);
  const [movieCategories, setMovieCategories] = useState<Category<TMDBSearchResult>[]>([]);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const underlineGrow = useGrowIn(subTab);
  // A plain `let` here would be reassigned on every render, so a debounce
  // scheduled in one render could never be cancelled by clearTimeout in a
  // later one (each render closes over its own fresh variable) — a ref
  // persists across renders like a real instance field would.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // TMDB's own curated lists (popular/top rated/now playing or on-the-air/
  // upcoming) replace what used to be a client-side sample of TVmaze's shows
  // index (which has no real category/genre/trending filter of its own) —
  // same 4-category shape on both the Shows and Movies sub-tabs now. Tapping
  // a result still needs to resolve to a TVmaze id (see ExploreTvCard) since
  // that's what the rest of the app tracks shows by.
  useEffect(() => {
    Promise.all([getPopularTv(), getTopRatedTv(), getOnTheAirTv(), getUpcomingTv()]).then(
      ([popular, topRated, onTheAir, upcoming]) => {
        setShowCategories(
          [
            { key: "popularTv", title: t.explore.categoryPopularMovies, data: popular },
            { key: "topRatedTv", title: t.explore.categoryTopRatedMovies, data: topRated },
            { key: "onTheAirTv", title: t.explore.categoryNowPlayingMovies, data: onTheAir },
            { key: "upcomingTv", title: t.explore.categoryUpcomingMovies, data: upcoming },
          ].filter((c) => c.data.length > 0),
        );
      },
    );
  }, [t]);

  // Resolves every visible discover-category card's TVmaze id in the
  // background, at low priority, so the add/favorite icons above are
  // accurate immediately rather than only after the user has tapped that
  // specific card once (see resolvedTvShows above). Low priority means an
  // actual interactive tap (open/add/favorite, or a search) still jumps
  // ahead of this batch in the shared TVmaze queue; a genuine "no match"
  // (findTvmazeShowFromTmdbTv resolves to null — no tvdb_id on file, or
  // TVmaze's lookup 404s) is marked attempted and not retried, since retrying
  // that would never succeed. A *transient* failure (network blip, TVmaze
  // 5xx — the promise actually rejects) is deliberately NOT marked attempted,
  // so the next time this effect runs (e.g. the next language switch) it
  // gets another try instead of that card's icons staying blank forever.
  useEffect(() => {
    const allShows = showCategories.flatMap((c) => c.data);
    const toResolve = allShows.filter((s) => !attemptedResolveIds.current.has(s.id));
    if (toResolve.length === 0) return;

    let cancelled = false;
    mapWithConcurrency(
      toResolve,
      4,
      async (show) => {
        try {
          return await findTvmazeShowFromTmdbTv(show.id, "low");
        } catch {
          return undefined;
        }
      },
      (result, show) => {
        if (cancelled || result === undefined) return;
        attemptedResolveIds.current.add(show.id);
        if (result) setResolvedTvShows((prev) => (prev.has(show.id) ? prev : new Map(prev).set(show.id, result)));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [showCategories]);

  useEffect(() => {
    Promise.all([getPopularMovies(), getTopRatedMovies(), getNowPlayingMovies(), getUpcomingMovies()]).then(
      ([popular, topRated, nowPlaying, upcoming]) => {
        setMovieCategories(
          [
            { key: "popularMovies", title: t.explore.categoryPopularMovies, data: popular },
            { key: "topRatedMovies", title: t.explore.categoryTopRatedMovies, data: topRated },
            { key: "nowPlayingMovies", title: t.explore.categoryNowPlayingMovies, data: nowPlaying },
            { key: "upcomingMovies", title: t.explore.categoryUpcomingMovies, data: upcoming },
          ].filter((c) => c.data.length > 0),
        );
      },
    );
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      fetchUserMovieTmdbMap().then((map) => active && setMovieTmdbMap(map));
      fetchUserShows().then((userShows) => {
        if (!active) return;
        setAddedIds(new Set(userShows.map((s) => s.tvmaze_id)));
        setFavoriteIds(
          new Set(
            userShows.filter((s) => s.is_favorite).map((s) => s.tvmaze_id),
          ),
        );
      });
      // Clear the search on the way out, so coming back to a fresh Explore
      // (from another tab) never shows a stale query/result set.
      return () => {
        active = false;
        setQuery("");
        setSearchResults([]);
        setMovieSearchResults([]);
      };
    }, []),
  );

  // Re-tapping the Explore tab while already on it doesn't change focus (no
  // navigation happens), so the blur cleanup above never runs — this listens
  // for that specific re-tap to clear the search the same way.
  useEffect(() => {
    const unsubscribe = (navigation as any).addListener("tabPress", () => {
      setQuery("");
      setSearchResults([]);
      setMovieSearchResults([]);
    });
    return unsubscribe;
  }, [navigation]);

  function onChangeText(text: string) {
    setQuery(text);
    clearTimeout(timer.current);
    if (!text.trim()) {
      setSearchResults([]);
      setMovieSearchResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      // Neither source failing should block the other's results.
      const [shows, movies] = await Promise.all([
        searchShows(text).catch(() => []),
        searchMovies(text).catch(() => []),
      ]);
      setSearchResults(shows.map((d) => d.show));
      setMovieSearchResults(movies);
    }, 400);
  }

  async function quickAdd(show: TVMazeShow) {
    const isAdded = addedIds.has(show.id);
    if (isAdded) {
      await removeUserShow(show.id);
      setAddedIds((prev) => {
        const next = new Set(prev);
        next.delete(show.id);
        return next;
      });
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        next.delete(show.id);
        return next;
      });
    } else {
      await upsertUserShow({
        tvmaze_id: show.id,
        show_name: show.name,
        show_image: show.image?.medium ?? null,
        status: "want_to_watch",
      });
      setAddedIds((prev) => new Set(prev).add(show.id));
    }
  }

  async function toggleFavorite(show: TVMazeShow) {
    const isFavorite = favoriteIds.has(show.id);
    if (!addedIds.has(show.id)) {
      await upsertUserShow({
        tvmaze_id: show.id,
        show_name: show.name,
        show_image: show.image?.medium ?? null,
        status: "want_to_watch",
      });
      setAddedIds((prev) => new Set(prev).add(show.id));
    }
    await setShowFavorite(show.id, !isFavorite);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (isFavorite) next.delete(show.id);
      else next.add(show.id);
      return next;
    });
  }

  // Mirrors quickAdd's toggle-off behavior for shows: tapping the check again
  // removes the row — but only when it's a want_to_watch entry. A *watched*
  // movie also shows up in movieTmdbMap (it has a row too), so without this
  // status check tapping the check on an already-watched movie would call
  // removeUserMovie and permanently delete its rating/feeling/watched_at,
  // not just take it off a watchlist it was never really "on". Managing a
  // watched movie (rewatch/unwatch) stays on the movie's own detail screen,
  // which has the real WatchedCheck + rewatch-prompt flow for that.
  async function quickAddMovie(movie: TMDBSearchResult) {
    const existing = movieTmdbMap.get(movie.id);
    if (existing?.status === "want_to_watch") {
      await removeUserMovie(existing.id);
      setMovieTmdbMap((prev) => {
        const next = new Map(prev);
        next.delete(movie.id);
        return next;
      });
      return;
    }
    if (existing?.status === "watched") return;
    const year = movie.release_date ? Number(movie.release_date.slice(0, 4)) : null;
    const row = await addMovieToWatchlist(movie.id, movie.title, year, movie.poster_path);
    setMovieTmdbMap((prev) => new Map(prev).set(movie.id, row));
  }

  async function toggleFavoriteMovie(movie: TMDBSearchResult) {
    const year = movie.release_date ? Number(movie.release_date.slice(0, 4)) : null;
    const existing = movieTmdbMap.get(movie.id);
    const row = existing ?? (await addMovieToWatchlist(movie.id, movie.title, year, movie.poster_path));
    const updated = await setMovieFavorite(row.id, !row.is_favorite);
    setMovieTmdbMap((prev) => new Map(prev).set(movie.id, updated));
  }

  // TMDB-sourced show cards (the four discover categories) only ever have a
  // TMDB id up front — every action on them (open, add, favorite) resolves
  // to the matching TVmaze show first (see lib/tmdb.ts's
  // findTvmazeShowFromTmdbTv), same underlying TVmaze id the rest of the app
  // tracks shows by. Not every TMDB show has a TheTVDB id on file, so a
  // failed resolution surfaces as a plain alert rather than a silent no-op.
  async function resolveTvmazeShow(show: TMDBTvResult): Promise<TVMazeShow | null> {
    const cached = resolvedTvShows.get(show.id);
    if (cached) return cached;
    const resolved = await findTvmazeShowFromTmdbTv(show.id);
    if (!resolved) {
      Alert.alert(t.explore.noMatchTitle, t.explore.noMatchDesc);
      return null;
    }
    setResolvedTvShows((prev) => new Map(prev).set(show.id, resolved));
    return resolved;
  }

  async function openTmdbShow(show: TMDBTvResult) {
    const resolved = await resolveTvmazeShow(show);
    if (resolved) router.push(`/show/${resolved.id}`);
  }

  async function quickAddTmdbShow(show: TMDBTvResult) {
    const resolved = await resolveTvmazeShow(show);
    if (resolved) await quickAdd(resolved);
  }

  async function toggleFavoriteTmdbShow(show: TMDBTvResult) {
    const resolved = await resolveTvmazeShow(show);
    if (resolved) await toggleFavorite(resolved);
  }

  const isSearching = !!query.trim();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t.explore.title}</Text>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.textFaint} />
        <TextInput
          style={styles.searchInput}
          placeholder={t.explore.searchPlaceholder}
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={onChangeText}
        />
        {isSearching && (
          <Pressable onPress={() => onChangeText("")} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textFaint} />
          </Pressable>
        )}
      </View>

      {!isSearching && (
        <View style={styles.tabsRow}>
          <Pressable style={styles.tabBtn} onPress={() => setSubTab("shows")}>
            <Text style={[styles.tabText, subTab === "shows" && styles.tabTextActive]}>{t.tabs.shows}</Text>
            {subTab === "shows" && <Animated.View style={[styles.tabUnderline, { transform: [{ scaleX: underlineGrow }] }]} />}
          </Pressable>
          <Pressable style={styles.tabBtn} onPress={() => setSubTab("movies")}>
            <Text style={[styles.tabText, subTab === "movies" && styles.tabTextActive]}>{t.tabs.movies}</Text>
            {subTab === "movies" && <Animated.View style={[styles.tabUnderline, { transform: [{ scaleX: underlineGrow }] }]} />}
          </Pressable>
        </View>
      )}

      {isSearching ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.searchScroll}>
          {searchResults.length === 0 && movieSearchResults.length === 0 ? (
            <EmptyState icon="search-outline" title={t.explore.noResults(query)} />
          ) : (
            <>
              {searchResults.length > 0 && (
                <View style={styles.categorySection}>
                  <Text style={styles.categoryTitle}>{t.explore.resultsShows}</Text>
                  <View style={styles.wrapGrid}>
                    {searchResults.map((show) => (
                      <View key={show.id} style={styles.wrapGridItem}>
                        <ExploreCard
                          show={show}
                          isAdded={addedIds.has(show.id)}
                          isFavorite={favoriteIds.has(show.id)}
                          onPress={() => router.push(`/show/${show.id}`)}
                          onToggleFavorite={() => toggleFavorite(show)}
                          onQuickAdd={() => quickAdd(show)}
                          colors={colors}
                          styles={styles}
                          t={t}
                        />
                      </View>
                    ))}
                  </View>
                </View>
              )}
              {movieSearchResults.length > 0 && (
                <View style={styles.categorySection}>
                  <Text style={styles.categoryTitle}>{t.explore.resultsMovies}</Text>
                  <View style={styles.wrapGrid}>
                    {movieSearchResults.map((movie) => (
                      <View key={movie.id} style={styles.wrapGridItem}>
                        <ExploreMovieCard
                          movie={movie}
                          isAdded={movieTmdbMap.has(movie.id)}
                          isFavorite={!!movieTmdbMap.get(movie.id)?.is_favorite}
                          onPress={() => router.push(`/movie/tmdb/${movie.id}`)}
                          onToggleFavorite={() => toggleFavoriteMovie(movie)}
                          onQuickAdd={() => quickAddMovie(movie)}
                          colors={colors}
                          styles={styles}
                        />
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </>
          )}
        </ScrollView>
      ) : subTab === "shows" ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.categoriesScroll}
        >
          {showCategories.length === 0 ? (
            <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
          ) : (
            showCategories.map((category) => (
              <View key={category.key} style={styles.categorySection}>
                <Text style={styles.categoryTitle}>{category.title}</Text>
                <FlatList
                  data={category.data}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(show) => String(show.id)}
                  contentContainerStyle={styles.categoryRow}
                  renderItem={({ item: show }) => {
                    const resolvedId = resolvedTvShows.get(show.id)?.id;
                    return (
                      <View style={styles.categoryCard}>
                        <ExploreTvCard
                          show={show}
                          isAdded={resolvedId !== undefined && addedIds.has(resolvedId)}
                          isFavorite={resolvedId !== undefined && favoriteIds.has(resolvedId)}
                          onPress={() => openTmdbShow(show)}
                          onToggleFavorite={() => toggleFavoriteTmdbShow(show)}
                          onQuickAdd={() => quickAddTmdbShow(show)}
                          colors={colors}
                          styles={styles}
                        />
                      </View>
                    );
                  }}
                />
              </View>
            ))
          )}
        </ScrollView>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.categoriesScroll}
        >
          {movieCategories.length === 0 ? (
            <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
          ) : (
            movieCategories.map((category) => (
              <View key={category.key} style={styles.categorySection}>
                <Text style={styles.categoryTitle}>{category.title}</Text>
                <FlatList
                  data={category.data}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(movie) => String(movie.id)}
                  contentContainerStyle={styles.categoryRow}
                  renderItem={({ item: movie }) => (
                    <View style={styles.categoryCard}>
                      <ExploreMovieCard
                        movie={movie}
                        isAdded={movieTmdbMap.has(movie.id)}
                        isFavorite={!!movieTmdbMap.get(movie.id)?.is_favorite}
                        onPress={() => router.push(`/movie/tmdb/${movie.id}`)}
                        onToggleFavorite={() => toggleFavoriteMovie(movie)}
                        onQuickAdd={() => quickAddMovie(movie)}
                        colors={colors}
                        styles={styles}
                      />
                    </View>
                  )}
                />
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

type ExploreStyles = ReturnType<typeof createStyles>;

function ExploreCard({
  show,
  isAdded,
  isFavorite,
  onPress,
  onToggleFavorite,
  onQuickAdd,
  colors,
  styles,
  t,
}: {
  show: TVMazeShow;
  isAdded: boolean;
  isFavorite: boolean;
  onPress: () => void;
  onToggleFavorite: () => void;
  onQuickAdd: () => void;
  colors: Colors;
  styles: ExploreStyles;
  t: Translations;
}) {
  const { scale, onPressIn, onPressOut } = useScalePress();
  const mountIn = useMountIn();

  return (
    <Pressable
      style={styles.card}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={onPress}
    >
      <Animated.View
        style={{
          opacity: mountIn.opacity,
          transform: [...mountIn.transform, { scale }],
        }}
      >
        <View style={styles.cardImageWrap}>
          {show.image ? (
            <Image
              source={{ uri: show.image.medium }}
              style={styles.cardImage}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.cardImage, styles.cardImagePlaceholder]} />
          )}
          <View style={styles.cardActions}>
            <Pressable
              style={styles.iconBtn}
              onPress={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
            >
              <Ionicons
                name={isFavorite ? "heart" : "heart-outline"}
                size={15}
                color={isFavorite ? colors.red : "#fff"}
              />
            </Pressable>
            <Pressable
              style={[styles.iconBtn, isAdded && styles.iconBtnActive]}
              onPress={(e) => {
                e.stopPropagation();
                onQuickAdd();
              }}
            >
              <Ionicons
                name={isAdded ? "checkmark" : "add"}
                size={16}
                color={isAdded ? colors.onAccent : "#fff"}
              />
            </Pressable>
          </View>
        </View>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {show.name}
        </Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {show.status === "Ended" ? t.explore.ended : t.explore.running}
          {show.network ? ` · ${show.network.name}` : ""}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

// Discover-category card for a TMDB-sourced show (see showCategories above).
// isAdded/isFavorite only reflect reality once resolvedTvShows has an entry
// for this card (see resolveTvmazeShow) — resolving every card's TVmaze id
// up front just to pre-fill the icon would reintroduce the kind of bulk
// background TVmaze traffic the priority queue was built to avoid. So a card
// not yet interacted with always starts unfilled, then updates correctly
// after its first tap (open/add/favorite) resolves and caches its id.
function ExploreTvCard({
  show,
  isAdded,
  isFavorite,
  onPress,
  onToggleFavorite,
  onQuickAdd,
  colors,
  styles,
}: {
  show: TMDBTvResult;
  isAdded: boolean;
  isFavorite: boolean;
  onPress: () => void;
  onToggleFavorite: () => void;
  onQuickAdd: () => void;
  colors: Colors;
  styles: ExploreStyles;
}) {
  const { scale, onPressIn, onPressOut } = useScalePress();
  const mountIn = useMountIn();
  const poster = posterUrl(show.poster_path);
  const year = show.first_air_date ? show.first_air_date.slice(0, 4) : "";

  return (
    <Pressable style={styles.card} onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress}>
      <Animated.View style={{ opacity: mountIn.opacity, transform: [...mountIn.transform, { scale }] }}>
        <View style={styles.cardImageWrap}>
          {poster ? (
            <Image source={{ uri: poster }} style={styles.cardImage} resizeMode="cover" />
          ) : (
            <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
              <Text style={styles.cardPlaceholderText}>{show.name[0]?.toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.cardActions}>
            <Pressable
              style={styles.iconBtn}
              onPress={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
            >
              <Ionicons
                name={isFavorite ? "heart" : "heart-outline"}
                size={15}
                color={isFavorite ? colors.red : "#fff"}
              />
            </Pressable>
            <Pressable
              style={[styles.iconBtn, isAdded && styles.iconBtnActive]}
              onPress={(e) => {
                e.stopPropagation();
                onQuickAdd();
              }}
            >
              <Ionicons name={isAdded ? "checkmark" : "add"} size={16} color={isAdded ? colors.onAccent : "#fff"} />
            </Pressable>
          </View>
        </View>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {show.name}
        </Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {year}
          {show.vote_average ? ` · ⭐ ${show.vote_average.toFixed(1)}` : ""}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

// Mirrors ExploreCard's add/favorite icons, but "add" means "add to watchlist"
// (status='want_to_watch') rather than an immediate watch — there's no
// TVmaze-style "watching" concept for movies, just watched vs. not yet.
function ExploreMovieCard({
  movie,
  isAdded,
  isFavorite,
  onPress,
  onToggleFavorite,
  onQuickAdd,
  colors,
  styles,
}: {
  movie: TMDBSearchResult;
  isAdded: boolean;
  isFavorite: boolean;
  onPress: () => void;
  onToggleFavorite: () => void;
  onQuickAdd: () => void;
  colors: Colors;
  styles: ExploreStyles;
}) {
  const { scale, onPressIn, onPressOut } = useScalePress();
  const mountIn = useMountIn();
  const poster = posterUrl(movie.poster_path);
  const year = movie.release_date ? movie.release_date.slice(0, 4) : "";

  return (
    <Pressable style={styles.card} onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress}>
      <Animated.View style={{ opacity: mountIn.opacity, transform: [...mountIn.transform, { scale }] }}>
        <View style={styles.cardImageWrap}>
          {poster ? (
            <Image source={{ uri: poster }} style={styles.cardImage} resizeMode="cover" />
          ) : (
            <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
              <Text style={styles.cardPlaceholderText}>{movie.title[0]?.toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.cardActions}>
            <Pressable
              style={styles.iconBtn}
              onPress={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
            >
              <Ionicons
                name={isFavorite ? "heart" : "heart-outline"}
                size={15}
                color={isFavorite ? colors.red : "#fff"}
              />
            </Pressable>
            <Pressable
              style={[styles.iconBtn, isAdded && styles.iconBtnActive]}
              onPress={(e) => {
                e.stopPropagation();
                onQuickAdd();
              }}
            >
              <Ionicons name={isAdded ? "checkmark" : "add"} size={16} color={isAdded ? colors.onAccent : "#fff"} />
            </Pressable>
          </View>
        </View>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {movie.title}
        </Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {year}
          {movie.vote_average ? ` · ⭐ ${movie.vote_average.toFixed(1)}` : ""}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    title: {
      fontSize: type.title,
      fontWeight: "800",
      color: colors.text,
      paddingHorizontal: 16,
      paddingTop: 20,
    },
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginHorizontal: 16,
      marginTop: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.backgroundAlt,
      borderRadius: radius.sm,
    },
    searchInput: { flex: 1, fontSize: type.input, color: colors.text },
    tabsRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      marginTop: 14,
    },
    tabBtn: { flex: 1, alignItems: "center", paddingVertical: 12 },
    tabText: { fontWeight: "800", fontSize: 13, color: colors.textFaint, letterSpacing: 0.4 },
    tabTextActive: { color: colors.accent },
    tabUnderline: { height: 2, backgroundColor: colors.accent, width: "60%", marginTop: 6 },
    searchScroll: { paddingTop: 16, paddingBottom: 24 },
    grid: { padding: 16, paddingTop: 8, gap: 16 },
    row: { gap: 16 },
    wrapGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16, gap: 16 },
    wrapGridItem: { width: 150 },
    categoriesScroll: { paddingTop: 16, paddingBottom: 24 },
    categorySection: { marginBottom: 20 },
    categoryTitle: {
      fontSize: type.subtitle,
      fontWeight: "800",
      color: colors.text,
      paddingHorizontal: 16,
      marginBottom: 12,
    },
    categoryRow: { paddingHorizontal: 16, gap: 12 },
    categoryCard: { width: 130 },
    card: { flex: 1 },
    cardImageWrap: { position: "relative" },
    cardImage: {
      width: "100%",
      aspectRatio: 2 / 3,
      borderRadius: radius.md,
      backgroundColor: colors.backgroundAlt,
    },
    cardImagePlaceholder: { backgroundColor: colors.backgroundAlt, alignItems: "center", justifyContent: "center" },
    cardPlaceholderText: { color: colors.textFaint, fontSize: type.display, fontWeight: "800" },
    cardActions: { position: "absolute", top: 8, right: 8, gap: 6 },
    iconBtn: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: "rgba(0,0,0,0.45)",
      alignItems: "center",
      justifyContent: "center",
    },
    iconBtnActive: { backgroundColor: colors.accent },
    cardTitle: {
      color: colors.text,
      fontWeight: "700",
      fontSize: 13,
      marginTop: 8,
    },
    cardMeta: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  });
}
