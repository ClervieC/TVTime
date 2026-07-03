import { useState, useCallback, useMemo } from "react";
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable, Image, TextInput } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getShow, getShowEpisodes, TVMazeShow, TVMazeEpisode } from "../../lib/tvmaze";
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
import { colors, radius } from "../../lib/theme";
import { WatchedCheck } from "../../components/WatchedCheck";

function stripHtml(html: string | null) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "");
}

export default function ShowDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const showId = Number(id);

  const [tab, setTab] = useState<"ABOUT" | "EPISODES">("EPISODES");
  const [show, setShow] = useState<TVMazeShow | null>(null);
  const [episodes, setEpisodes] = useState<TVMazeEpisode[]>([]);
  const [userShow, setUserShow] = useState<UserShow | null>(null);
  const [watched, setWatched] = useState<WatchedEpisode[]>([]);
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [listPickerOpen, setListPickerOpen] = useState(false);
  const [lists, setLists] = useState<ShowList[]>([]);
  const [newListName, setNewListName] = useState("");

  const load = useCallback(async () => {
    const [showData, episodeData, userShows, watchedData] = await Promise.all([
      getShow(showId),
      getShowEpisodes(showId),
      fetchUserShows(),
      fetchWatchedEpisodes(showId),
    ]);
    setShow(showData);
    setEpisodes(episodeData);
    setUserShow(userShows.find((s) => s.tvmaze_id === showId) ?? null);
    setWatched(watchedData);
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

  return (
    <View style={styles.screen}>
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        {show.image && <Image source={{ uri: show.image.original }} style={styles.heroImage} />}
        <View style={styles.heroOverlay} />
        <Pressable style={styles.closeBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-down" size={22} color="#fff" />
        </Pressable>
        <Pressable style={styles.moreBtn} onPress={() => setMenuOpen(true)}>
          <Ionicons name="ellipsis-horizontal" size={20} color="#fff" />
        </Pressable>
        <View style={styles.heroBottom}>
          <Text style={styles.heroTitle}>{show.name}</Text>
          <Text style={styles.heroMeta}>
            {show.network?.name ?? show.webChannel?.name ?? ""}
            {show.rating.average ? ` · ⭐ ${show.rating.average}` : ""}
          </Text>
        </View>
      </View>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressBar,
            { width: `${Math.round(progress * 100)}%` },
            userShow?.status === "dropped"
              ? styles.progressBarDropped
              : progress >= 1 && styles.progressBarComplete,
          ]}
        />
      </View>

      <View style={styles.addRow}>
        <Pressable style={[styles.addBtn, userShow && styles.addBtnActive]} onPress={toggleInList}>
          <Ionicons name={userShow ? "checkmark" : "add"} size={20} color={userShow ? "#fff" : colors.accent} />
        </Pressable>
        <Text style={styles.addLabel}>{userShow ? "Dans ma liste" : "Ajouter à ma liste"}</Text>
      </View>

      <View style={styles.tabsRow}>
        <Pressable style={styles.tabBtn} onPress={() => setTab("ABOUT")}>
          <Text style={[styles.tabText, tab === "ABOUT" && styles.tabTextActive]}>ABOUT</Text>
          {tab === "ABOUT" && <View style={styles.tabUnderline} />}
        </Pressable>
        <Pressable style={styles.tabBtn} onPress={() => setTab("EPISODES")}>
          <Text style={[styles.tabText, tab === "EPISODES" && styles.tabTextActive]}>EPISODES</Text>
          {tab === "EPISODES" && <View style={styles.tabUnderline} />}
        </Pressable>
      </View>

      {tab === "ABOUT" ? (
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Show info</Text>
          <Text style={styles.summary}>{stripHtml(show.summary)}</Text>
          <Text style={styles.meta}>{show.genres.join(", ")}</Text>
          <Text style={styles.meta}>
            {show.premiered?.slice(0, 4)}
            {show.ended ? ` – ${show.ended.slice(0, 4)}` : " – Présent"}
          </Text>
          <Text style={styles.meta}>{show.status}</Text>
        </View>
      ) : (
        <View style={styles.section}>
          {continueTracking.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>Continue tracking</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
                {continueTracking.map((ep) => (
                  <Pressable
                    key={ep.id}
                    style={styles.trackCard}
                    onPress={() =>
                      router.push({ pathname: "/episode/[id]", params: { id: String(ep.id), showId: String(showId) } })
                    }
                  >
                    {ep.image ? (
                      <Image source={{ uri: ep.image.medium }} style={styles.trackImage} />
                    ) : (
                      <View style={[styles.trackImage, { backgroundColor: colors.backgroundAlt }]} />
                    )}
                    <Text style={styles.trackCode}>
                      S{String(ep.season).padStart(2, "0")} | E{String(ep.number).padStart(2, "0")}
                    </Text>
                    <Text style={styles.trackTitle} numberOfLines={1}>
                      {ep.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}

          <Text style={styles.sectionHeader}>All episodes</Text>
          {seasons.map(([seasonNum, eps]) => {
            const watchedCount = eps.filter((e) => watchedIds.has(e.id)).length;
            const complete = watchedCount === eps.length;
            const expanded = expandedSeason === seasonNum;
            return (
              <View key={seasonNum}>
                <Pressable
                  style={styles.seasonRow}
                  onPress={() => setExpandedSeason(expanded ? null : seasonNum)}
                >
                  <View style={styles.seasonLeft}>
                    <Text style={styles.seasonTitle}>Season {seasonNum}</Text>
                    <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.text} />
                  </View>
                  <Text style={styles.seasonCount}>
                    {watchedCount}/{eps.length}
                  </Text>
                  <Pressable
                    style={[styles.seasonCheck, complete && styles.seasonCheckComplete]}
                    onPress={(e) => {
                      e.stopPropagation();
                      if (!complete) markSeasonWatched(eps);
                    }}
                    hitSlop={8}
                  >
                    <Ionicons
                      name={complete ? "checkmark" : "add"}
                      size={16}
                      color={complete ? "#fff" : colors.textFaint}
                    />
                  </Pressable>
                </Pressable>
                <View style={[styles.seasonBar, complete && styles.seasonBarComplete]} />
                {expanded &&
                  eps.map((ep) => (
                    <Pressable
                      key={ep.id}
                      style={styles.episodeLine}
                      onPress={() =>
                        router.push({ pathname: "/episode/[id]", params: { id: String(ep.id), showId: String(showId) } })
                      }
                    >
                      <Text style={styles.episodeLineText} numberOfLines={1}>
                        E{ep.number} · {ep.name}
                      </Text>
                      <WatchedCheck
                        watched={watchedIds.has(ep.id)}
                        timesWatched={watched.find((w) => w.tvmaze_episode_id === ep.id)?.times_watched}
                        onToggle={() => toggleEpisode(ep)}
                        onRewatch={() => rewatchEpisode(ep)}
                        size={26}
                      />
                    </Pressable>
                  ))}
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>

      {menuOpen && (
        <Pressable style={styles.modalBackdrop} onPress={() => setMenuOpen(false)}>
          <Pressable style={styles.menuSheet} onPress={(e) => e.stopPropagation()}>
            {userShow ? (
              <>
                <Pressable style={styles.menuItem} onPress={handleStop}>
                  <Ionicons
                    name={userShow.status === "dropped" ? "play-outline" : "stop-circle-outline"}
                    size={20}
                    color={colors.text}
                  />
                  <Text style={styles.menuItemText}>
                    {userShow.status === "dropped" ? "Reprendre le suivi" : "Arrêter la série"}
                  </Text>
                </Pressable>
                <Pressable style={styles.menuItem} onPress={handleToggleFavorite}>
                  <Ionicons name={userShow.is_favorite ? "star" : "star-outline"} size={20} color={colors.text} />
                  <Text style={styles.menuItemText}>
                    {userShow.is_favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                  </Text>
                </Pressable>
                <Pressable style={styles.menuItem} onPress={openListPicker}>
                  <Ionicons name="list-outline" size={20} color={colors.text} />
                  <Text style={styles.menuItemText}>Ajouter à une liste</Text>
                </Pressable>
                <Pressable style={styles.menuItem} onPress={handleRemoveFromList}>
                  <Ionicons name="trash-outline" size={20} color={colors.red} />
                  <Text style={[styles.menuItemText, { color: colors.red }]}>Retirer de ma liste</Text>
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
                  <Text style={styles.menuItemText}>Ajouter à ma liste</Text>
                </Pressable>
                <Pressable style={styles.menuItem} onPress={openListPicker}>
                  <Ionicons name="list-outline" size={20} color={colors.text} />
                  <Text style={styles.menuItemText}>Ajouter à une liste</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      )}

      {listPickerOpen && (
        <Pressable style={styles.modalBackdrop} onPress={() => setListPickerOpen(false)}>
          <Pressable style={styles.menuSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.menuSheetTitle}>Ajouter à une liste</Text>
            {lists.map((list) => (
              <Pressable key={list.id} style={styles.menuItem} onPress={() => handleAddToList(list.id)}>
                <Ionicons name="list-outline" size={20} color={colors.text} />
                <Text style={styles.menuItemText}>{list.name}</Text>
              </Pressable>
            ))}
            <View style={styles.newListRow}>
              <TextInput
                style={styles.newListInput}
                placeholder="Nouvelle liste"
                placeholderTextColor={colors.textFaint}
                value={newListName}
                onChangeText={setNewListName}
              />
              <Pressable style={styles.newListBtn} onPress={handleCreateList}>
                <Ionicons name="add" size={20} color={colors.black} />
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  hero: { height: 280, backgroundColor: "#111", position: "relative" },
  heroImage: { width: "100%", height: "100%", position: "absolute" },
  heroOverlay: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.25)" },
  closeBtn: { position: "absolute", top: 16, left: 16 },
  moreBtn: { position: "absolute", top: 16, right: 16 },
  heroBottom: { position: "absolute", left: 16, right: 16, bottom: 16 },
  heroTitle: { color: "#fff", fontSize: 28, fontWeight: "800" },
  heroMeta: { color: "#eee", fontSize: 13, marginTop: 4 },
  progressTrack: { height: 4, backgroundColor: colors.pillBg },
  progressBar: { height: 4, backgroundColor: colors.accent },
  progressBarComplete: { backgroundColor: colors.green },
  progressBarDropped: { backgroundColor: colors.red },
  addRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16 },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnActive: { backgroundColor: colors.green, borderColor: colors.green },
  addLabel: { fontWeight: "700", fontSize: 13, color: colors.text },
  tabsRow: { flexDirection: "row", borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 14 },
  tabText: { fontWeight: "800", fontSize: 13, color: colors.textFaint, letterSpacing: 0.4 },
  tabTextActive: { color: colors.black },
  tabUnderline: { height: 2, backgroundColor: colors.black, width: "50%", marginTop: 8 },
  section: { padding: 16 },
  sectionHeader: { fontSize: 18, fontWeight: "800", color: colors.text, marginBottom: 12 },
  summary: { color: colors.text, fontSize: 14, lineHeight: 21, marginBottom: 12 },
  meta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
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
