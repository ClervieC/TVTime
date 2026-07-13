import { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, TextInput } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../context/AuthContext";
import { fetchMyProfile, fetchAllProfilesForAdmin, setUserBanned, Profile } from "../../lib/profiles";
import { fetchReports, resolveReport, dismissReport, Report, ReportStatus, ReportTargetType } from "../../lib/reports";
import { fetchSupportMessagesForAdmin, resolveSupportMessage, SupportMessage, SupportStatus } from "../../lib/support";
import { useLanguage } from "../../lib/i18n";
import { alert } from "../../lib/alert";
import { useGoBack } from "../../lib/useGoBack";

// Deliberately not using lib/theme.ts's useColors()/light-dark palette — an
// admin moderation console reads content other users flagged as abusive or
// broken; keeping it visually distinct (dark, fixed, slightly clinical)
// from the rest of the app is the point, so there's never a moment of
// confusing it for a normal in-app screen, on either light or dark system
// theme.
const C = {
  bg: "#0a0c10",
  surface: "#14171d",
  border: "#262b34",
  text: "#e8eaed",
  textMuted: "#8b92a0",
  accent: "#4d8cff",
  red: "#ff5c5c",
  green: "#3ecf8e",
  yellow: "#e0a400",
};

const STATUS_TABS: ReportStatus[] = ["open", "resolved", "dismissed"];

const TARGET_ICON: Record<ReportTargetType, keyof typeof Ionicons.glyphMap> = {
  user: "person-outline",
  comment: "chatbubble-outline",
  movie_comment: "chatbubble-outline",
  show: "tv-outline",
  episode: "film-outline",
  movie: "videocam-outline",
};

export default function AdminScreen() {
  const router = useRouter();
  const goBack = useGoBack("/(tabs)/profile");
  const { session } = useAuth();
  const { t } = useLanguage();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [view, setView] = useState<"reports" | "users" | "support">("reports");
  const [status, setStatus] = useState<ReportStatus>("open");
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<Profile[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [supportStatus, setSupportStatus] = useState<SupportStatus>("open");
  const [supportMessages, setSupportMessages] = useState<SupportMessage[]>([]);
  const [supportLoading, setSupportLoading] = useState(false);

  // Gated server-side too (see the "Admins view/update all reports" RLS
  // policies in supabase/schema.sql) — this client-side check is purely so
  // a non-admin who somehow lands on /admin sees a plain "not authorized"
  // screen instead of an empty moderation console that looks broken.
  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      fetchMyProfile().then((p) => setAuthorized(!!p?.is_admin));
    }, [session])
  );

  const load = useCallback((s: ReportStatus) => {
    setLoading(true);
    fetchReports(s)
      .then(setReports)
      .finally(() => setLoading(false));
  }, []);

  const loadUsers = useCallback((query: string) => {
    setUsersLoading(true);
    fetchAllProfilesForAdmin(query)
      .then(setUsers)
      .finally(() => setUsersLoading(false));
  }, []);

  const loadSupport = useCallback((s: SupportStatus) => {
    setSupportLoading(true);
    fetchSupportMessagesForAdmin(s)
      .then(setSupportMessages)
      .finally(() => setSupportLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (authorized && view === "reports") load(status);
    }, [authorized, view, status, load])
  );

  useFocusEffect(
    useCallback(() => {
      if (authorized && view === "users") loadUsers(userQuery);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authorized, view])
  );

  useFocusEffect(
    useCallback(() => {
      if (authorized && view === "support") loadSupport(supportStatus);
    }, [authorized, view, supportStatus, loadSupport])
  );

  if (authorized === null) {
    return (
      <View style={[styles.center, { backgroundColor: C.bg }]}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  if (!authorized) {
    return (
      <View style={[styles.center, { backgroundColor: C.bg }]}>
        <Ionicons name="lock-closed-outline" size={32} color={C.textMuted} />
        <Text style={styles.notAuthorized}>Not authorized</Text>
        <Pressable onPress={() => router.replace("/(tabs)/profile")} style={{ marginTop: 16 }}>
          <Text style={{ color: C.accent }}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t.admin.title}</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.tabs}>
        <Pressable style={[styles.tab, view === "reports" && styles.tabActive]} onPress={() => setView("reports")}>
          <Text style={[styles.tabText, view === "reports" && styles.tabTextActive]}>{t.admin.reportsTab}</Text>
        </Pressable>
        <Pressable style={[styles.tab, view === "users" && styles.tabActive]} onPress={() => setView("users")}>
          <Text style={[styles.tabText, view === "users" && styles.tabTextActive]}>{t.admin.usersTab}</Text>
        </Pressable>
        <Pressable style={[styles.tab, view === "support" && styles.tabActive]} onPress={() => setView("support")}>
          <Text style={[styles.tabText, view === "support" && styles.tabTextActive]}>{t.admin.supportTab}</Text>
        </Pressable>
      </View>

      {view === "reports" ? (
        <>
          <View style={styles.tabs}>
            {STATUS_TABS.map((s) => (
              <Pressable key={s} style={[styles.tab, status === s && styles.tabActive]} onPress={() => setStatus(s)}>
                <Text style={[styles.tabText, status === s && styles.tabTextActive]}>
                  {s === "open" ? t.admin.open : s === "resolved" ? t.admin.resolved : t.admin.dismissed}
                </Text>
              </Pressable>
            ))}
          </View>

          {loading ? (
            <ActivityIndicator color={C.accent} style={{ marginTop: 24 }} />
          ) : reports.length === 0 ? (
            <Text style={styles.empty}>{t.admin.noReports}</Text>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
              {reports.map((r) => (
                <ReportCard key={r.id} report={r} onActed={() => load(status)} />
              ))}
            </ScrollView>
          )}
        </>
      ) : view === "users" ? (
        <>
          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
            <TextInput
              style={styles.noteInput}
              placeholder={t.admin.searchUsersPlaceholder}
              placeholderTextColor={C.textMuted}
              value={userQuery}
              onChangeText={setUserQuery}
              onSubmitEditing={() => loadUsers(userQuery)}
            />
          </View>
          {usersLoading ? (
            <ActivityIndicator color={C.accent} style={{ marginTop: 24 }} />
          ) : users.length === 0 ? (
            <Text style={styles.empty}>{t.admin.noUsers}</Text>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 10 }}>
              {users.map((u) => (
                <UserCard key={u.user_id} profile={u} onActed={() => loadUsers(userQuery)} />
              ))}
            </ScrollView>
          )}
        </>
      ) : (
        <>
          <View style={styles.tabs}>
            {(["open", "resolved"] as SupportStatus[]).map((s) => (
              <Pressable key={s} style={[styles.tab, supportStatus === s && styles.tabActive]} onPress={() => setSupportStatus(s)}>
                <Text style={[styles.tabText, supportStatus === s && styles.tabTextActive]}>
                  {s === "open" ? t.admin.open : t.admin.resolved}
                </Text>
              </Pressable>
            ))}
          </View>
          {supportLoading ? (
            <ActivityIndicator color={C.accent} style={{ marginTop: 24 }} />
          ) : supportMessages.length === 0 ? (
            <Text style={styles.empty}>{t.admin.noSupportMessages}</Text>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
              {supportMessages.map((m) => (
                <SupportCard key={m.id} message={m} onActed={() => loadSupport(supportStatus)} />
              ))}
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}

function targetSummary(r: Report): string {
  switch (r.target_type) {
    case "user":
      return `user ${r.target_user_id?.slice(0, 8)}`;
    case "comment":
      return `comment ${r.target_comment_id?.slice(0, 8)}`;
    case "movie_comment":
      return `movie comment ${r.target_movie_comment_id?.slice(0, 8)}`;
    case "show":
      return `show #${r.target_tvmaze_show_id}`;
    case "episode":
      return `episode #${r.target_tvmaze_episode_id} (show #${r.target_tvmaze_show_id})`;
    case "movie":
      return `movie #${r.target_tmdb_id}`;
  }
}

function ReportCard({ report, onActed }: { report: Report; onActed: () => void }) {
  const { t } = useLanguage();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function act(action: "resolve" | "dismiss") {
    setBusy(true);
    try {
      await (action === "resolve" ? resolveReport : dismissReport)(report.id, note.trim() || null);
      onActed();
    } catch {
      alert("Failed", "Couldn't update this report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons name={TARGET_ICON[report.target_type]} size={16} color={C.accent} />
        <Text style={styles.cardTarget}>{targetSummary(report)}</Text>
        <Text style={styles.cardDate}>{report.created_at.slice(0, 10)}</Text>
      </View>
      <Text style={styles.cardReason}>{report.reason}</Text>
      <Text style={styles.cardMeta}>
        {t.admin.reportedBy} {report.reporter_id.slice(0, 8)}
      </Text>

      {report.status === "open" && (
        <>
          <TextInput
            style={styles.noteInput}
            placeholder={t.admin.resolutionNotePlaceholder}
            placeholderTextColor={C.textMuted}
            value={note}
            onChangeText={setNote}
          />
          <View style={styles.actionRow}>
            <Pressable style={[styles.actionBtn, styles.resolveBtn]} onPress={() => act("resolve")} disabled={busy}>
              <Text style={styles.actionBtnText}>{t.admin.resolve}</Text>
            </Pressable>
            <Pressable style={[styles.actionBtn, styles.dismissBtn]} onPress={() => act("dismiss")} disabled={busy}>
              <Text style={styles.actionBtnText}>{t.admin.dismiss}</Text>
            </Pressable>
          </View>
        </>
      )}
      {report.status !== "open" && report.resolution_note && (
        <Text style={styles.cardResolutionNote}>{report.resolution_note}</Text>
      )}
    </View>
  );
}

function UserCard({ profile, onActed }: { profile: Profile; onActed: () => void }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);

  async function toggleBanned() {
    setBusy(true);
    try {
      await setUserBanned(profile.user_id, !profile.is_banned);
      onActed();
    } catch {
      alert("Failed", "Couldn't update this user.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons name="person-outline" size={16} color={C.accent} />
        <Text style={styles.cardTarget}>{profile.username}</Text>
        {profile.is_admin && <Text style={styles.cardDate}>{t.admin.adminBadge}</Text>}
      </View>
      {profile.is_banned && <Text style={[styles.cardMeta, { color: C.red }]}>{t.admin.bannedLabel}</Text>}
      <View style={styles.actionRow}>
        <Pressable
          style={[styles.actionBtn, profile.is_banned ? styles.resolveBtn : styles.dismissBtn]}
          onPress={toggleBanned}
          disabled={busy || profile.is_admin}
        >
          <Text style={styles.actionBtnText}>{profile.is_banned ? t.admin.unban : t.admin.ban}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function SupportCard({ message, onActed }: { message: SupportMessage; onActed: () => void }) {
  const { t } = useLanguage();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleResolve() {
    setBusy(true);
    try {
      await resolveSupportMessage(message.id, note.trim() || null);
      onActed();
    } catch {
      alert("Failed", "Couldn't update this message.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons name="chatbubbles-outline" size={16} color={C.accent} />
        <Text style={styles.cardTarget}>{t.admin.reportedBy} {message.user_id.slice(0, 8)}</Text>
        <Text style={styles.cardDate}>{message.created_at.slice(0, 10)}</Text>
      </View>
      <Text style={styles.cardReason}>{message.body}</Text>

      {message.status === "open" ? (
        <>
          <TextInput
            style={styles.noteInput}
            placeholder={t.admin.resolutionNotePlaceholder}
            placeholderTextColor={C.textMuted}
            value={note}
            onChangeText={setNote}
          />
          <View style={styles.actionRow}>
            <Pressable style={[styles.actionBtn, styles.resolveBtn]} onPress={handleResolve} disabled={busy}>
              <Text style={styles.actionBtnText}>{t.admin.resolve}</Text>
            </Pressable>
          </View>
        </>
      ) : (
        message.resolution_note && <Text style={styles.cardResolutionNote}>{message.resolution_note}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  notAuthorized: { color: C.text, fontWeight: "700", fontSize: 16 },
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: { color: C.text, fontWeight: "800", fontSize: 17, letterSpacing: 0.3 },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  tab: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, backgroundColor: C.surface },
  tabActive: { backgroundColor: C.accent },
  tabText: { color: C.textMuted, fontSize: 13, fontWeight: "700" },
  tabTextActive: { color: "#ffffff" },
  empty: { color: C.textMuted, textAlign: "center", marginTop: 32 },
  card: { backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  cardTarget: { flex: 1, color: C.text, fontWeight: "700", fontSize: 13 },
  cardDate: { color: C.textMuted, fontSize: 11 },
  cardReason: { color: C.text, fontSize: 13, lineHeight: 18, marginBottom: 6 },
  cardMeta: { color: C.textMuted, fontSize: 11, marginBottom: 8 },
  cardResolutionNote: { color: C.textMuted, fontSize: 12, fontStyle: "italic", marginTop: 4 },
  noteInput: {
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: C.text,
    fontSize: 13,
    marginBottom: 8,
  },
  actionRow: { flexDirection: "row", gap: 8 },
  actionBtn: { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: "center" },
  resolveBtn: { backgroundColor: C.green },
  dismissBtn: { backgroundColor: C.red },
  actionBtnText: { color: "#0a0c10", fontWeight: "800", fontSize: 12 },
});
