import { useCallback, useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import {
  fetchUserMovie,
  setMovieWatched,
  incrementMovieRewatch,
  setMovieFavorite,
  rateMovie,
  fetchMovieFeelingCounts,
  UserMovie,
} from "../../lib/userMovies";
import {
  searchMovie,
  getMovieDetails,
  getMovieCast,
  getMovieTrailerUrl,
  getMovieWatchProviders,
  getMovieRecommendations,
  posterUrl,
  TMDBMovieDetails,
  TMDBCastMember,
  WatchProviders,
  TMDBSearchResult,
} from "../../lib/tmdb";
import { useLanguage } from "../../lib/i18n";
import { getCurrentUserId } from "../../lib/supabase";
import {
  fetchMovieComments,
  postMovieComment,
  deleteMovieComment,
  toggleMovieCommentReaction,
  EnrichedMovieComment,
} from "../../lib/movieComments";
import { Pill } from "../../components/Pill";
import { WatchedCheck } from "../../components/WatchedCheck";
import { MovieDetailView, MovieDetailLoading } from "../../components/MovieDetailView";
import { MovieRatingSection } from "../../components/MovieRatingSection";
import { RecommendationItem } from "../../components/RecommendationsRow";
import { useGoBack } from "../../lib/useGoBack";

// user_movies (from the TV Time import, or added via Explore/the watchlist)
// only ever has a title/year, never a TMDB id for older rows, so the poster/
// synopsis/genres/runtime/cast below come from a live TMDB title search each
// time this screen opens (see lib/tmdb.ts — cached a day at a time so repeat
// visits are instant). The user's own watched-date/rewatch-count data is
// always shown immediately; TMDB's enrichment fills in a moment later
// without blocking on it, same as the show detail screen.
export default function MovieDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const goBack = useGoBack("/(tabs)/movies");
  const { t, language } = useLanguage();

  const [movie, setMovie] = useState<UserMovie | null>(null);
  const [loading, setLoading] = useState(true);
  const [tmdb, setTmdb] = useState<TMDBMovieDetails | null>(null);
  const [tmdbNotFound, setTmdbNotFound] = useState(false);
  const [cast, setCast] = useState<TMDBCastMember[]>([]);
  const [trailerUrl, setTrailerUrl] = useState<string | null>(null);
  const [watchProviders, setWatchProviders] = useState<WatchProviders | null>(null);
  const [recommendations, setRecommendations] = useState<TMDBSearchResult[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      fetchUserMovie(id)
        .then((data) => active && setMovie(data))
        .finally(() => active && setLoading(false));
      return () => {
        active = false;
      };
    }, [id])
  );

  useEffect(() => {
    if (!movie) return;
    let active = true;
    setTmdb(null);
    setTmdbNotFound(false);
    setCast([]);
    searchMovie(movie.title, movie.year)
      .then((match) => {
        if (!active) return;
        if (!match) {
          setTmdbNotFound(true);
          return;
        }
        getMovieDetails(match.id).then((d) => active && setTmdb(d));
        getMovieCast(match.id)
          .then((c) => active && setCast(c))
          .catch(() => {});
        getMovieTrailerUrl(match.id)
          .then((url) => active && setTrailerUrl(url))
          .catch(() => {});
        getMovieWatchProviders(match.id, language)
          .then((p) => active && setWatchProviders(p))
          .catch(() => {});
        getMovieRecommendations(match.id)
          .then((r) => active && setRecommendations(r))
          .catch(() => {});
      })
      .catch(() => active && setTmdbNotFound(true));
    return () => {
      active = false;
    };
  }, [movie, language]);

  // Comments/feeling-counts are keyed by TMDB id — movie.tmdb_id if this row
  // already has one (the common case), otherwise whatever the title/year
  // search above resolved to. Legacy rows where neither is available (an old
  // TV Time import TMDB couldn't match) simply don't get these two social
  // features; rating/feeling still work either way, keyed by the row's own id.
  const commentTmdbId = movie?.tmdb_id ?? tmdb?.id ?? null;
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [comments, setComments] = useState<EnrichedMovieComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [feelingCounts, setFeelingCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (movie?.status !== "watched" || !commentTmdbId) return;
    let active = true;
    getCurrentUserId().then((uid) => active && setMyUserId(uid ?? null));
    setCommentsLoading(true);
    fetchMovieComments(commentTmdbId)
      .then((data) => active && setComments(data))
      .finally(() => active && setCommentsLoading(false));
    fetchMovieFeelingCounts(commentTmdbId).then((data) => active && setFeelingCounts(data));
    return () => {
      active = false;
    };
  }, [movie?.status, commentTmdbId]);

  if (loading || !movie) return <MovieDetailLoading />;

  const isWatched = movie.status === "watched";
  const watchedDate = new Date(movie.watched_at ?? movie.created_at).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  async function handleToggleWatched() {
    if (isWatched) {
      // Rewatch prompt's "unwatch" choice — the row is gone, nothing left to
      // show here.
      await setMovieWatched(movie!.title, movie!.year, false);
      goBack();
    } else {
      const updated = await setMovieWatched(
        movie!.title,
        movie!.year,
        true,
        movie!.tmdb_id ?? undefined,
        movie!.poster_path ?? tmdb?.poster_path
      );
      setMovie(updated);
    }
  }
  async function handleRewatch() {
    const updated = await incrementMovieRewatch(movie!.id, movie!.times_watched);
    setMovie(updated);
  }
  async function handleToggleFavorite() {
    const updated = await setMovieFavorite(movie!.id, !movie!.is_favorite);
    setMovie(updated);
  }
  async function handleRate(value: number) {
    const next = movie!.rating === value ? null : value;
    const updated = await rateMovie(movie!.id, next, movie!.feeling);
    setMovie(updated);
  }
  async function handleFeeling(key: string) {
    const next = movie!.feeling === key ? null : key;
    const updated = await rateMovie(movie!.id, movie!.rating, next);
    setMovie(updated);
  }
  async function handlePostComment(body: string) {
    if (!commentTmdbId) return;
    await postMovieComment(commentTmdbId, body);
    setComments(await fetchMovieComments(commentTmdbId));
  }
  function refreshComments() {
    if (commentTmdbId) fetchMovieComments(commentTmdbId).then(setComments);
  }
  function handleDeleteComment(id: string) {
    setComments((prev) => prev.filter((c) => c.id !== id));
    deleteMovieComment(id).catch(refreshComments);
  }
  function handleToggleReaction(id: string, currentlyReacted: boolean) {
    setComments((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, reactedByMe: !currentlyReacted, reactionCount: c.reactionCount + (currentlyReacted ? -1 : 1) }
          : c
      )
    );
    toggleMovieCommentReaction(id, currentlyReacted).catch(refreshComments);
  }

  const recommendationItems: RecommendationItem[] = recommendations.map((r) => ({
    key: r.id,
    title: r.title,
    posterUrl: posterUrl(r.poster_path, "w200"),
    onPress: () => router.push(`/movie/tmdb/${r.id}`),
  }));

  return (
    <MovieDetailView
      title={movie.title}
      year={movie.year}
      tmdb={tmdb}
      tmdbNotFound={tmdbNotFound}
      cast={cast}
      tmdbId={commentTmdbId}
      trailerUrl={trailerUrl}
      watchProviders={watchProviders}
      recommendations={recommendationItems}
      onBack={goBack}
      isFavorite={movie.is_favorite}
      onToggleFavorite={handleToggleFavorite}
      watchedPills={
        <>
          <View style={styles.checkInline}>
            <WatchedCheck
              watched={isWatched}
              timesWatched={movie.times_watched}
              onToggle={handleToggleWatched}
              onRewatch={handleRewatch}
              size={26}
            />
          </View>
          {isWatched ? (
            <>
              <Pill>{t.movies.watchedOn(watchedDate)}</Pill>
              {movie.times_watched > 1 && <Pill tone="accent">{t.movies.watchCount(movie.times_watched)}</Pill>}
            </>
          ) : (
            <Pill tone="accent">{t.movies.inWatchlist}</Pill>
          )}
        </>
      }
      extraContent={
        isWatched ? (
          <MovieRatingSection
            rating={movie.rating}
            feeling={movie.feeling}
            onRate={handleRate}
            onFeeling={handleFeeling}
            feelingCounts={feelingCounts}
            comments={comments}
            commentsLoading={commentsLoading}
            myUserId={myUserId}
            onSubmitComment={handlePostComment}
            onDeleteComment={handleDeleteComment}
            onToggleReaction={handleToggleReaction}
          />
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  checkInline: { alignSelf: "center" },
});
