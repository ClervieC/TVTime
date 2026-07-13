import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Animated,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Image,
  TextInput,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { GestureDetector } from "react-native-gesture-handler";
import Reanimated from "react-native-reanimated";
import { getShow, getShowCast, getShowEpisodes, CastMember, TVMazeShow, TVMazeEpisode } from "../../lib/tvmaze";
import { getCachedEpisodes, getCachedShow, getCachedWatchedEpisodes } from "../../lib/showDataCache";
import {
  findTmdbTvFromTvdbId,
  findTvmazeShowFromTmdbTv,
  getTvTrailerUrl,
  getTvWatchProviders,
  getTvRecommendations,
  posterUrl,
  WatchProviders,
  TMDBTvResult,
} from "../../lib/tmdb";
import { WatchInfo } from "../../components/WatchInfo";
import { RecommendationsRow, RecommendationItem } from "../../components/RecommendationsRow";
import {
  addShowToList,
  bulkIncrementRewatch,
  createList,
  fetchLists,
  fetchUserShows,
  fetchWatchedEpisodes,
  incrementRewatch,
  removeUserShow,
  setEpisodeWatched,
  setEpisodesUnwatched,
  setEpisodesWatched,
  setShowFavorite,
  setShowStatus,
  upsertUserShow,
  ShowList,
  UserShow,
  WatchedEpisode,
} from "../../lib/userShows";
import { useColors, radius, type, Colors } from "../../lib/theme";
import { useLanguage, Translations } from "../../lib/i18n";
import { useGrowIn, useFadeIn, useScalePress, useMountIn, useSwipeDownToDismiss } from "../../lib/animations";
import { WatchedCheck } from "../../components/WatchedCheck";
import { CommentsSection } from "../../components/CommentsSection";
import { ReportModal } from "../../components/ReportModal";
import { DetailErrorState } from "../../components/DetailErrorState";
import { Sheet } from "../../components/Sheet";
import { usePreviousEpisodesPrompt } from "../../context/PreviousEpisodesPromptContext";
import { useRewatchPrompt } from "../../context/RewatchPromptContext";
import { getCurrentUserId } from "../../lib/supabase";
import { useGoBack } from "../../lib/useGoBack";
import {
  deleteComment,
  fetchShowComments,
  postShowComment,
  toggleCommentReaction,
  EnrichedComment,
} from "../../lib/comments";

function stripHtml(html: string | null) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "");
}

export default function ShowDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const goBack = useGoBack("/(tabs)");
  const showId = Number(id);

  const [tab, setTab] = useState<"about" | "episodes">("episodes");
  const [show, setShow] = useState<TVMazeShow | null>(null);
  const [episodes, setEpisodes] = useState<TVMazeEpisode[]>([]);
  const [cast, setCast] = useState<CastMember[]>([]);
  const [userShow, setUserShow] = useState<UserShow | null>(null);
  const [watched, setWatched] = useState<WatchedEpisode[]>([]);
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [listPickerOpen, setListPickerOpen] = useState(false);
  const [lists, setLists] = useState<ShowList[]>([]);
  const [newListName, setNewListName] = useState("");
  const [showComments, setShowComments] = useState<EnrichedComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  // Only the very first load should pick the default tab based on
  // list-membership — otherwise switching to Episodes and then coming back
  // to this screen (e.g. after adding the show) would keep bouncing the
  // tab back to Info on every refocus.
  const initialTabSet = useRef(false);
  const [trailerUrl, setTrailerUrl] = useState<string | null>(null);
  const [watchProviders, setWatchProviders] = useState<WatchProviders | null>(null);
  const [recommendations, setRecommendations] = useState<TMDBTvResult[]>([]);
  // Per-recommendation cache of the TVmaze id each one resolves to on tap,
  // mirroring the same resolve-on-tap pattern Explore uses for its own TMDB
  // discover cards.
  const resolvedRecommendations = useRef<Map<number, number | null>>(new Map());
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t, language } = useLanguage();
  const underlineGrow = useGrowIn(tab);
  const contentFade = useFadeIn(!loading);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const askPreviousEpisodes = usePreviousEpisodesPrompt();
  const askRewatch = useRewatchPrompt();
  const { gesture: swipeDownGesture, animatedStyle: swipeDownStyle } = useSwipeDownToDismiss(goBack);

  const load = useCallback(async () => {
    const [showData, episodeData, userShows, watchedData] = await Promise.all([
      getCachedShow(showId, () => getShow(showId)),
      getCachedEpisodes(showId, () => getShowEpisodes(showId)),
      fetchUserShows(),
      getCachedWatchedEpisodes(showId, () => fetchWatchedEpisodes(showId)),
    ]);
    setShow(showData);
    setEpisodes(episodeData);
    const matchedUserShow = userShows.find((s) => s.tvmaze_id === showId) ?? null;
    setUserShow(matchedUserShow);
    setWatched(watchedData);
    // A show you're not already tracking has no watch progress worth
    // landing on Episodes for — Info (overview, cast) is the more useful
    // default there, same idea as a movie's own detail page leading with
    // its overview rather than anything watch-related.
    if (!initialTabSet.current) {
      initialTabSet.current = true;
      if (!matchedUserShow) setTab("about");
    }
    // Cast only ever shows on the Info tab (default tab is Episodes), and is
    // never prefetched elsewhere — no reason to make the default view wait
    // on it too.
    getShowCast(showId)
      .then(setCast)
      .catch(() => {});

    // TMDB-only data (trailer, watch providers, recommendations) — needs
    // this show's TMDB tv id first, bridged via its TVmaze externals (see
    // the state comment above). Not every show has a thetvdb id on file, in
    // which case these sections just stay empty (WatchInfo/RecommendationsRow
    // both render nothing when there's nothing to show).
    const tvdbId = showData.externals?.thetvdb;
    if (tvdbId) {
      findTmdbTvFromTvdbId(tvdbId).then((tmdbTvId) => {
        if (!tmdbTvId) return;
        getTvTrailerUrl(tmdbTvId).then(setTrailerUrl).catch(() => {});
        getTvWatchProviders(tmdbTvId, language).then(setWatchProviders).catch(() => {});
        getTvRecommendations(tmdbTvId).then(setRecommendations).catch(() => {});
      });
    }
  }, [showId, language]);

  // Resolve-on-tap (not upfront for all ~12 recommendations at once) — same
  // pattern as Explore's own TMDB discover cards (see resolveTvmazeShow in
  // app/(tabs)/explore.tsx). A show with no TVmaze match at all (no tvdb id
  // on file for that TMDB title) opens the read-only TMDB-only fallback
  // page (app/show/tmdb/[id].tsx) instead of a dead-end "not found" alert.
  async function openRecommendation(rec: TMDBTvResult) {
    const cached = resolvedRecommendations.current.get(rec.id);
    if (cached) {
      router.push(`/show/${cached}`);
      return;
    }
    if (cached === null) {
      router.push(`/show/tmdb/${rec.id}`);
      return;
    }
    const resolved = await findTvmazeShowFromTmdbTv(rec.id);
    resolvedRecommendations.current.set(rec.id, resolved?.id ?? null);
    router.push(resolved ? `/show/${resolved.id}` : `/show/tmdb/${rec.id}`);
  }

  const recommendationItems: RecommendationItem[] = recommendations.map((r) => ({
    key: r.id,
    title: r.name,
    posterUrl: posterUrl(r.poster_path, "w200"),
    onPress: () => openRecommendation(r),
  }));

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setLoadError(false);
      load()
        .catch(() => active && setLoadError(true))
        .finally(() => active && setLoading(false));
      return () => {
        active = false;
      };
    }, [load])
  );

  useEffect(() => {
    getCurrentUserId().then((id) => setMyUserId(id ?? null));
  }, []);

  // Comments are only ever visible on the Info tab, so there's no reason to
  // fetch them until the user actually switches there.
  useEffect(() => {
    if (tab !== "about" || !showId) return;
    let active = true;
    setCommentsLoading(true);
    fetchShowComments(showId)
      .then((data) => active && setShowComments(data))
      .finally(() => active && setCommentsLoading(false));
    return () => {
      active = false;
    };
  }, [tab, showId]);

  async function handlePostShowComment(body: string) {
    await postShowComment(showId, body);
    setShowComments(await fetchShowComments(showId));
  }

  function handleDeleteShowComment(id: string) {
    setShowComments((prev) => prev.filter((c) => c.id !== id));
    deleteComment(id).catch(() => fetchShowComments(showId).then(setShowComments));
  }

  function handleToggleShowCommentReaction(id: string, currentlyReacted: boolean) {
    setShowComments((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, reactedByMe: !currentlyReacted, reactionCount: c.reactionCount + (currentlyReacted ? -1 : 1) }
          : c
      )
    );
    toggleCommentReaction(id, currentlyReacted).catch(() => fetchShowComments(showId).then(setShowComments));
  }

  const watchedIds = useMemo(() => new Set(watched.map((w) => w.tvmaze_episode_id)), [watched]);

  const seasons = useMemo(() => {
    const bySeason = new Map<number, TVMazeEpisode[]>();
    for (const ep of episodes) {
      if (!bySeason.has(ep.season)) bySeason.set(ep.season, []);
      bySeason.get(ep.season)!.push(ep);
    }
    return [...bySeason.entries()].sort((a, b) => a[0] - b[0]);
  }, [episodes]);

  const continueTracking = useMemo(() => {
    const now = Date.now();
    return episodes
      .filter((e) => new Date(e.airstamp).getTime() <= now && !watchedIds.has(e.id))
      .sort((a, b) => a.season - b.season || a.number - b.number)
      .slice(0, 5);
  }, [episodes, watchedIds]);

  const airedEpisodes = useMemo(
    () => episodes.filter((e) => new Date(e.airstamp).getTime() <= Date.now()),
    [episodes]
  );
  const progress = airedEpisodes.length > 0 ? watched.length / airedEpisodes.length : 0;

  useEffect(() => {
    Animated.timing(progressAnim, { toValue: progress, duration: 400, useNativeDriver: false }).start();
  }, [progress, progressAnim]);

  async function toggleInList() {
    if (!show) return;
    if (userShow) {
      await removeUserShow(show.id);
      setUserShow(null);
    } else {
      const result = await upsertUserShow({
        tvmaze_id: show.id,
        show_name: show.name,
        show_image: show.image?.medium ?? null,
        status: "want_to_watch",
      });
      setUserShow(result);
    }
  }

  async function handleStop() {
    if (!show) return;
    const nextStatus = userShow?.status === "dropped" ? "watching" : "dropped";
    const result = await setShowStatus(show.id, nextStatus);
    setUserShow(result);
    setMenuOpen(false);
  }

  async function handlePause() {
    if (!show) return;
    const nextStatus = userShow?.status === "paused" ? "watching" : "paused";
    const result = await setShowStatus(show.id, nextStatus);
    setUserShow(result);
    setMenuOpen(false);
  }

  async function handleToggleFavorite() {
    if (!show || !userShow) return;
    const result = await setShowFavorite(show.id, !userShow.is_favorite);
    setUserShow(result);
    setMenuOpen(false);
  }

  async function handleRemoveFromList() {
    if (!show) return;
    await removeUserShow(show.id);
    setUserShow(null);
    setMenuOpen(false);
  }

  async function openListPicker() {
    setMenuOpen(false);
    const data = await fetchLists();
    setLists(data);
    setListPickerOpen(true);
  }

  async function handleAddToList(listId: string) {
    if (!show) return;
    await addShowToList(listId, {
      tvmaze_id: show.id,
      show_name: show.name,
      show_image: show.image?.medium ?? null,
    });
    setListPickerOpen(false);
  }

  async function handleCreateList() {
    if (!show || !newListName.trim()) return;
    const list = await createList(newListName.trim());
    await addShowToList(list.id, {
      tvmaze_id: show.id,
      show_name: show.name,
      show_image: show.image?.medium ?? null,
    });
    setNewListName("");
    setListPickerOpen(false);
  }

  async function toggleEpisode(ep: TVMazeEpisode) {
    const isWatched = watchedIds.has(ep.id);

    if (!isWatched) {
      const earlierUnwatched = episodes.filter((e) => {
        const isEarlier = e.season < ep.season || (e.season === ep.season && e.number < ep.number);
        const aired = new Date(e.airstamp).getTime() <= Date.now();
        return isEarlier && aired && !watchedIds.has(e.id);
      });

      if (earlierUnwatched.length > 0) {
        const choice = await askPreviousEpisodes();
        if (choice === "allPrevious") {
          const toMark = [...earlierUnwatched, ep];
          await setEpisodesWatched(
            showId,
            toMark.map((e) => ({ id: e.id, season: e.season, number: e.number }))
          );
          setWatched((prev) => [
            ...prev,
            ...toMark.map((e) => ({ tvmaze_episode_id: e.id, season: e.season, number: e.number, times_watched: 1 } as WatchedEpisode)),
          ]);
          return;
        }
      }
    }

    await setEpisodeWatched({
      tvmaze_show_id: showId,
      tvmaze_episode_id: ep.id,
      season: ep.season,
      number: ep.number,
      watched: !isWatched,
    });
    setWatched((prev) =>
      isWatched
        ? prev.filter((w) => w.tvmaze_episode_id !== ep.id)
        : [...prev, { tvmaze_episode_id: ep.id, season: ep.season, number: ep.number, times_watched: 1 } as WatchedEpisode]
    );
  }

  async function rewatchEpisode(ep: TVMazeEpisode) {
    const entry = watched.find((w) => w.tvmaze_episode_id === ep.id);
    if (!entry) return;
    const result = await incrementRewatch(ep.id, entry.times_watched);
    setWatched((prev) => prev.map((w) => (w.tvmaze_episode_id === ep.id ? result : w)));
  }

  async function markSeasonWatched(eps: TVMazeEpisode[]) {
    const unwatched = eps.filter((e) => !watchedIds.has(e.id) && new Date(e.airstamp).getTime() <= Date.now());
    if (unwatched.length === 0) return;
    await setEpisodesWatched(
      showId,
      unwatched.map((e) => ({ id: e.id, season: e.season, number: e.number }))
    );
    setWatched((prev) => [
      ...prev,
      ...unwatched.map((e) => ({ tvmaze_episode_id: e.id, season: e.season, number: e.number } as WatchedEpisode)),
    ]);
  }

  async function unmarkSeasonWatched(eps: TVMazeEpisode[]) {
    const ids = eps.filter((e) => watchedIds.has(e.id)).map((e) => e.id);
    if (ids.length === 0) return;
    await setEpisodesUnwatched(showId, ids);
    setWatched((prev) => prev.filter((w) => !ids.includes(w.tvmaze_episode_id)));
  }

  async function rewatchSeason(eps: TVMazeEpisode[]) {
    const entries = eps
      .map((e) => watched.find((w) => w.tvmaze_episode_id === e.id))
      .filter((w): w is WatchedEpisode => !!w);
    if (entries.length === 0) return;
    await bulkIncrementRewatch(
      showId,
      entries.map((w) => ({ episodeId: w.tvmaze_episode_id, timesWatched: w.times_watched }))
    );
    setWatched((prev) =>
      prev.map((w) =>
        entries.some((e) => e.tvmaze_episode_id === w.tvmaze_episode_id)
          ? { ...w, times_watched: w.times_watched + 1 }
          : w
      )
    );
  }

  // The season checkmark already handles "mark this whole season watched" —
  // tapping it again once complete offers the same unwatch/rewatch choice as
  // a single episode's checkmark, just applied to every episode in the season.
  async function handleSeasonCheckPress(eps: TVMazeEpisode[], complete: boolean) {
    if (!complete) {
      await markSeasonWatched(eps);
      return;
    }
    const choice = await askRewatch();
    if (choice === "rewatch") await rewatchSeason(eps);
    else if (choice === "unwatch") await unmarkSeasonWatched(eps);
  }

  if (loadError) {
    return <DetailErrorState onBack={goBack} />;
  }

  if (loading || !show) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.black} />
      </View>
    );
  }

  const progressPercent = Math.round(progress * 100);

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <GestureDetector gesture={swipeDownGesture}>
          <Reanimated.View style={[styles.hero, swipeDownStyle]}>
            {show.image && <Image source={{ uri: show.image.original }} style={styles.heroImage} />}
            <LinearGradient colors={["transparent", colors.background]} style={[styles.heroGradient, { pointerEvents: "none" }]} />
            <View style={styles.heroTopRow}>
              <Pressable
                style={styles.iconBtn}
                onPress={goBack}
                accessibilityRole="button"
                accessibilityLabel="Back"
              >
                <Ionicons name="chevron-down" size={22} color="#fff" />
              </Pressable>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {userShow && (
                  <Pressable
                    style={styles.iconBtn}
                    onPress={handleToggleFavorite}
                    accessibilityRole="button"
                    accessibilityLabel={userShow.is_favorite ? t.showDetail.removeFavorite : t.showDetail.addFavorite}
                  >
                    <Ionicons
                      name={userShow.is_favorite ? "star" : "star-outline"}
                      size={19}
                      color={userShow.is_favorite ? colors.accent : "#fff"}
                    />
                  </Pressable>
                )}
                <Pressable
                  style={styles.iconBtn}
                  onPress={() => setMenuOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="More options"
                >
                  <Ionicons name="ellipsis-horizontal" size={20} color="#fff" />
                </Pressable>
              </View>
            </View>
          </Reanimated.View>
        </GestureDetector>

        <View style={styles.sheet}>
          <Text style={styles.heroTitle}>{show.name}</Text>
          <Text style={styles.heroMeta}>
            {show.network?.name ?? show.webChannel?.name ?? ""}
            {show.rating.average ? ` · ⭐ ${show.rating.average}` : ""}
          </Text>

          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressBar,
                  { width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) },
                  userShow?.status === "dropped"
                    ? styles.progressBarDropped
                    : userShow?.status === "paused"
                      ? styles.progressBarPaused
                      : progress >= 1 && styles.progressBarComplete,
                ]}
              />
            </View>
            <Text style={styles.progressLabel}>{progressPercent}%</Text>
          </View>

          <Pressable style={[styles.addRow, userShow && styles.addRowActive]} onPress={toggleInList}>
            <Ionicons name={userShow ? "checkmark-circle" : "add-circle-outline"} size={20} color={userShow ? colors.green : colors.accent} />
            <Text style={styles.addLabel}>{userShow ? t.showDetail.inMyList : t.showDetail.addToMyList}</Text>
          </Pressable>

          <View style={styles.tabsRow}>
            <Pressable style={styles.tabBtn} onPress={() => setTab("about")}>
              <Text style={[styles.tabText, tab === "about" && styles.tabTextActive]}>{t.showDetail.infos}</Text>
              {tab === "about" && (
                <Animated.View style={[styles.tabUnderline, { transform: [{ scaleX: underlineGrow }] }]} />
              )}
            </Pressable>
            <Pressable style={styles.tabBtn} onPress={() => setTab("episodes")}>
              <Text style={[styles.tabText, tab === "episodes" && styles.tabTextActive]}>{t.showDetail.episodes}</Text>
              {tab === "episodes" && (
                <Animated.View style={[styles.tabUnderline, { transform: [{ scaleX: underlineGrow }] }]} />
              )}
            </Pressable>
          </View>

          <Animated.View style={{ opacity: contentFade }}>
            {tab === "about" ? (
              <View style={styles.section}>
                <Text style={styles.sectionHeader}>{t.showDetail.info}</Text>
                <Text style={styles.summary}>{stripHtml(show.summary)}</Text>
                <Text style={styles.meta}>{show.genres.join(", ")}</Text>
                <Text style={styles.meta}>
                  {show.premiered?.slice(0, 4)}
                  {show.ended ? ` – ${show.ended.slice(0, 4)}` : ` – ${t.showDetail.present}`}
                </Text>
                <Text style={styles.meta}>{show.status}</Text>

                <WatchInfo trailerUrl={trailerUrl} providers={watchProviders} />

                <View style={styles.divider} />
                <Text style={styles.sectionHeader}>{t.showDetail.comments}</Text>
                <CommentsSection
                  comments={showComments}
                  loading={commentsLoading}
                  myUserId={myUserId}
                  onSubmit={handlePostShowComment}
                  onDelete={handleDeleteShowComment}
                  onToggleReaction={handleToggleShowCommentReaction}
                  reportTargetType="comment"
                />

                {cast.length > 0 && (
                  <>
                    <View style={styles.divider} />
                    <Text style={styles.sectionHeader}>{t.showDetail.cast}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      {cast
                        .filter((c) => !!c.person)
                        .slice(0, 20)
                        .map((c) => (
                          <View key={c.person.id} style={styles.castCard}>
                            {c.person.image ? (
                              <Image source={{ uri: c.person.image.medium }} style={styles.castImage} />
                            ) : (
                              <View style={[styles.castImage, styles.castImagePlaceholder]}>
                                <Ionicons name="person" size={24} color={colors.textFaint} />
                              </View>
                            )}
                            <Text style={styles.castName} numberOfLines={1}>
                              {c.person.name}
                            </Text>
                            <Text style={styles.castCharacter} numberOfLines={1}>
                              {c.character.name}
                            </Text>
                          </View>
                        ))}
                    </ScrollView>
                  </>
                )}

                <RecommendationsRow items={recommendationItems} />
              </View>
            ) : (
              <View style={styles.section}>
                {continueTracking.length > 0 && (
                  <>
                    <Text style={styles.sectionHeader}>{t.showDetail.toContinue}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
                      {continueTracking.map((ep) => (
                        <TrackCard
                          key={ep.id}
                          episode={ep}
                          onPress={() =>
                            router.push({ pathname: "/episode/[id]", params: { id: String(ep.id), showId: String(showId) } })
                          }
                          colors={colors}
                          styles={styles}
                        />
                      ))}
                    </ScrollView>
                  </>
                )}

                <Text style={styles.sectionHeader}>{t.showDetail.allEpisodes}</Text>
                {seasons.map(([seasonNum, eps]) => {
                  const watchedCount = eps.filter((e) => watchedIds.has(e.id)).length;
                  const complete = watchedCount === eps.length;
                  const expanded = expandedSeason === seasonNum;
                  return (
                    <SeasonSection
                      key={seasonNum}
                      seasonNum={seasonNum}
                      eps={eps}
                      watchedCount={watchedCount}
                      complete={complete}
                      expanded={expanded}
                      watchedIds={watchedIds}
                      watched={watched}
                      onToggleExpand={() => setExpandedSeason(expanded ? null : seasonNum)}
                      onSeasonCheckPress={() => handleSeasonCheckPress(eps, complete)}
                      onToggleEpisode={toggleEpisode}
                      onRewatchEpisode={rewatchEpisode}
                      onOpenEpisode={(ep) =>
                        router.push({ pathname: "/episode/[id]", params: { id: String(ep.id), showId: String(showId) } })
                      }
                      colors={colors}
                      styles={styles}
                      t={t}
                    />
                  );
                })}
              </View>
            )}
          </Animated.View>
        </View>
      </ScrollView>

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
        {userShow ? (
          <>
            <Pressable style={styles.menuItem} onPress={handlePause}>
              <Ionicons
                name={userShow.status === "paused" ? "play-outline" : "pause-circle-outline"}
                size={20}
                color={colors.text}
              />
              <Text style={styles.menuItemText}>
                {userShow.status === "paused" ? t.showDetail.resumeFromPause : t.showDetail.pauseShow}
              </Text>
            </Pressable>
            <Pressable style={styles.menuItem} onPress={handleStop}>
              <Ionicons
                name={userShow.status === "dropped" ? "play-outline" : "stop-circle-outline"}
                size={20}
                color={colors.text}
              />
              <Text style={styles.menuItemText}>
                {userShow.status === "dropped" ? t.showDetail.resumeTracking : t.showDetail.stopShow}
              </Text>
            </Pressable>
            <Pressable style={styles.menuItem} onPress={handleToggleFavorite}>
              <Ionicons name={userShow.is_favorite ? "star" : "star-outline"} size={20} color={colors.text} />
              <Text style={styles.menuItemText}>
                {userShow.is_favorite ? t.showDetail.removeFavorite : t.showDetail.addFavorite}
              </Text>
            </Pressable>
            <Pressable style={styles.menuItem} onPress={openListPicker}>
              <Ionicons name="list-outline" size={20} color={colors.text} />
              <Text style={styles.menuItemText}>{t.showDetail.addToAList}</Text>
            </Pressable>
            <Pressable style={styles.menuItem} onPress={handleRemoveFromList}>
              <Ionicons name="trash-outline" size={20} color={colors.red} />
              <Text style={[styles.menuItemText, { color: colors.red }]}>{t.showDetail.removeFromList}</Text>
            </Pressable>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                setReporting(true);
              }}
            >
              <Ionicons name="flag-outline" size={20} color={colors.text} />
              <Text style={styles.menuItemText}>{t.report.reportShow}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                toggleInList();
                setMenuOpen(false);
              }}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.text} />
              <Text style={styles.menuItemText}>{t.showDetail.addToMyList}</Text>
            </Pressable>
            <Pressable style={styles.menuItem} onPress={openListPicker}>
              <Ionicons name="list-outline" size={20} color={colors.text} />
              <Text style={styles.menuItemText}>{t.showDetail.addToAList}</Text>
            </Pressable>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                setReporting(true);
              }}
            >
              <Ionicons name="flag-outline" size={20} color={colors.text} />
              <Text style={styles.menuItemText}>{t.report.reportShow}</Text>
            </Pressable>
          </>
        )}
      </Sheet>

      <ReportModal
        visible={reporting}
        onClose={() => setReporting(false)}
        target={{ targetType: "show", targetTvmazeShowId: showId }}
      />

      <Sheet visible={listPickerOpen} onClose={() => setListPickerOpen(false)}>
        <Text style={styles.menuSheetTitle}>{t.showDetail.addToAList}</Text>
        {lists.map((list) => (
          <Pressable key={list.id} style={styles.menuItem} onPress={() => handleAddToList(list.id)}>
            <Ionicons name="list-outline" size={20} color={colors.text} />
            <Text style={styles.menuItemText}>{list.name}</Text>
          </Pressable>
        ))}
        <View style={styles.newListRow}>
          <TextInput
            style={styles.newListInput}
            placeholder={t.showDetail.newListPlaceholder}
            placeholderTextColor={colors.textFaint}
            value={newListName}
            onChangeText={setNewListName}
          />
          <Pressable style={styles.newListBtn} onPress={handleCreateList}>
            <Ionicons name="add" size={20} color={colors.onAccent} />
          </Pressable>
        </View>
      </Sheet>
    </View>
  );
}

type ShowStyles = ReturnType<typeof createStyles>;

function TrackCard({
  episode,
  onPress,
  colors,
  styles,
}: {
  episode: TVMazeEpisode;
  onPress: () => void;
  colors: Colors;
  styles: ShowStyles;
}) {
  const { scale, onPressIn, onPressOut } = useScalePress();
  const mountIn = useMountIn();

  return (
    <Pressable onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress}>
      <Animated.View style={[styles.trackCard, { opacity: mountIn.opacity, transform: [...mountIn.transform, { scale }] }]}>
        {episode.image ? (
          <Image source={{ uri: episode.image.medium }} style={styles.trackImage} />
        ) : (
          <View style={[styles.trackImage, { backgroundColor: colors.backgroundAlt }]} />
        )}
        <Text style={styles.trackCode}>
          S{String(episode.season).padStart(2, "0")} · E{String(episode.number).padStart(2, "0")}
        </Text>
        <Text style={styles.trackTitle} numberOfLines={1}>
          {episode.name}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function SeasonSection({
  seasonNum,
  eps,
  watchedCount,
  complete,
  expanded,
  watchedIds,
  watched,
  onToggleExpand,
  onSeasonCheckPress,
  onToggleEpisode,
  onRewatchEpisode,
  onOpenEpisode,
  colors,
  styles,
  t,
}: {
  seasonNum: number;
  eps: TVMazeEpisode[];
  watchedCount: number;
  complete: boolean;
  expanded: boolean;
  watchedIds: Set<number>;
  watched: WatchedEpisode[];
  onToggleExpand: () => void;
  onSeasonCheckPress: () => void;
  onToggleEpisode: (ep: TVMazeEpisode) => void;
  onRewatchEpisode: (ep: TVMazeEpisode) => void;
  onOpenEpisode: (ep: TVMazeEpisode) => void;
  colors: Colors;
  styles: ShowStyles;
  t: Translations;
}) {
  const { scale, onPressIn, onPressOut } = useScalePress(0.98);

  return (
    <View>
      <Pressable onPressIn={onPressIn} onPressOut={onPressOut} onPress={onToggleExpand}>
        <Animated.View style={[styles.seasonRow, { transform: [{ scale }] }]}>
          <View style={styles.seasonLeft}>
            <Text style={styles.seasonTitle}>{t.showDetail.season(seasonNum)}</Text>
            <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.text} />
          </View>
          <Text style={styles.seasonCount}>
            {watchedCount}/{eps.length}
          </Text>
          <Pressable
            style={[styles.seasonCheck, complete && styles.seasonCheckComplete]}
            onPress={(e) => {
              e.stopPropagation();
              onSeasonCheckPress();
            }}
            hitSlop={8}
          >
            <Ionicons name={complete ? "checkmark" : "add"} size={16} color={complete ? "#fff" : colors.textFaint} />
          </Pressable>
        </Animated.View>
      </Pressable>
      <View style={[styles.seasonBar, complete && styles.seasonBarComplete]} />
      {expanded &&
        eps.map((ep) => (
          <Pressable key={ep.id} style={styles.episodeLine} onPress={() => onOpenEpisode(ep)}>
            <Text style={styles.episodeLineText} numberOfLines={1}>
              E{ep.number} · {ep.name}
            </Text>
            <WatchedCheck
              watched={watchedIds.has(ep.id)}
              timesWatched={watched.find((w) => w.tvmaze_episode_id === ep.id)?.times_watched}
              onToggle={() => onToggleEpisode(ep)}
              onRewatch={() => onRewatchEpisode(ep)}
              size={26}
            />
          </Pressable>
        ))}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
  screen: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  hero: { height: 320, backgroundColor: "#111", position: "relative" },
  heroImage: { width: "100%", height: "100%", position: "absolute" },
  heroGradient: { position: "absolute", left: 0, right: 0, bottom: 0, height: 150 },
  heroTopRow: {
    position: "absolute",
    top: 16,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
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
    marginTop: -28,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: 20,
    paddingHorizontal: 16,
  },
  heroTitle: { color: colors.text, fontSize: type.display, fontWeight: "800" },
  heroMeta: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.pillBg, overflow: "hidden" },
  progressBar: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  progressBarComplete: { backgroundColor: colors.green },
  progressBarDropped: { backgroundColor: colors.red },
  progressBarPaused: { backgroundColor: colors.yellow },
  progressLabel: { fontSize: 12, fontWeight: "800", color: colors.textMuted, width: 36, textAlign: "right" },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.backgroundAlt,
  },
  addRowActive: { backgroundColor: colors.accentSoft },
  addLabel: { fontWeight: "700", fontSize: 13, color: colors.text },
  tabsRow: { flexDirection: "row", borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, marginTop: 16 },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 14 },
  tabText: { fontWeight: "800", fontSize: 13, color: colors.textFaint, letterSpacing: 0.4 },
  tabTextActive: { color: colors.accent },
  tabUnderline: { height: 2, backgroundColor: colors.accent, width: "50%", marginTop: 8 },
  section: { paddingVertical: 16 },
  sectionHeader: { fontSize: type.subtitle, fontWeight: "800", color: colors.text, marginBottom: 12 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 20 },
  summary: { color: colors.text, fontSize: 14, lineHeight: 21, marginBottom: 12 },
  meta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  castCard: { width: 84, marginRight: 12 },
  castImage: { width: 84, height: 84, borderRadius: radius.md, backgroundColor: colors.backgroundAlt },
  castImagePlaceholder: { alignItems: "center", justifyContent: "center" },
  castName: { fontWeight: "700", fontSize: 12, color: colors.text, marginTop: 6 },
  castCharacter: { fontSize: 11, color: colors.textMuted },
  trackCard: { width: 130, marginRight: 12 },
  trackImage: { width: 130, height: 80, borderRadius: radius.sm },
  trackCode: { fontWeight: "800", fontSize: 12, color: colors.text, marginTop: 6 },
  trackTitle: { fontSize: 12, color: colors.textMuted },
  seasonRow: { flexDirection: "row", alignItems: "center", paddingVertical: 14 },
  seasonLeft: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  seasonTitle: { fontWeight: "800", fontSize: type.body, color: colors.text },
  seasonCount: { color: colors.textMuted, fontSize: 13, marginRight: 10 },
  seasonCheck: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  seasonCheckComplete: { backgroundColor: colors.green, borderColor: colors.green },
  seasonBar: { height: 2, backgroundColor: colors.accent, marginBottom: 4 },
  seasonBarComplete: { backgroundColor: colors.green },
  episodeLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingLeft: 8,
  },
  episodeLineText: { flex: 1, color: colors.text, fontSize: 13, marginRight: 10 },
  menuSheetTitle: { fontSize: type.subtitle, fontWeight: "800", color: colors.text, marginBottom: 8 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  menuItemText: { fontSize: type.body, fontWeight: "600", color: colors.text },
  newListRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  newListInput: {
    flex: 1,
    backgroundColor: colors.backgroundAlt,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 14,
  },
  newListBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  });
}
