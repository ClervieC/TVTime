import { useCallback, useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import {
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
} from "../../../lib/tmdb";
import {
  fetchUserMovieByTmdbId,
  addMovieToWatchlist,
  removeUserMovie,
  setMovieWatched,
  incrementMovieRewatch,
  setMovieFavorite,
  rateMovie,
  fetchMovieFeelingCounts,
  UserMovie,
} from "../../../lib/userMovies";
import { useLanguage } from "../../../lib/i18n";
import { getCurrentUserId } from "../../../lib/supabase";
import {
  fetchMovieComments,
  postMovieComment,
  deleteMovieComment,
  toggleMovieCommentReaction,
  EnrichedMovieComment,
} from "../../../lib/movieComments";
import { Pill } from "../../../components/Pill";
import { WatchedCheck } from "../../../components/WatchedCheck";
import { MovieDetailView, MovieDetailLoading } from "../../../components/MovieDetailView";
import { MovieRatingSection } from "../../../components/MovieRatingSection";
import { RecommendationItem } from "../../../components/RecommendationsRow";
import { useGoBack } from "../../../lib/useGoBack";

// Reached from Explore (discover categories or search) for a movie that
// isn't necessarily in the user's own list yet — unlike app/movie/[id].tsx,
// the id here is a TMDB id directly. userRow tracks whichever list entry (if
// any) this movie already has, so the same screen can offer "add to
// watchlist" for a movie the user has never seen before, and "mark
// watched"/rewatch/unwatch once it's on their list.
export default function TmdbMovieDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const goBack = useGoBack("/(tabs)/movies");
  const { t, language } = useLanguage();
  const tmdbId = Number(id);

  const [tmdb, setTmdb] = useState<TMDBMovieDetails | null>(null);
  const [tmdbNotFound, setTmdbNotFound] = useState(false);
  const [cast, setCast] = useState<TMDBCastMember[]>([]);
  const [userRow, setUserRow] = useState<UserMovie | null>(null);
  const [userRowLoaded, setUserRowLoaded] = useState(false);
  const [trailerUrl, setTrailerUrl] = useState<string | null>(null);
  const [watchProviders, setWatchProviders] = useState<WatchProviders | null>(null);
  const [recommendations, setRecommendations] = useState<TMDBSearchResult[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setTmdb(null);
      setTmdbNotFound(false);
      setCast([]);
      setUserRowLoaded(false);

      // Sequenced (not parallel) with the userRow lookup: fetchUserMovieByTmdbId
      // needs this movie's title/year as a fallback for rows that predate
      // tmdb_id being stored, so it has to wait on tmdb details first.
      async function load() {
        let details: TMDBMovieDetails | null = null;
        try {
          details = await getMovieDetails(tmdbId);
          if (active) setTmdb(details);
        } catch {
          if (active) setTmdbNotFound(true);
        }
        if (!active) return;
        const year = details?.release_date ? new Date(details.release_date).getFullYear() : null;
        try {
          const row = await fetchUserMovieByTmdbId(tmdbId, details?.title, year);
          if (active) setUserRow(row);
        } finally {
          if (active) setUserRowLoaded(true);
        }
      }
      load();

      getMovieCast(tmdbId)
        .then((c) => active && setCast(c))
        .catch(() => {});
      getMovieTrailerUrl(tmdbId)
        .then((url) => active && setTrailerUrl(url))
        .catch(() => {});
      getMovieWatchProviders(tmdbId, language)
        .then((p) => active && setWatchProviders(p))
        .catch(() => {});
      getMovieRecommendations(tmdbId)
        .then((r) => active && setRecommendations(r))
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [tmdbId, language])
  );

  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [comments, setComments] = useState<EnrichedMovieComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [feelingCounts, setFeelingCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (userRow?.status !== "watched") return;
    let active = true;
    getCurrentUserId().then((uid) => active && setMyUserId(uid ?? null));
    setCommentsLoading(true);
    fetchMovieComments(tmdbId)
      .then((data) => active && setComments(data))
      .finally(() => active && setCommentsLoading(false));
    fetchMovieFeelingCounts(tmdbId).then((data) => active && setFeelingCounts(data));
    return () => {
      active = false;
    };
  }, [userRow?.status, tmdbId]);

  if (!tmdb && !tmdbNotFound) return <MovieDetailLoading />;

  const title = tmdb?.title ?? "";
  const year = tmdb?.release_date ? new Date(tmdb.release_date).getFullYear() : null;
  const isWatched = userRow?.status === "watched";

  async function handleAddToWatchlist() {
    const row = await addMovieToWatchlist(tmdbId, title, year, tmdb?.poster_path);
    setUserRow(row);
  }
  async function handleRemoveFromWatchlist() {
    if (!userRow) return;
    await removeUserMovie(userRow.id);
    setUserRow(null);
  }
  async function handleToggleWatched() {
    if (isWatched) {
      await setMovieWatched(title, year, false);
      setUserRow(null);
      return;
    }
    const updated = await setMovieWatched(title, year, true, tmdbId, tmdb?.poster_path);
    setUserRow(updated);
  }
  async function handleRewatch() {
    if (!userRow) return;
    const updated = await incrementMovieRewatch(userRow.id, userRow.times_watched);
    setUserRow(updated);
  }
  async function handleToggleFavorite() {
    const row = userRow ?? (await addMovieToWatchlist(tmdbId, title, year, tmdb?.poster_path));
    const updated = await setMovieFavorite(row.id, !row.is_favorite);
    setUserRow(updated);
  }
  async function handleRate(value: number) {
    if (!userRow) return;
    const next = userRow.rating === value ? null : value;
    const updated = await rateMovie(userRow.id, next, userRow.feeling);
    setUserRow(updated);
  }
  async function handleFeeling(key: string) {
    if (!userRow) return;
    const next = userRow.feeling === key ? null : key;
    const updated = await rateMovie(userRow.id, userRow.rating, next);
    setUserRow(updated);
  }
  async function handlePostComment(body: string) {
    await postMovieComment(tmdbId, body);
    setComments(await fetchMovieComments(tmdbId));
  }
  function refreshComments() {
    fetchMovieComments(tmdbId).then(setComments);
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

  const watchedDate = userRow?.watched_at
    ? new Date(userRow.watched_at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
    : null;

  return (
    <MovieDetailView
      title={title}
      year={year}
      tmdb={tmdb}
      tmdbNotFound={tmdbNotFound}
      cast={cast}
      tmdbId={tmdbId}
      trailerUrl={trailerUrl}
      watchProviders={watchProviders}
      recommendations={recommendationItems}
      onBack={goBack}
      isFavorite={userRow?.is_favorite ?? false}
      onToggleFavorite={handleToggleFavorite}
      watchedPills={
        userRowLoaded ? (
          <>
            <View style={styles.checkInline}>
              <WatchedCheck
                watched={isWatched}
                timesWatched={userRow?.times_watched ?? 0}
                onToggle={handleToggleWatched}
                onRewatch={handleRewatch}
                size={26}
              />
            </View>
            {isWatched ? (
              <>
                {watchedDate && <Pill>{t.movies.watchedOn(watchedDate)}</Pill>}
                {(userRow?.times_watched ?? 0) > 1 && <Pill tone="accent">{t.movies.watchCount(userRow!.times_watched)}</Pill>}
              </>
            ) : userRow ? (
              <Pill tone="accent" onPress={handleRemoveFromWatchlist}>
                {t.movies.inWatchlist}
              </Pill>
            ) : (
              <Pill tone="accent" onPress={handleAddToWatchlist}>
                {t.movies.addToWatchlist}
              </Pill>
            )}
          </>
        ) : undefined
      }
      extraContent={
        isWatched && userRow ? (
          <MovieRatingSection
            rating={userRow.rating}
            feeling={userRow.feeling}
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
