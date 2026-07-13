import { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, TextInput, ActivityIndicator, Platform, Switch } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { supabase } from "../lib/supabase";
import { importTvTimeCsv, importTvTimeJson, ImportProgress } from "../lib/tvtimeImport";
import { useColors, useThemeMode, radius, type, Colors, ThemeMode } from "../lib/theme";
import { useLanguage, Translations } from "../lib/i18n";
import { Language } from "../lib/userSettings";
import { fetchMyProfile, Profile } from "../lib/profiles";
import { changePassword, exportMyData, deleteAccount } from "../lib/account";
import { fetchOpenReportCount } from "../lib/reports";
import { fetchOpenSupportMessageCount } from "../lib/support";
import { alert } from "../lib/alert";
import { useGoBack } from "../lib/useGoBack";
import { Pill } from "../components/Pill";
import { Sheet } from "../components/Sheet";

// Settings/Legal/Account — split out of Profile (see the gear icon in its
// header) so that screen stays focused on "what have I watched," not a mix
// of that plus every account-management action. Fetches its own profile row
// (for the admin row) and open-report/support counts independently, rather
// than sharing Profile's state — the two screens don't need to stay in
// lockstep, and Profile's own useFocusEffect already re-syncs anything this
// screen changes (e.g. a fresh import) the next time it's revisited.
export default function SettingsScreen() {
  const router = useRouter();
  const goBack = useGoBack("/(tabs)/profile");
  const colors = useColors();
  const styles = createStyles(colors);
  const { t, language, setLanguage, spoilerMode, setSpoilerMode } = useLanguage();
  const { themeMode, setThemeMode } = useThemeMode();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [openAlertCount, setOpenAlertCount] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [exportingData, setExportingData] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useFocusEffect(
    useCallback(() => {
      fetchMyProfile().then((p) => {
        setProfile(p);
        if (p?.is_admin) {
          Promise.all([fetchOpenReportCount(), fetchOpenSupportMessageCount()])
            .then(([reports, support]) => setOpenAlertCount(reports + support))
            .catch(() => {});
        }
      });
    }, [])
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

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t.profile.settings}</Text>
        <View style={{ width: 24 }} />
      </View>

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
        <LanguageSwitch language={language} setLanguage={setLanguage} styles={styles} />
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
      <Pressable style={styles.importRow} onPress={() => router.push("/support")}>
        <Ionicons name="chatbubbles-outline" size={20} color={colors.text} />
        <Text style={[styles.importRowTitle, { flex: 1 }]}>{t.profile.contactUs}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </Pressable>

      <SectionHeader title={t.profile.account} styles={styles} />
      {profile?.is_admin && (
        <Pressable style={styles.importRow} onPress={() => router.push("/admin")}>
          <View>
            <Ionicons name="shield-outline" size={20} color={colors.accent} />
            {openAlertCount > 0 && <View style={styles.adminBadge} />}
          </View>
          <Text style={[styles.importRowTitle, { flex: 1, color: colors.accent }]}>{t.profile.admin}</Text>
          {openAlertCount > 0 && (
            <View style={styles.adminCountPill}>
              <Text style={styles.adminCountPillText}>{openAlertCount}</Text>
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
          style={styles.newPasswordInput}
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

type SettingsStyles = ReturnType<typeof createStyles>;

function SectionHeader({ title, styles }: { title: string; styles: SettingsStyles }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function LanguageSwitch({
  language,
  setLanguage,
  styles,
}: {
  language: Language;
  setLanguage: (lang: Language) => void;
  styles: SettingsStyles;
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
  styles: SettingsStyles;
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
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 12,
    },
    title: { fontSize: type.title, fontWeight: "800", color: colors.text },
    sectionHeader: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 12 },
    sectionTitle: { fontSize: type.subtitle, fontWeight: "800", color: colors.text },
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
    newPasswordInput: {
      backgroundColor: colors.backgroundAlt,
      borderRadius: radius.sm,
      paddingHorizontal: 14,
      paddingVertical: 10,
      color: colors.text,
      fontSize: 14,
      marginBottom: 10,
    },
    modalSubmitBtn: {
      backgroundColor: colors.accent,
      borderRadius: radius.sm,
      padding: 14,
      alignItems: "center",
      marginTop: 4,
    },
    modalSubmitBtnText: { color: colors.onAccent, fontWeight: "700", fontSize: 15 },
    signOut: { alignItems: "center", paddingVertical: 24 },
    signOutText: { color: colors.red, fontWeight: "600" },
  });
}
