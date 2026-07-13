import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, View, Text, ScrollView, Pressable, StyleSheet, TextInput, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useMountIn } from "../../lib/animations";
import * as DocumentPicker from "expo-document-picker";
import { useAuth } from "../../context/AuthContext";
import { createList, fetchAllListItems, fetchEpisodeCount, fetchFavoriteEpisodes, fetchFavorites, fetchLists, fetchUserShows, ListItem, ShowList, UserShow, WatchedEpisode } from "../../lib/userShows";
import { getCachedShow } from "../../lib/showDataCache";
import { getShow } from "../../lib/tvmaze";
import { fetchUserMovies, fetchFavoriteMovies, UserMovie } from "../../lib/userMovies";
import { useColors, radius, type, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";
import { fetchMyProfile, uploadAvatar, Profile } from "../../lib/profiles";
import { fetchFollowCounts } from "../../lib/follows";
import { fetchOpenReportCount } from "../../lib/reports";
import { fetchOpenSupportMessageCount } from "../../lib/support";
import { isRecapAvailable } from "../../lib/recap";
import { computeStreakData, loadLocalStreakData, StreakData } from "../../lib/streaks";
import { useBadgeUnlockToast } from "../../context/BadgeUnlockContext";
import { loadProfileSnapshot, saveProfileSnapshot } from "../../lib/profileSnapshot";
import { alert } from "../../lib/alert";
import { useScrollToTopOnTabPress } from "../../lib/useScrollToTopOnTabPress";
import { useNotifications } from "../../context/NotificationsContext";
import { ShowCard } from "../../components/ShowCard";
import { MovieCard } from "../../components/MovieCard";
import { Avatar } from "../../components/Avatar";
import { EmptyState } from "../../components/EmptyState";

const AVG_EPISODE_MINUTES = 42;
// TMDB runtime per movie isn't fetched in bulk here (that's up to 700+ calls
// just for a stat) — a flat feature-length estimate mirrors how show watch
// time already estimates from AVG_EPISODE_MINUTES rather than exact runtimes.
const AVG_MOVIE_MINUTES = 110;

// Mirrors app/(tabs)/_layout.tsx's own refetch throttle — this screen's
// useFocusEffect fires on every return to the Profile tab (including
// quick in-and-out navigation, e.g. opening and closing a list), and load()
// is nine separate Supabase round trips (shows, movies, favorite movies,
// favorites, lists, every list item across every list, episode count,
// unread count, profile+follow counts), unconditionally. This bounds that
// to at most once per interval; the explicit post-import load() call below
// still always runs immediately regardless.
const MIN_RELOAD_INTERVAL_MS = 10_000;

function formatTvTime(totalMinutes: number) {
  const totalHours = Math.floor(totalMinutes / 60);
  const months = Math.floor(totalHours / (24 * 30));
  const days = Math.floor((totalHours % (24 * 30)) / 24);
  const hours = totalHours % 24;
  return { months, days, hours };
}

export default function ProfileScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const [shows, setShows] = useState<UserShow[]>([]);
  const [movies, setMovies] = useState<UserMovie[]>([]);
  const [favorites, setFavorites] = useState<UserShow[]>([]);
  const [favoriteMovies, setFavoriteMovies] = useState<UserMovie[]>([]);
  const [lists, setLists] = useState<ShowList[]>([]);
  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [episodeCount, setEpisodeCount] = useState(0);
  const [creatingList, setCreatingList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [favoriteEpisodes, setFavoriteEpisodes] = useState<
    (WatchedEpisode & { showName: string; showImage: string | null })[]
  >([]);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [streakData, setStreakData] = useState<StreakData | null>(null);
  const [hasAdminAlerts, setHasAdminAlerts] = useState(false);
  const { unreadCount, refresh: refreshNotifications } = useNotifications();
  const announceBadges = useBadgeUnlockToast();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();

  const lastLoadedAt = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTopOnTabPress(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
  // Seeds every list/count from the last on-disk snapshot (see
  // lib/profileSnapshot.ts) so the screen paints instantly on open instead of
  // sitting blank until the nine Supabase round trips below land — mirrors
  // the Shows tab's own watchingSnapshot pattern. Runs once, before the first
  // load() below overwrites it with fresh data.
  useEffect(() => {
    let active = true;
    loadProfileSnapshot().then((snapshot) => {
      if (!active || !snapshot) return;
      setShows(snapshot.shows);
      setMovies(snapshot.movies);
      setFavoriteMovies(snapshot.favoriteMovies);
      setFavorites(snapshot.favorites);
      setLists(snapshot.lists);
      setListItems(snapshot.listItems);
      setEpisodeCount(snapshot.episodeCount);
    });
    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(() => {
    lastLoadedAt.current = Date.now();
    Promise.all([
      fetchUserShows(),
      fetchUserMovies(),
      fetchFavoriteMovies(),
      fetchFavorites(),
      fetchLists(),
      fetchAllListItems(),
      fetchEpisodeCount(),
    ]).then(([shows, movies, favoriteMovies, favorites, lists, listItems, episodeCount]) => {
      setShows(shows);
      setMovies(movies);
      setFavoriteMovies(favoriteMovies);
      setFavorites(favorites);
      setLists(lists);
      setListItems(listItems);
      setEpisodeCount(episodeCount);
      saveProfileSnapshot({ shows, movies, favoriteMovies, favorites, lists, listItems, episodeCount });
    });
    fetchMyProfile().then((p) => {
      setProfile(p);
      if (p) fetchFollowCounts(p.user_id).then(setFollowCounts);
      if (p?.is_admin) {
        Promise.all([fetchOpenReportCount(), fetchOpenSupportMessageCount()])
          .then(([reports, support]) => setHasAdminAlerts(reports + support > 0))
          .catch(() => {});
      }
    });
    // watched_episodes only stores a tvmaze_show_id, not the show's own
    // name/image (that lives on user_shows, a separate row) — same
    // enrichment lib/activity.ts already does for the same reason, backed
    // by the same on-disk show cache every other screen warms.
    fetchFavoriteEpisodes().then(async (episodes) => {
      const showIds = [...new Set(episodes.map((e) => e.tvmaze_show_id))];
      const showById = new Map<number, { name: string; image: string | null }>();
      await Promise.allSettled(
        showIds.map(async (id) => {
          const show = await getCachedShow(id, () => getShow(id));
          showById.set(id, { name: show.name, image: show.image?.medium ?? null });
        })
      );
      setFavoriteEpisodes(
        episodes.map((e) => ({
          ...e,
          showName: showById.get(e.tvmaze_show_id)?.name ?? `#${e.tvmaze_show_id}`,
          showImage: showById.get(e.tvmaze_show_id)?.image ?? null,
        }))
      );
    });
    // Local IndexedDB read first — instant, no network round trip — then a
    // fresh compute reconciles it in the background. Without this the streak
    // banner stayed blank until the full computation (a watched_episodes
    // scan plus several count queries) finished on every single Profile
    // visit.
    loadLocalStreakData().then((local) => {
      if (local) setStreakData(local);
    });
    computeStreakData(announceBadges).then(setStreakData).catch(() => {});
  }, [announceBadges]);

  // Stable references so MovieCard's memo() can skip re-rendering unrelated
  // cards — a movie can appear in both `movies` and `favoriteMovies`, so both
  // are patched together rather than refetching either collection.
  const handleMovieUnwatched = useCallback((id: string) => {
    setMovies((prev) => prev.filter((m) => m.id !== id));
    setFavoriteMovies((prev) => prev.filter((m) => m.id !== id));
  }, []);
  const handleMovieRewatched = useCallback((updated: UserMovie) => {
    setMovies((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    setFavoriteMovies((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Unconditional (unlike load() below) — app/(tabs)/_layout.tsx's own
      // refresh is Stack-level and deliberately doesn't fire on a same-group
      // tab switch into Profile, so this is what catches a notification that
      // arrived while the user was on another tab. Cheap enough (one count
      // query) not to need its own throttle.
      refreshNotifications();
      if (Date.now() - lastLoadedAt.current < MIN_RELOAD_INTERVAL_MS) return;
      load();
    }, [load, refreshNotifications])
  );

  async function handleCreateList() {
    if (!newListName.trim()) return;
    await createList(newListName.trim());
    setNewListName("");
    setCreatingList(false);
    fetchLists().then(setLists);
  }

  async function handleChangeAvatar() {
    const result = await DocumentPicker.getDocumentAsync({ type: "image/*", copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    setUploadingAvatar(true);
    try {
      const avatarUrl = await uploadAvatar(asset.uri, asset.mimeType ?? "image/jpeg");
      setProfile((prev) => (prev ? { ...prev, avatar_url: avatarUrl } : prev));
    } catch {
      alert(t.profile.changePhoto, t.profile.changePhotoFailed);
    } finally {
      setUploadingAvatar(false);
    }
  }

  const pausedShows = useMemo(() => shows.filter((s) => s.status === "paused"), [shows]);
  const droppedShows = useMemo(() => shows.filter((s) => s.status === "dropped"), [shows]);

  const email = session?.user.email ?? "";
  const displayName = profile?.username ?? email.split("@")[0] ?? "Moi";
  const tvTime = formatTvTime(episodeCount * AVG_EPISODE_MINUTES);
  const movieWatchCount = useMemo(() => movies.reduce((sum, m) => sum + m.times_watched, 0), [movies]);
  const movieTime = formatTvTime(movieWatchCount * AVG_MOVIE_MINUTES);

  const headerIn = useMountIn();

  return (
    <ScrollView ref={scrollRef} style={styles.container} showsVerticalScrollIndicator={false}>
      <LinearGradient colors={[`${colors.accent}1f`, "transparent"]} style={styles.headerGlow} />
      <Animated.View style={[styles.header, { opacity: headerIn.opacity, transform: headerIn.transform }]}>
        <Pressable onPress={handleChangeAvatar} disabled={uploadingAvatar} accessibilityRole="button" accessibilityLabel={t.profile.changePhoto}>
          <Avatar name={displayName} imageUri={profile?.avatar_url} size="md" />
          <View style={styles.avatarEditBadge}>
            {uploadingAvatar ? (
              <ActivityIndicator size="small" color={colors.onAccent} />
            ) : (
              <Ionicons name="camera" size={13} color={colors.onAccent} />
            )}
          </View>
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={styles.username}>{displayName}</Text>
          {!!email && (
            <Text style={styles.userEmail} numberOfLines={1}>
              {email}
            </Text>
          )}
        </View>
        <Pressable
          style={styles.bellBtn}
          onPress={() => router.push("/notifications")}
          accessibilityRole="button"
          accessibilityLabel={t.social.notifications}
        >
          <Ionicons name="notifications-outline" size={20} color={colors.text} />
          {unreadCount > 0 && <View style={styles.bellBadge} />}
        </Pressable>
        <Pressable
          style={styles.bellBtn}
          onPress={() => router.push("/settings")}
          accessibilityRole="button"
          accessibilityLabel={t.profile.settings}
        >
          <Ionicons name="settings-outline" size={20} color={colors.text} />
          {hasAdminAlerts && <View style={styles.bellBadge} />}
        </Pressable>
      </Animated.View>

      {profile && (
        <View style={styles.followRow}>
          <Pressable
            style={styles.followStat}
            onPress={() => router.push({ pathname: "/connections/[id]", params: { id: profile.user_id, type: "followers" } })}
          >
            <Text style={styles.followNumber}>{followCounts.followers}</Text>
            <Text style={styles.followLabel}>{t.profile.followers}</Text>
          </Pressable>
          <Pressable
            style={[styles.followStat, styles.followStatBorder]}
            onPress={() => router.push({ pathname: "/connections/[id]", params: { id: profile.user_id, type: "following" } })}
          >
            <Text style={styles.followNumber}>{followCounts.following}</Text>
            <Text style={styles.followLabel}>{t.profile.following}</Text>
          </Pressable>
        </View>
      )}

      <Pressable style={styles.importRow} onPress={() => router.push("/users/search")}>
        <Ionicons name="people-outline" size={20} color={colors.text} />
        <Text style={[styles.importRowTitle, { flex: 1 }]}>{t.social.findPeople}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </Pressable>

      {isRecapAvailable() && (
        <Pressable style={styles.recapBanner} onPress={() => router.push("/recap")}>
          <View style={styles.recapBannerIcon}>
            <Ionicons name="sparkles" size={20} color={colors.onAccent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.recapBannerTitle}>{t.profile.recapTitle(new Date().getFullYear())}</Text>
            <Text style={styles.recapBannerSubtitle}>{t.profile.recapSubtitle}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.onAccent} />
        </Pressable>
      )}

      {streakData && (
        <Pressable style={styles.streakBanner} onPress={() => router.push("/streaks")}>
          <View style={styles.streakBannerIcon}>
            <Ionicons name="flame" size={20} color="#ff9f43" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.streakBannerTitle}>{t.profile.streaksTitle}</Text>
            <Text style={styles.streakBannerSubtitle}>
              {streakData.currentStreak > 0
                ? t.profile.streakBannerActive(streakData.currentStreak)
                : t.profile.streakBannerInactive}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </Pressable>
      )}

      <SectionHeader title={t.profile.statistics} styles={styles} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsRow}>
        <StatCard
          icon="time-outline"
          color={colors.blue}
          label={t.profile.watchTime}
          value={`${tvTime.months}${t.profile.months[0]} ${tvTime.days}${t.profile.days[0]} ${tvTime.hours}${t.profile.hours[0]}`}
          colors={colors}
          styles={styles}
          onPress={() => router.push("/stats/shows")}
        />
        <StatCard
          icon="checkmark-circle-outline"
          color={colors.green}
          label={t.profile.episodesWatched}
          value={episodeCount.toLocaleString()}
          colors={colors}
          styles={styles}
          onPress={() => router.push("/stats/shows")}
        />
        <StatCard
          icon="time-outline"
          color={colors.red}
          label={t.profile.movieWatchTime}
          value={`${movieTime.months}${t.profile.months[0]} ${movieTime.days}${t.profile.days[0]} ${movieTime.hours}${t.profile.hours[0]}`}
          colors={colors}
          styles={styles}
          onPress={() => router.push("/stats/shows?tab=movies")}
        />
        <StatCard
          icon="checkmark-circle-outline"
          color={colors.yellow}
          label={t.profile.moviesWatched}
          value={movies.length.toLocaleString()}
          colors={colors}
          styles={styles}
          onPress={() => router.push("/stats/shows?tab=movies")}
        />
      </ScrollView>

      <SectionHeader title={t.profile.favorites} count={favorites.length} styles={styles} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.showsRow}>
        {favorites.length === 0 ? (
          <Text style={styles.empty}>{t.profile.noFavorites}</Text>
        ) : (
          favorites.map((s) => (
            <ShowCard key={s.id} id={s.tvmaze_id} name={s.show_name} imageUrl={s.show_image} />
          ))
        )}
      </ScrollView>

      {favoriteEpisodes.length > 0 && (
        <>
          <SectionHeader title={t.profile.favoriteEpisodes} count={favoriteEpisodes.length} styles={styles} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.showsRow}>
            {favoriteEpisodes.map((e) => (
              <ShowCard
                key={e.id}
                id={e.tvmaze_episode_id}
                name={e.showName}
                imageUrl={e.showImage}
                subtitle={`S${String(e.season).padStart(2, "0")}E${String(e.number).padStart(2, "0")}`}
                onPress={() =>
                  router.push({
                    pathname: "/episode/[id]",
                    params: { id: String(e.tvmaze_episode_id), showId: String(e.tvmaze_show_id) },
                  })
                }
              />
            ))}
          </ScrollView>
        </>
      )}

      <SectionHeader title={t.profile.shows} count={shows.length} styles={styles} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.showsRow}>
        {shows.length === 0 ? (
          <Text style={styles.empty}>{t.profile.noShows}</Text>
        ) : (
          shows.map((s) => (
            <ShowCard key={s.id} id={s.tvmaze_id} name={s.show_name} imageUrl={s.show_image} />
          ))
        )}
      </ScrollView>

      <SectionHeader title={t.profile.favoriteMovies} count={favoriteMovies.length} styles={styles} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.showsRow}>
        {favoriteMovies.length === 0 ? (
          <Text style={styles.empty}>{t.profile.noFavoriteMovies}</Text>
        ) : (
          favoriteMovies.map((m) => (
            <View key={m.id} style={styles.movieCardWrap}>
              <MovieCard
                id={m.id}
                title={m.title}
                year={m.year}
                posterPath={m.poster_path}
                watchedAt={m.watched_at ?? m.created_at}
                timesWatched={m.times_watched}
                onUnwatched={handleMovieUnwatched}
                onRewatched={handleMovieRewatched}
              />
            </View>
          ))
        )}
      </ScrollView>

      <SectionHeader title={t.profile.movies} count={movies.length} styles={styles} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.showsRow}>
        {movies.length === 0 ? (
          <Text style={styles.empty}>{t.profile.noMovies}</Text>
        ) : (
          movies
            .slice(0, 20)
            .map((m) => (
              <View key={m.id} style={styles.movieCardWrap}>
                <MovieCard
                  id={m.id}
                  title={m.title}
                  year={m.year}
                  posterPath={m.poster_path}
                  watchedAt={m.watched_at ?? m.created_at}
                  timesWatched={m.times_watched}
                  onUnwatched={handleMovieUnwatched}
                  onRewatched={handleMovieRewatched}
                />
              </View>
            ))
        )}
      </ScrollView>

      <SectionHeader title={t.profile.lists} count={lists.length} styles={styles} />
      {lists.map((list) => {
        const items = listItems.filter((i) => i.list_id === list.id);
        return (
          <Pressable
            key={list.id}
            style={styles.listRow}
            onPress={() => router.push({ pathname: "/list/[id]", params: { id: list.id } })}
          >
            <View style={styles.listRowThumb}>
              <Ionicons name="list-outline" size={20} color={colors.textMuted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.listRowName}>{list.name}</Text>
              <Text style={styles.listRowCount}>{t.profile.seriesCount(items.length)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </Pressable>
        );
      })}

      {creatingList ? (
        <View style={styles.newListRow}>
          <TextInput
            style={styles.newListInput}
            placeholder={t.profile.newListPlaceholder}
            placeholderTextColor={colors.textFaint}
            value={newListName}
            onChangeText={setNewListName}
            autoFocus
          />
          <Pressable style={styles.newListBtn} onPress={handleCreateList}>
            <Ionicons name="checkmark" size={20} color={colors.onAccent} />
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.createList} onPress={() => setCreatingList(true)}>
          <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
          <Text style={styles.createListText}>{t.profile.createList}</Text>
        </Pressable>
      )}

      <SectionHeader title={t.profile.paused} count={pausedShows.length} styles={styles} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.showsRow}>
        {pausedShows.length === 0 ? (
          <Text style={styles.empty}>{t.profile.noPaused}</Text>
        ) : (
          pausedShows.map((s) => (
            <ShowCard key={s.id} id={s.tvmaze_id} name={s.show_name} imageUrl={s.show_image} />
          ))
        )}
      </ScrollView>

      <SectionHeader title={t.profile.dropped} count={droppedShows.length} styles={styles} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.showsRow}>
        {droppedShows.length === 0 ? (
          <Text style={styles.empty}>{t.profile.noDropped}</Text>
        ) : (
          droppedShows.map((s) => (
            <ShowCard key={s.id} id={s.tvmaze_id} name={s.show_name} imageUrl={s.show_image} />
          ))
        )}
      </ScrollView>

    </ScrollView>
  );
}

type ProfileStyles = ReturnType<typeof createStyles>;

function SectionHeader({ title, count, styles }: { title: string; count?: number; styles: ProfileStyles }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {count !== undefined && count > 0 && (
        <View style={styles.sectionCountPill}>
          <Text style={styles.sectionCountText}>{count}</Text>
        </View>
      )}
    </View>
  );
}

// Compact enough that show + movie stats fit on one horizontally-scrolling
// row instead of two full-width stacked cards — same information, a lot
// less vertical space.
function StatCard({
  icon,
  color,
  label,
  value,
  colors,
  styles,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  value: string;
  colors: Colors;
  styles: ProfileStyles;
  onPress?: () => void;
}) {
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper style={styles.statCard} onPress={onPress}>
      <View style={[styles.statCardIcon, { backgroundColor: `${color}22` }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <Text style={styles.statCardLabel}>{label}</Text>
      <Text style={styles.statCardValue}>{value}</Text>
      {onPress && <Ionicons name="chevron-forward" size={14} color={colors.textFaint} style={styles.statCardChevron} />}
    </Wrapper>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 160, pointerEvents: "none" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    paddingTop: 24,
  },
  headerInfo: { flex: 1 },
  avatarEditBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.background,
  },
  username: { fontSize: 20, fontWeight: "800", color: colors.text },
  userEmail: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  bellBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  bellBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.red,
  },
  adminBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.red,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  adminCountPill: {
    backgroundColor: colors.red,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginRight: 4,
  },
  adminCountPillText: { color: "#ffffff", fontSize: 11, fontWeight: "800" },
  followRow: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginTop: 4,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  followStat: { flex: 1, alignItems: "center" },
  followStatBorder: { borderLeftWidth: 1, borderLeftColor: colors.border },
  followNumber: { fontSize: type.title, fontWeight: "800", color: colors.text },
  followLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 12,
  },
  sectionTitle: { fontSize: type.subtitle, fontWeight: "800", color: colors.text },
  sectionCountPill: {
    backgroundColor: colors.pillBg,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sectionCountText: { fontSize: type.micro, fontWeight: "800", color: colors.textMuted },
  recapBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    marginTop: 20,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
  },
  recapBannerIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  recapBannerTitle: { color: colors.onAccent, fontWeight: "800", fontSize: 14 },
  recapBannerSubtitle: { color: colors.onAccent, opacity: 0.85, fontSize: 12, marginTop: 2 },
  streakBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  streakBannerIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  streakBannerTitle: { color: colors.text, fontWeight: "800", fontSize: 14 },
  streakBannerSubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  statsRow: { paddingHorizontal: 16, gap: 10 },
  statCard: {
    width: 140,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
  },
  statCardChevron: { position: "absolute", top: 12, right: 12 },
  statCardIcon: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  statCardLabel: { fontSize: 12, color: colors.textMuted, marginTop: 8 },
  statCardValue: { fontSize: type.title, fontWeight: "800", color: colors.text, marginTop: 2 },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  listRowThumb: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.backgroundAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  listRowName: { fontWeight: "700", fontSize: 14, color: colors.text },
  listRowCount: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  newListRow: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, marginTop: 12 },
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
  modalSubmitBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    padding: 14,
    alignItems: "center",
    marginTop: 4,
  },
  modalSubmitBtnText: { color: colors.onAccent, fontWeight: "700", fontSize: 15 },
  createList: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 12,
  },
  createListText: { fontWeight: "700", fontSize: 14, color: colors.accent },
  showsRow: { paddingHorizontal: 16, paddingBottom: 24 },
  // MovieCard is built for equal-width grid columns (flex:1) — wrapping it in
  // a fixed-width box here gives it the same kind of bounded parent a grid
  // column would, so it renders correctly inside this horizontal scroll.
  movieCardWrap: { width: 110, marginRight: 12 },
  empty: { color: colors.textMuted },
  importRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  importRowTitle: { fontWeight: "700", fontSize: 14, color: colors.text },
  importRowSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  importProgress: { marginHorizontal: 16, marginTop: 10 },
  importProgressText: { fontSize: 12, fontWeight: "700", color: colors.text },
  importProgressLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  languageSwitch: {
    flexDirection: "row",
    backgroundColor: colors.pillBg,
    borderRadius: radius.sm,
    padding: 3,
    gap: 2,
  },
  signOut: { alignItems: "center", paddingVertical: 24 },
  signOutText: { color: colors.red, fontWeight: "600" },
  });
}
