import { useCallback, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, TextInput, Alert, ActivityIndicator, Platform, Switch } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { createList, fetchAllListItems, fetchEpisodeCount, fetchFavorites, fetchLists, fetchUserShows, ListItem, ShowList, UserShow } from "../../lib/userShows";
import { importTvTimeCsv, importTvTimeJson, ImportProgress } from "../../lib/tvtimeImport";
import { useColors, radius, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";
import { Language } from "../../lib/userSettings";
import { fetchMyProfile, createProfile, Profile } from "../../lib/profiles";
import { fetchFollowCounts } from "../../lib/follows";
import { fetchUnreadNotificationCount } from "../../lib/notifications";
import { ShowCard } from "../../components/ShowCard";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

const AVG_EPISODE_MINUTES = 42;

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
  const [favorites, setFavorites] = useState<UserShow[]>([]);
  const [lists, setLists] = useState<ShowList[]>([]);
  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [episodeCount, setEpisodeCount] = useState(0);
  const [creatingList, setCreatingList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [usernameInput, setUsernameInput] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [savingUsername, setSavingUsername] = useState(false);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [unreadCount, setUnreadCount] = useState(0);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t, language, setLanguage, spoilerMode, setSpoilerMode } = useLanguage();

  const load = useCallback(() => {
    fetchUserShows().then(setShows);
    fetchFavorites().then(setFavorites);
    fetchLists().then(setLists);
    fetchAllListItems().then(setListItems);
    fetchEpisodeCount().then(setEpisodeCount);
    fetchUnreadNotificationCount().then(setUnreadCount);
    fetchMyProfile().then((p) => {
      setProfile(p);
      if (p) fetchFollowCounts(p.user_id).then(setFollowCounts);
    });
  }, []);

  async function handleSaveUsername() {
    setUsernameError(null);
    if (!USERNAME_RE.test(usernameInput)) {
      setUsernameError(t.signup.usernameInvalid);
      return;
    }
    setSavingUsername(true);
    try {
      const created = await createProfile(usernameInput);
      setProfile(created);
      fetchFollowCounts(created.user_id).then(setFollowCounts);
    } catch {
      setUsernameError(t.signup.usernameTaken);
    } finally {
      setSavingUsername(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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
      Alert.alert(t.profile.importInvalidFileTitle, t.profile.importInvalidFileMsg);
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

      Alert.alert(
        t.profile.importDoneTitle,
        t.profile.importDone(summary.showsImported, summary.episodesImported, summary.moviesImported) + unmatchedNote
      );
    } catch (e) {
      Alert.alert(t.profile.importFailedTitle, e instanceof Error ? e.message : t.profile.importFailedUnknown);
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

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarInitial}>{displayName[0]?.toUpperCase()}</Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.username}>{displayName}</Text>
          {!!email && (
            <Text style={styles.userEmail} numberOfLines={1}>
              {email}
            </Text>
          )}
        </View>
        <Pressable style={styles.bellBtn} onPress={() => router.push("/notifications")}>
          <Ionicons name="notifications-outline" size={20} color={colors.text} />
          {unreadCount > 0 && <View style={styles.bellBadge} />}
        </Pressable>
      </View>

      {profile ? (
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
      ) : (
        <View style={styles.usernamePrompt}>
          <Text style={styles.usernamePromptTitle}>{t.social.setUsernameTitle}</Text>
          <Text style={styles.usernamePromptDesc}>{t.social.setUsernameDesc}</Text>
          <View style={styles.newListRow}>
            <TextInput
              style={styles.newListInput}
              placeholder={t.social.usernamePlaceholder}
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              value={usernameInput}
              onChangeText={setUsernameInput}
            />
            <Pressable style={styles.newListBtn} onPress={handleSaveUsername} disabled={savingUsername}>
              {savingUsername ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Ionicons name="checkmark" size={20} color={colors.onAccent} />
              )}
            </Pressable>
          </View>
          {usernameError && <Text style={styles.usernameError}>{usernameError}</Text>}
        </View>
      )}

      <Pressable style={styles.importRow} onPress={() => router.push("/users/search")}>
        <Ionicons name="people-outline" size={20} color={colors.text} />
        <Text style={[styles.importRowTitle, { flex: 1 }]}>{t.social.findPeople}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </Pressable>

      <SectionHeader title={t.profile.statistics} styles={styles} />
      <View style={styles.statHero}>
        <View style={styles.statHeroRow}>
          <View style={styles.statHeroIcon}>
            <Ionicons name="time-outline" size={16} color={colors.accent} />
          </View>
          <Text style={styles.statHeroLabel}>{t.profile.watchTime}</Text>
        </View>
        <View style={styles.tvTimeRow}>
          <TvTimeUnit value={tvTime.months} label={t.profile.months} styles={styles} />
          <TvTimeUnit value={tvTime.days} label={t.profile.days} styles={styles} />
          <TvTimeUnit value={tvTime.hours} label={t.profile.hours} styles={styles} />
        </View>

        <View style={styles.statHeroDivider} />

        <View style={styles.statHeroRow}>
          <View style={styles.statHeroIcon}>
            <Ionicons name="checkmark-circle-outline" size={16} color={colors.accent} />
          </View>
          <Text style={styles.statHeroLabel}>{t.profile.episodesWatched}</Text>
          <Text style={styles.statHeroBig}>{episodeCount.toLocaleString()}</Text>
        </View>
      </View>

      <SectionHeader title={t.profile.favorites} styles={styles} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.showsRow}>
        {favorites.length === 0 ? (
          <Text style={styles.empty}>{t.profile.noFavorites}</Text>
        ) : (
          favorites.map((s) => <ShowCard key={s.id} id={s.tvmaze_id} name={s.show_name} imageUrl={s.show_image} />)
        )}
      </ScrollView>

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

      <Pressable style={styles.signOut} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.signOutText}>{t.profile.signOut}</Text>
      </Pressable>
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

function TvTimeUnit({ value, label, styles }: { value: number; label: string; styles: ProfileStyles }) {
  return (
    <View style={styles.tvTimeUnit}>
      <Text style={styles.tvTimeValue}>{value}</Text>
      <Text style={styles.tvTimeLabel}>{label}</Text>
    </View>
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
        <Pressable
          key={lang}
          style={[styles.languageOption, language === lang && { backgroundColor: colors.accent }]}
          onPress={() => setLanguage(lang)}
        >
          <Text style={[styles.languageOptionText, language === lang && { color: colors.onAccent }]}>
            {lang.toUpperCase()}
          </Text>
        </Pressable>
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
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: { fontSize: 26, fontWeight: "800", color: colors.onAccent },
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
  followNumber: { fontSize: 18, fontWeight: "800", color: colors.text },
  followLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  usernamePrompt: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 4,
    padding: 16,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
  },
  usernamePromptTitle: { fontWeight: "800", fontSize: 15, color: colors.text },
  usernamePromptDesc: { fontSize: 13, color: colors.textMuted, marginTop: 4, marginBottom: 12 },
  usernameError: { fontSize: 12, color: colors.red, marginTop: 8 },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 12,
  },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  statHero: {
    marginHorizontal: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
  },
  statHeroRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statHeroIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  statHeroLabel: { flex: 1, fontWeight: "700", fontSize: 13, color: colors.text },
  statHeroBig: { fontSize: 20, fontWeight: "800", color: colors.text },
  tvTimeRow: { flexDirection: "row", marginTop: 14, gap: 8 },
  tvTimeUnit: { alignItems: "center", flex: 1 },
  tvTimeValue: { fontSize: 24, fontWeight: "800", color: colors.text },
  tvTimeLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  statHeroDivider: { height: 1, backgroundColor: colors.border, marginVertical: 16 },
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
  languageOption: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm - 2 },
  languageOptionText: { fontSize: 12, fontWeight: "800", color: colors.textMuted },
  signOut: { alignItems: "center", paddingVertical: 24 },
  signOutText: { color: colors.red, fontWeight: "600" },
  });
}
