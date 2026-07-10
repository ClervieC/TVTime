import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, TextInput, ActivityIndicator, Platform, Switch, Linking } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { createList, fetchAllListItems, fetchEpisodeCount, fetchFavoriteEpisodes, fetchFavorites, fetchLists, fetchUserShows, ListItem, ShowList, UserShow, WatchedEpisode } from "../../lib/userShows";
import { getCachedShow } from "../../lib/showDataCache";
import { getShow } from "../../lib/tvmaze";
import { fetchUserMovies, fetchFavoriteMovies, UserMovie } from "../../lib/userMovies";
import { importTvTimeCsv, importTvTimeJson, ImportProgress } from "../../lib/tvtimeImport";
import { useColors, useThemeMode, radius, type, Colors, ThemeMode } from "../../lib/theme";
import { useLanguage, Translations } from "../../lib/i18n";
import { Language } from "../../lib/userSettings";
import { fetchMyProfile, Profile } from "../../lib/profiles";
import { fetchFollowCounts } from "../../lib/follows";
import { changePassword, exportMyData, deleteAccount } from "../../lib/account";
import { fetchOpenReportCount } from "../../lib/reports";
import { loadProfileSnapshot, saveProfileSnapshot } from "../../lib/profileSnapshot";
import { alert } from "../../lib/alert";
import { useScrollToTopOnTabPress } from "../../lib/useScrollToTopOnTabPress";
import { useNotifications } from "../../context/NotificationsContext";
import { ShowCard } from "../../components/ShowCard";
import { MovieCard } from "../../components/MovieCard";
import { Pill } from "../../components/Pill";
import { Avatar } from "../../components/Avatar";
import { EmptyState } from "../../components/EmptyState";
import { Sheet } from "../../components/Sheet";

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
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [exportingData, setExportingData] = useState(false);
  const [openReportCount, setOpenReportCount] = useState(0);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [favoriteEpisodes, setFavoriteEpisodes] = useState<
    (WatchedEpisode & { showName: string; showImage: string | null })[]
  >([]);
  const { unreadCount, refresh: refreshNotifications } = useNotifications();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t, language, setLanguage, spoilerMode, setSpoilerMode } = useLanguage();
  const { themeMode, setThemeMode } = useThemeMode();

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
      if (p?.is_admin) fetchOpenReportCount().then(setOpenReportCount).catch(() => {});
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
  }, []);

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

  async function handleChangePassword() {
    setPasswordError(null);
    if (newPassword.length < 6) {
      setPasswordError(t.profile.changePasswordTooShort);
      return;
    }
    setChangingPassword(true);
    try {
      await changePassword(newPassword);
      setNewPassword("");
      setChangePasswordOpen(false);
      alert(t.profile.changePassword, t.profile.changePasswordSuccess);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : String(err));
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleDownloadData() {
    setExportingData(true);
    try {
      await exportMyData();
    } catch {
      alert(t.profile.downloadMyData, t.profile.downloadMyDataFailed);
    } finally {
      setExportingData(false);
    }
  }

  function handleDeleteAccount() {
    alert(t.profile.deleteAccountConfirmTitle, t.profile.deleteAccountConfirmMessage, [
      { text: t.profile.deleteAccountConfirmButton, style: "destructive", onPress: confirmDeleteAccount },
      { text: t.common.cancel, style: "cancel" },
    ]);
  }

  async function confirmDeleteAccount() {
    setDeletingAccount(true);
    try {
      await deleteAccount();
      // deleteAccount() already signs out — AuthContext's session listener
      // (see context/AuthContext.tsx) takes it from there and redirects to
      // login, same as a normal sign-out.
    } catch {
      setDeletingAccount(false);
      alert(t.profile.deleteAccount, t.profile.deleteAccountFailed);
    }
  }

  async function handleCreateList() {
    if (!newListName.trim()) return;
    await createList(newListName.trim());
    setNewListName("");
    setCreatingList(false);
    fetchLists().then(setLists);
  }

  async function handleImportTvTime() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["text/csv", "text/comma-separated-values", "application/json", "*/*"],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    const name = asset.name.toLowerCase();
    const isJson = name.endsWith(".json");
    const isCsv = name.endsWith(".csv");
    if (!isJson && !isCsv) {
      alert(t.profile.importInvalidFileTitle, t.profile.importInvalidFileMsg);
      return;
    }

    setImporting(true);
    setImportProgress(null);
    await activateKeepAwakeAsync("tvtime-import");
    try {
      let text: string;
      if (Platform.OS === "web") {
        if (!asset.file) throw new Error(t.profile.importReadError);
        text = await asset.file.text();
      } else {
        text = await new File(asset.uri).text();
      }
      const summary = isJson ? await importTvTimeJson(text, setImportProgress) : await importTvTimeCsv(text, setImportProgress);
      load();

      const unmatchedNote =
        summary.showsUnmatched.length > 0
          ? t.profile.importUnmatched(
              summary.showsUnmatched.length,
              summary.showsUnmatched.slice(0, 5).join(", ") + (summary.showsUnmatched.length > 5 ? "…" : "")
            )
          : "";

      alert(
        t.profile.importDoneTitle,
        t.profile.importDone(summary.showsImported, summary.episodesImported, summary.moviesImported) + unmatchedNote
      );
    } catch (e) {
      alert(t.profile.importFailedTitle, e instanceof Error ? e.message : t.profile.importFailedUnknown);
    } finally {
      setImporting(false);
      setImportProgress(null);
      deactivateKeepAwake("tvtime-import");
    }
  }

  const pausedShows = useMemo(() => shows.filter((s) => s.status === "paused"), [shows]);
  const droppedShows = useMemo(() => shows.filter((s) => s.status === "dropped"), [shows]);

  const email = session?.user.email ?? "";
  const displayName = profile?.username ?? email.split("@")[0] ?? "Moi";
  const tvTime = formatTvTime(episodeCount * AVG_EPISODE_MINUTES);
  const movieWatchCount = useMemo(() => movies.reduce((sum, m) => sum + m.times_watched, 0), [movies]);
  const movieTime = formatTvTime(movieWatchCount * AVG_MOVIE_MINUTES);

  return (
    <ScrollView ref={scrollRef} style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Avatar name={displayName} size="md" />
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
      </View>

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

      <SectionHeader title={t.profile.statistics} styles={styles} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsRow}>
        <StatCard
          icon="time-outline"
          label={t.profile.watchTime}
          value={`${tvTime.months}${t.profile.months[0]} ${tvTime.days}${t.profile.days[0]} ${tvTime.hours}${t.profile.hours[0]}`}
          colors={colors}
          styles={styles}
          onPress={() => router.push("/stats/shows")}
        />
        <StatCard
          icon="checkmark-circle-outline"
          label={t.profile.episodesWatched}
          value={episodeCount.toLocaleString()}
          colors={colors}
          styles={styles}
          onPress={() => router.push("/stats/shows")}
        />
        <StatCard
          icon="time-outline"
          label={t.profile.movieWatchTime}
          value={`${movieTime.months}${t.profile.months[0]} ${movieTime.days}${t.profile.days[0]} ${movieTime.hours}${t.profile.hours[0]}`}
          colors={colors}
          styles={styles}
        />
        <StatCard
          icon="checkmark-circle-outline"
          label={t.profile.moviesWatched}
          value={movies.length.toLocaleString()}
          colors={colors}
          styles={styles}
        />
      </ScrollView>

      <SectionHeader title={t.profile.favorites} styles={styles} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.showsRow}>
        {favorites.length === 0 && favoriteMovies.length === 0 ? (
          <Text style={styles.empty}>{t.profile.noFavorites}</Text>
        ) : (
          <>
            {favorites.map((s) => (
              <ShowCard key={s.id} id={s.tvmaze_id} name={s.show_name} imageUrl={s.show_image} />
            ))}
            {favoriteMovies.map((m) => (
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
            ))}
          </>
        )}
      </ScrollView>

      {favoriteEpisodes.length > 0 && (
        <>
          <SectionHeader title={t.profile.favoriteEpisodes} styles={styles} />
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

      <SectionHeader title={t.profile.lists} styles={styles} />
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

      <SectionHeader title={t.profile.shows} styles={styles} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.showsRow}>
        {shows.length === 0 ? (
          <Text style={styles.empty}>{t.profile.noShows}</Text>
        ) : (
          shows.map((s) => (
            <ShowCard key={s.id} id={s.tvmaze_id} name={s.show_name} imageUrl={s.show_image} />
          ))
        )}
      </ScrollView>

      <SectionHeader title={t.profile.movies} styles={styles} />
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

      <SectionHeader title={t.profile.paused} styles={styles} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.showsRow}>
        {pausedShows.length === 0 ? (
          <Text style={styles.empty}>{t.profile.noPaused}</Text>
        ) : (
          pausedShows.map((s) => (
            <ShowCard key={s.id} id={s.tvmaze_id} name={s.show_name} imageUrl={s.show_image} />
          ))
        )}
      </ScrollView>

      <SectionHeader title={t.profile.dropped} styles={styles} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.showsRow}>
        {droppedShows.length === 0 ? (
          <Text style={styles.empty}>{t.profile.noDropped}</Text>
        ) : (
          droppedShows.map((s) => (
            <ShowCard key={s.id} id={s.tvmaze_id} name={s.show_name} imageUrl={s.show_image} />
          ))
        )}
      </ScrollView>

      <SectionHeader title={t.profile.settings} styles={styles} />
      <Pressable style={styles.importRow} onPress={handleImportTvTime} disabled={importing}>
        <Ionicons name="cloud-upload-outline" size={20} color={colors.text} />
        <View style={{ flex: 1 }}>
          <Text style={styles.importRowTitle}>{t.profile.importTitle}</Text>
          <Text style={styles.importRowSubtitle}>{t.profile.importSubtitle}</Text>
        </View>
        {importing ? (
          <ActivityIndicator color={colors.black} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        )}
      </Pressable>
      {importing && importProgress && (
        <View style={styles.importProgress}>
          <Text style={styles.importProgressText}>
            {importProgress.phase === "matching" ? t.profile.importMatching : t.profile.importImporting} —{" "}
            {importProgress.current}/{importProgress.total}
          </Text>
          <Text style={styles.importProgressLabel} numberOfLines={1}>
            {importProgress.label}
          </Text>
        </View>
      )}

      <View style={styles.settingRow}>
        <Ionicons name="eye-off-outline" size={20} color={colors.text} />
        <View style={{ flex: 1 }}>
          <Text style={styles.importRowTitle}>{t.profile.spoilerMode}</Text>
          <Text style={styles.importRowSubtitle}>{t.profile.spoilerModeDesc}</Text>
        </View>
        <Switch
          value={spoilerMode}
          onValueChange={setSpoilerMode}
          trackColor={{ true: colors.accent, false: colors.pillBg }}
          thumbColor={colors.surface}
        />
      </View>

      <View style={styles.settingRow}>
        <Ionicons name="language-outline" size={20} color={colors.text} />
        <Text style={[styles.importRowTitle, { flex: 1 }]}>{t.profile.language}</Text>
        <LanguageSwitch language={language} setLanguage={setLanguage} colors={colors} styles={styles} />
      </View>

      <View style={styles.settingRow}>
        <Ionicons name="contrast-outline" size={20} color={colors.text} />
        <Text style={[styles.importRowTitle, { flex: 1 }]}>{t.profile.theme}</Text>
        <ThemeSwitch themeMode={themeMode} setThemeMode={setThemeMode} t={t} styles={styles} />
      </View>

      <SectionHeader title={t.profile.legal} styles={styles} />
      <Pressable style={styles.importRow} onPress={() => router.push("/legal/terms")}>
        <Ionicons name="document-text-outline" size={20} color={colors.text} />
        <Text style={[styles.importRowTitle, { flex: 1 }]}>{t.profile.termsAndConditions}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </Pressable>
      <Pressable style={styles.importRow} onPress={() => router.push("/legal/privacy")}>
        <Ionicons name="shield-checkmark-outline" size={20} color={colors.text} />
        <Text style={[styles.importRowTitle, { flex: 1 }]}>{t.profile.privacyPolicy}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </Pressable>
      <Pressable style={styles.importRow} onPress={() => Linking.openURL("mailto:clervie@bluedays.com")}>
        <Ionicons name="mail-outline" size={20} color={colors.text} />
        <Text style={[styles.importRowTitle, { flex: 1 }]}>{t.profile.contactUs}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </Pressable>

      <SectionHeader title={t.profile.account} styles={styles} />
      {profile?.is_admin && (
        <Pressable style={styles.importRow} onPress={() => router.push("/admin")}>
          <View>
            <Ionicons name="shield-outline" size={20} color={colors.accent} />
            {openReportCount > 0 && <View style={styles.adminBadge} />}
          </View>
          <Text style={[styles.importRowTitle, { flex: 1, color: colors.accent }]}>{t.profile.admin}</Text>
          {openReportCount > 0 && (
            <View style={styles.adminCountPill}>
              <Text style={styles.adminCountPillText}>{openReportCount}</Text>
            </View>
          )}
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </Pressable>
      )}
      <Pressable style={styles.importRow} onPress={() => setChangePasswordOpen(true)}>
        <Ionicons name="key-outline" size={20} color={colors.text} />
        <Text style={[styles.importRowTitle, { flex: 1 }]}>{t.profile.changePassword}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </Pressable>
      <Pressable style={styles.importRow} onPress={handleDownloadData} disabled={exportingData}>
        <Ionicons name="download-outline" size={20} color={colors.text} />
        <View style={{ flex: 1 }}>
          <Text style={styles.importRowTitle}>{t.profile.downloadMyData}</Text>
          <Text style={styles.importRowSubtitle}>{t.profile.downloadMyDataDesc}</Text>
        </View>
        {exportingData ? (
          <ActivityIndicator color={colors.black} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        )}
      </Pressable>
      <Pressable style={styles.importRow} onPress={handleDeleteAccount} disabled={deletingAccount}>
        <Ionicons name="trash-outline" size={20} color={colors.red} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.importRowTitle, { color: colors.red }]}>{t.profile.deleteAccount}</Text>
          <Text style={styles.importRowSubtitle}>{t.profile.deleteAccountDesc}</Text>
        </View>
        {deletingAccount && <ActivityIndicator color={colors.red} />}
      </Pressable>

      <Pressable style={styles.signOut} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.signOutText}>{t.profile.signOut}</Text>
      </Pressable>

      <Sheet visible={changePasswordOpen} onClose={() => setChangePasswordOpen(false)}>
        <Text style={styles.sectionTitle}>{t.profile.changePassword}</Text>
        <TextInput
          style={styles.newListInput}
          placeholder={t.profile.newPassword}
          placeholderTextColor={colors.textFaint}
          secureTextEntry
          value={newPassword}
          onChangeText={setNewPassword}
        />
        {passwordError && <Text style={{ color: colors.red, marginBottom: 8 }}>{passwordError}</Text>}
        <Pressable
          style={styles.modalSubmitBtn}
          onPress={handleChangePassword}
          disabled={changingPassword}
          accessibilityRole="button"
          accessibilityLabel={t.profile.changePasswordConfirm}
        >
          {changingPassword ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={styles.modalSubmitBtnText}>{t.profile.changePasswordConfirm}</Text>
          )}
        </Pressable>
      </Sheet>
    </ScrollView>
  );
}

type ProfileStyles = ReturnType<typeof createStyles>;

function SectionHeader({ title, styles }: { title: string; styles: ProfileStyles }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

// Compact enough that show + movie stats fit on one horizontally-scrolling
// row instead of two full-width stacked cards — same information, a lot
// less vertical space.
function StatCard({
  icon,
  label,
  value,
  colors,
  styles,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  colors: Colors;
  styles: ProfileStyles;
  onPress?: () => void;
}) {
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper style={styles.statCard} onPress={onPress}>
      <View style={styles.statCardIcon}>
        <Ionicons name={icon} size={16} color={colors.accent} />
      </View>
      <Text style={styles.statCardLabel}>{label}</Text>
      <Text style={styles.statCardValue}>{value}</Text>
      {onPress && <Ionicons name="chevron-forward" size={14} color={colors.textFaint} style={styles.statCardChevron} />}
    </Wrapper>
  );
}

function LanguageSwitch({
  language,
  setLanguage,
  colors,
  styles,
}: {
  language: Language;
  setLanguage: (lang: Language) => void;
  colors: Colors;
  styles: ProfileStyles;
}) {
  return (
    <View style={styles.languageSwitch}>
      {(["en", "fr"] as const).map((lang) => (
        <Pill key={lang} size="sm" tone={language === lang ? "solid" : "neutral"} onPress={() => setLanguage(lang)}>
          {lang.toUpperCase()}
        </Pill>
      ))}
    </View>
  );
}

function ThemeSwitch({
  themeMode,
  setThemeMode,
  t,
  styles,
}: {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  t: Translations;
  styles: ProfileStyles;
}) {
  const options: { mode: ThemeMode; label: string }[] = [
    { mode: "light", label: t.profile.themeLight },
    { mode: "dark", label: t.profile.themeDark },
    { mode: "system", label: t.profile.themeSystem },
  ];
  return (
    <View style={styles.languageSwitch}>
      {options.map(({ mode, label }) => (
        <Pill key={mode} size="sm" tone={themeMode === mode ? "solid" : "neutral"} onPress={() => setThemeMode(mode)}>
          {label}
        </Pill>
      ))}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    paddingTop: 24,
  },
  headerInfo: { flex: 1 },
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
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 12,
  },
  sectionTitle: { fontSize: type.subtitle, fontWeight: "800", color: colors.text },
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
