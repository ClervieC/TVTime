import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, ScrollView, Animated, StyleSheet, ActivityIndicator, Pressable, Image, TextInput } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getShow, getShowCast, getShowEpisodes, CastMember, TVMazeShow, TVMazeEpisode } from "../../lib/tvmaze";
import { getCachedEpisodes, getCachedShow, getCachedWatchedEpisodes } from "../../lib/showDataCache";
import {
  addShowToList,
  createList,
  fetchLists,
  fetchUserShows,
  fetchWatchedEpisodes,
  incrementRewatch,
  removeUserShow,
  setEpisodeWatched,
  setEpisodesWatched,
  setShowFavorite,
  setShowStatus,
  upsertUserShow,
  ShowList,
  UserShow,
  WatchedEpisode,
} from "../../lib/userShows";
import { useColors, radius, Colors } from "../../lib/theme";
import { useLanguage, Translations } from "../../lib/i18n";
import { useGrowIn, useFadeIn, useScalePress, useMountIn } from "../../lib/animations";
import { WatchedCheck } from "../../components/WatchedCheck";
import { usePreviousEpisodesPrompt } from "../../context/PreviousEpisodesPromptContext";

function stripHtml(html: string | null) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "");
}

export default function ShowDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const showId = Number(id);

  const [tab, setTab] = useState<"about" | "episodes">("episodes");
  const [show, setShow] = useState<TVMazeShow | null>(null);
  const [episodes, setEpisodes] = useState<TVMazeEpisode[]>([]);
  const [cast, setCast] = useState<CastMember[]>([]);
  const [userShow, setUserShow] = useState<UserShow | null>(null);
  const [watched, setWatched] = useState<WatchedEpisode[]>([]);
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [listPickerOpen, setListPickerOpen] = useState(false);
  const [lists, setLists] = useState<ShowList[]>([]);
  const [newListName, setNewListName] = useState("");
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const underlineGrow = useGrowIn(tab);
  const contentFade = useFadeIn(!loading);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const askPreviousEpisodes = usePreviousEpisodesPrompt();

  const load = useCallback(async () => {
    const [showData, episodeData, userShows, watchedData, castData] = await Promise.all([
      getCachedShow(showId, () => getShow(showId)),
      getCachedEpisodes(showId, () => getShowEpisodes(showId)),
      fetchUserShows(),
      getCachedWatchedEpisodes(showId, () => fetchWatchedEpisodes(showId)),
      getShowCast(showId).catch(() => []),
    ]);
    setShow(showData);
    setEpisodes(episodeData);
    setUserShow(userShows.find((s) => s.tvmaze_id === showId) ?? null);
    setWatched(watchedData);
    setCast(castData);
  }, [showId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      load().finally(() => active && setLoading(false));
      return () => {
        active = false;
      };
    }, [load])
  );

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
        <View style={styles.hero}>
          {show.image && <Image source={{ uri: show.image.original }} style={styles.heroImage} />}
          <LinearGradient colors={["transparent", colors.background]} style={styles.heroGradient} pointerEvents="none" />
          <View style={styles.heroTopRow}>
            <Pressable style={styles.iconBtn} onPress={() => router.back()}>
              <Ionicons name="chevron-down" size={22} color="#fff" />
            </Pressable>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {userShow && (
                <Pressable style={styles.iconBtn} onPress={handleToggleFavorite}>
                  <Ionicons
                    name={userShow.is_favorite ? "star" : "star-outline"}
                    size={19}
                    color={userShow.is_favorite ? colors.accent : "#fff"}
                  />
                </Pressable>
              )}
              <Pressable style={styles.iconBtn} onPress={() => setMenuOpen(true)}>
                <Ionicons name="ellipsis-horizontal" size={20} color="#fff" />
              </Pressable>
            </View>
          </View>
        </View>

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

                <View style={styles.divider} />
                <Text style={styles.sectionHeader}>{t.showDetail.comments}</Text>
                <View style={styles.commentsPlaceholder}>
                  <Ionicons name="chatbubble-outline" size={18} color={colors.textFaint} />
                  <Text style={styles.commentsPlaceholderText}>{t.showDetail.commentsSoon}</Text>
                </View>
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
                      onMarkSeasonWatched={() => markSeasonWatched(eps)}
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

      {menuOpen && (
        <Pressable style={styles.modalBackdrop} onPress={() => setMenuOpen(false)}>
          <Pressable style={styles.menuSheet} onPress={(e) => e.stopPropagation()}>
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
              </>
            )}
          </Pressable>
        </Pressable>
      )}

      {listPickerOpen && (
        <Pressable style={styles.modalBackdrop} onPress={() => setListPickerOpen(false)}>
          <Pressable style={styles.menuSheet} onPress={(e) => e.stopPropagation()}>
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
          </Pressable>
        </Pressable>
      )}
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
  onMarkSeasonWatched,
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
  onMarkSeasonWatched: () => void;
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
              if (!complete) onMarkSeasonWatched();
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
    borderRadius: 18,
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
  heroTitle: { color: colors.text, fontSize: 26, fontWeight: "800" },
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
  sectionHeader: { fontSize: 18, fontWeight: "800", color: colors.text, marginBottom: 12 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 20 },
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
  seasonTitle: { fontWeight: "800", fontSize: 15, color: colors.text },
  seasonCount: { color: colors.textMuted, fontSize: 13, marginRight: 10 },
  seasonCheck: {
    width: 26,
    height: 26,
    borderRadius: 13,
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
  modalBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  menuSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: 16,
    paddingBottom: 32,
    gap: 4,
  },
  menuSheetTitle: { fontSize: 16, fontWeight: "800", color: colors.text, marginBottom: 8 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  menuItemText: { fontSize: 15, fontWeight: "600", color: colors.text },
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
