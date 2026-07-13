import { useCallback, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet, Share } from "react-native";
import { Image } from "expo-image";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { computeRecap, isRecapAvailable, RecapData } from "../lib/recap";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { useGoBack } from "../lib/useGoBack";
import { EmptyState } from "../components/EmptyState";

function formatHours(minutes: number): string {
  return Math.round(minutes / 60).toLocaleString();
}

export default function RecapScreen() {
  const goBack = useGoBack("/(tabs)/profile");
  const router = useRouter();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [recap, setRecap] = useState<RecapData | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      computeRecap(year)
        .then((data) => active && setRecap(data))
        .finally(() => active && setLoading(false));
      return () => {
        active = false;
      };
    }, [year])
  );

  const hasAnything = !!recap && (recap.totalEpisodesWatched > 0 || recap.totalMoviesWatched > 0);

  async function handleShare() {
    if (!recap) return;
    const lines = [
      t.recap.shareTitle(recap.year),
      t.recap.totalWatchTime(formatHours(recap.totalWatchTimeMinutes)),
      t.recap.episodeCount(recap.totalEpisodesWatched),
      t.recap.movieCount(recap.totalMoviesWatched),
      recap.topShow ? t.recap.topShowLine(recap.topShow.name) : null,
      recap.topGenre ? t.recap.topGenreLine(recap.topGenre) : null,
    ].filter(Boolean);
    await Share.share({ message: lines.join("\n") });
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.yearSwitch}>
          <Pressable onPress={() => setYear((y) => y - 1)} hitSlop={8}>
            <Ionicons name="chevron-back" size={16} color={colors.textFaint} />
          </Pressable>
          <Text style={styles.title}>{year}</Text>
          <Pressable onPress={() => year < currentYear && setYear((y) => y + 1)} hitSlop={8} disabled={year >= currentYear}>
            <Ionicons name="chevron-forward" size={16} color={year >= currentYear ? colors.pillBg : colors.textFaint} />
          </Pressable>
        </View>
        <Pressable onPress={handleShare} hitSlop={10} accessibilityRole="button" accessibilityLabel="Share">
          <Ionicons name="share-outline" size={22} color={colors.text} />
        </Pressable>
      </View>

      {!isRecapAvailable() ? (
        <EmptyState icon="sparkles-outline" title={t.recap.notAvailable} />
      ) : loading ? (
        <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
      ) : !hasAnything ? (
        <EmptyState icon="sparkles-outline" title={t.recap.empty(year)} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.heroCard, { backgroundColor: colors.accent }]}>
            <Ionicons name="sparkles" size={22} color={colors.onAccent} />
            <Text style={[styles.heroValue, { color: colors.onAccent }]}>
              {formatHours(recap!.totalWatchTimeMinutes)}h
            </Text>
            <Text style={[styles.heroLabel, { color: colors.onAccent }]}>{t.recap.watchTimeLabel}</Text>
          </View>

          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{recap!.totalEpisodesWatched.toLocaleString()}</Text>
              <Text style={styles.statLabel}>{t.recap.episodesLabel}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{recap!.totalMoviesWatched.toLocaleString()}</Text>
              <Text style={styles.statLabel}>{t.recap.moviesLabel}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{recap!.newShowsStarted.toLocaleString()}</Text>
              <Text style={styles.statLabel}>{t.recap.newShowsLabel}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{recap!.daysActive.toLocaleString()}</Text>
              <Text style={styles.statLabel}>{t.recap.daysActiveLabel}</Text>
            </View>
          </View>

          {recap!.topShow && (
            <Pressable style={styles.card} onPress={() => router.push(`/show/${recap!.topShow!.showId}`)}>
              <Text style={styles.cardLabel}>{t.recap.topShowLabel}</Text>
              <View style={styles.topShowRow}>
                {recap!.topShow.image ? (
                  <Image source={{ uri: recap!.topShow.image }} style={styles.topShowImage} contentFit="cover" />
                ) : (
                  <View style={[styles.topShowImage, { backgroundColor: colors.pillBg }]} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.topShowName}>{recap!.topShow.name}</Text>
                  <Text style={styles.cardSubtitle}>{t.showStats.episodeCount(recap!.topShow.episodeCount)}</Text>
                </View>
              </View>
            </Pressable>
          )}

          {recap!.topGenre && (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>{t.recap.topGenreLabel}</Text>
              <Text style={styles.topGenreValue}>{recap!.topGenre}</Text>
            </View>
          )}
        </ScrollView>
      )}
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
    yearSwitch: { flexDirection: "row", alignItems: "center", gap: 10 },
    title: { fontSize: type.title, fontWeight: "800", color: colors.text },
    content: { padding: 16, paddingBottom: 40, gap: 14 },
    heroCard: { borderRadius: radius.lg, padding: 24, alignItems: "center", gap: 6 },
    heroValue: { fontSize: 40, fontWeight: "800" },
    heroLabel: { fontSize: type.body, fontWeight: "700", opacity: 0.9 },
    statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    statCard: {
      flexBasis: "47%",
      flexGrow: 1,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      alignItems: "center",
      gap: 4,
    },
    statValue: { fontSize: type.display, fontWeight: "800", color: colors.text },
    statLabel: { fontSize: type.caption, color: colors.textMuted, fontWeight: "700", textAlign: "center" },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
    },
    cardLabel: { fontSize: type.caption, fontWeight: "800", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
    cardSubtitle: { fontSize: type.caption, color: colors.textFaint, marginTop: 2 },
    topShowRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 },
    topShowImage: { width: 56, height: 80, borderRadius: radius.sm },
    topShowName: { fontSize: type.subtitle, fontWeight: "800", color: colors.text },
    topGenreValue: { fontSize: type.title, fontWeight: "800", color: colors.text, marginTop: 6 },
  });
}
