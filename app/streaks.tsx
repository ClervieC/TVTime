import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { computeStreakData, loadLocalStreakData, StreakData, Badge, BadgeCategory, BADGE_ICON, categoryColor, badgeLabel } from "../lib/streaks";
import { useColors, radius, type, dropShadow, Colors } from "../lib/theme";
import { useLanguage, Translations } from "../lib/i18n";
import { useGoBack } from "../lib/useGoBack";
import { useMountIn, useScalePress, NATIVE_DRIVER } from "../lib/animations";
import { alert } from "../lib/alert";
import { useBadgeUnlockToast } from "../context/BadgeUnlockContext";

export default function StreaksScreen() {
  const goBack = useGoBack("/(tabs)/profile");
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t, language } = useLanguage();
  const [data, setData] = useState<StreakData | null>(null);
  const [loading, setLoading] = useState(true);
  const announceBadges = useBadgeUnlockToast();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      // Local IndexedDB read first — instant paint, no network round trip
      // (see lib/streaks.ts) — then a fresh compute reconciles/overwrites it.
      loadLocalStreakData().then((local) => {
        if (active && local) {
          setData(local);
          setLoading(false);
        }
      });
      computeStreakData(announceBadges)
        .then((d) => active && setData(d))
        .finally(() => active && setLoading(false));
      return () => {
        active = false;
      };
    }, [])
  );

  const categories: BadgeCategory[] = ["streak", "episodes", "movies", "shows", "ratings", "social", "rewatch"];
  const categoryLabel: Record<BadgeCategory, string> = {
    episodes: t.profile.badgeCategoryEpisodes,
    movies: t.profile.badgeCategoryMovies,
    shows: t.profile.badgeCategoryShows,
    streak: t.profile.badgeCategoryStreak,
    ratings: t.profile.badgeCategoryRatings,
    social: t.profile.badgeCategorySocial,
    rewatch: t.profile.badgeCategoryRewatch,
  };
  const totalAchieved = data?.badges.filter((b) => b.achieved).length ?? 0;
  const totalBadges = data?.badges.length ?? 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t.profile.streaksTitle}</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading || !data ? (
        <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <LinearGradient
            colors={data.currentStreak > 0 ? ["#ff9f4333", "#ff9f4300"] : [colors.pillBg, colors.pillBg]}
            style={styles.heroCard}
          >
            <View style={styles.heroFlameWrap}>
              <Ionicons name="flame" size={40} color={data.currentStreak > 0 ? "#ff9f43" : colors.textFaint} />
            </View>
            <Text style={styles.heroValue}>{data.currentStreak}</Text>
            <Text style={styles.heroLabel}>{t.profile.currentStreak}</Text>
            <View style={styles.heroDivider} />
            <View style={styles.heroSubRow}>
              <Ionicons name="trophy-outline" size={16} color={colors.textMuted} />
              <Text style={styles.heroSubText}>{t.profile.longestStreak}</Text>
              <Text style={styles.heroSubValue}>{data.longestStreak}</Text>
            </View>
          </LinearGradient>

          <View style={styles.badgeCountRow}>
            <Ionicons name="medal-outline" size={16} color={colors.accent} />
            <Text style={styles.badgeCountText}>{t.profile.badgeCollected(totalAchieved, totalBadges)}</Text>
          </View>

          {categories.map((category) => {
            const badges = data.badges.filter((b) => b.category === category);
            // Badges push in ascending threshold order (see buildBadges in
            // lib/streaks.ts), so the first unachieved one is always the
            // next one to work toward.
            const nextBadge = badges.find((b) => !b.achieved);
            const color = categoryColor(colors, category);
            return (
              <View key={category} style={styles.categorySection}>
                <View style={styles.categoryTitleRow}>
                  <View style={[styles.categoryDot, { backgroundColor: color }]} />
                  <Text style={styles.categoryTitle}>{categoryLabel[category]}</Text>
                </View>
                {nextBadge && (
                  <NextBadgeProgress badge={nextBadge} color={color} styles={styles} t={t} />
                )}
                <View style={styles.badgeGrid}>
                  {badges.map((b, i) => (
                    <BadgeCard key={b.id} badge={b} index={i} color={color} colors={colors} styles={styles} t={t} language={language} />
                  ))}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

type StreaksStyles = ReturnType<typeof createStyles>;

// Percentage-toward-next-badge bar for a category — the actual driver of
// "keep going," since a bare achieved/locked grid gives no sense of how
// close a locked badge is. Animates its own fill width in from 0 on mount
// rather than snapping straight to the real percentage, which reads as
// static/dead on a page whose whole point is to feel a little game-like.
function NextBadgeProgress({
  badge,
  color,
  styles,
  t,
}: {
  badge: Badge;
  color: string;
  styles: StreaksStyles;
  t: Translations;
}) {
  const pct = Math.max(0, Math.min(1, badge.progress / badge.threshold));
  const width = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(width, { toValue: pct, duration: 500, useNativeDriver: false }).start();
  }, [pct, width]);

  return (
    <View style={[styles.nextBadgeCard, { borderColor: `${color}55` }]}>
      <View style={[styles.nextBadgeIconWrap, { backgroundColor: `${color}22` }]}>
        <Ionicons name={BADGE_ICON[badge.category]} size={16} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.nextBadgeLabel}>{t.profile.badgeProgress(badge.progress, badge.threshold)}</Text>
        <View style={styles.nextBadgeTrack}>
          <Animated.View
            style={[
              styles.nextBadgeFill,
              { backgroundColor: color, width: width.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

function BadgeCard({
  badge,
  index,
  color,
  colors,
  styles,
  t,
  language,
}: {
  badge: Badge;
  index: number;
  color: string;
  colors: Colors;
  styles: StreaksStyles;
  t: Translations;
  language: string;
}) {
  const label = badgeLabel(t, badge);
  const mountIn = useMountIn(index * 40);
  const { scale, onPressIn, onPressOut } = useScalePress(0.94);
  const checkScale = useRef(new Animated.Value(badge.achieved ? 0 : 1)).current;

  useEffect(() => {
    if (!badge.achieved) return;
    Animated.spring(checkScale, { toValue: 1, delay: index * 40 + 180, useNativeDriver: NATIVE_DRIVER, speed: 14, bounciness: 10 }).start();
  }, [badge.achieved, checkScale, index]);

  function handlePress() {
    if (badge.achieved && badge.earnedAt) {
      alert(
        label,
        t.profile.badgeEarnedOn(
          new Date(badge.earnedAt).toLocaleDateString(language === "fr" ? "fr-FR" : "en-US", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })
        )
      );
    } else {
      alert(label, t.profile.badgeRemaining(Math.max(0, badge.threshold - badge.progress)));
    }
  }

  return (
    <Animated.View style={{ opacity: mountIn.opacity, transform: [...mountIn.transform, { scale }], width: "31%" }}>
      <Pressable onPress={handlePress} onPressIn={onPressIn} onPressOut={onPressOut}>
        <View
          style={[
            styles.badgeCard,
            badge.achieved ? { borderColor: `${color}55` } : styles.badgeCardLocked,
          ]}
        >
          <View style={[styles.badgeIconWrap, badge.achieved ? { backgroundColor: `${color}22` } : null]}>
            <Ionicons name={BADGE_ICON[badge.category]} size={22} color={badge.achieved ? color : colors.textFaint} />
            {!badge.achieved && (
              <View style={styles.lockBadge}>
                <Ionicons name="lock-closed" size={10} color={colors.textFaint} />
              </View>
            )}
          </View>
          <Text style={[styles.badgeCardText, !badge.achieved && styles.badgeCardTextLocked]}>{label}</Text>
          {badge.achieved && badge.earnedAt ? (
            <Text style={styles.badgeCardDate}>
              {new Date(badge.earnedAt).toLocaleDateString(language === "fr" ? "fr-FR" : "en-US", {
                day: "numeric",
                month: "short",
              })}
            </Text>
          ) : (
            !badge.achieved && <Text style={styles.badgeCardDate}>{t.profile.badgeProgress(badge.progress, badge.threshold)}</Text>
          )}
          {badge.achieved && (
            <Animated.View style={[styles.badgeCheck, { transform: [{ scale: checkScale }] }]}>
              <Ionicons name="checkmark-circle" size={14} color={colors.green} />
            </Animated.View>
          )}
        </View>
      </Pressable>
    </Animated.View>
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
    content: { padding: 16, paddingBottom: 40, gap: 8 },
    heroCard: {
      alignItems: "center",
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 22,
      marginBottom: 12,
    },
    heroFlameWrap: {
      width: 72,
      height: 72,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 8,
      ...dropShadow({ opacity: 0.1, radius: 10, offsetY: 4, elevation: 3 }),
    },
    heroValue: { fontSize: 40, fontWeight: "800", color: colors.text },
    heroLabel: { fontSize: type.bodySm, color: colors.textMuted, fontWeight: "700", marginTop: 2 },
    heroDivider: { width: "60%", height: 1, backgroundColor: colors.border, marginVertical: 14 },
    heroSubRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    heroSubText: { fontSize: type.caption, color: colors.textMuted, fontWeight: "700" },
    heroSubValue: { fontSize: type.caption, color: colors.text, fontWeight: "800" },
    badgeCountRow: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", marginBottom: 8 },
    badgeCountText: { fontSize: type.caption, color: colors.textMuted, fontWeight: "700" },
    categorySection: { marginTop: 14 },
    categoryTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
    categoryDot: { width: 8, height: 8, borderRadius: 4 },
    categoryTitle: {
      fontSize: type.caption,
      fontWeight: "800",
      color: colors.textFaint,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    nextBadgeCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderRadius: radius.md,
      padding: 10,
      marginBottom: 10,
    },
    nextBadgeIconWrap: {
      width: 32,
      height: 32,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    nextBadgeTrack: { height: 6, borderRadius: 3, backgroundColor: colors.pillBg, overflow: "hidden", marginTop: 4 },
    nextBadgeFill: { height: 6, borderRadius: 3 },
    nextBadgeLabel: { fontSize: type.micro, color: colors.textFaint, fontWeight: "700" },
    badgeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    badgeCard: {
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingVertical: 14,
      position: "relative",
      ...dropShadow({ opacity: 0.05, radius: 5, offsetY: 2, elevation: 1 }),
    },
    badgeCardLocked: { opacity: 0.6 },
    badgeIconWrap: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      backgroundColor: colors.pillBg,
      alignItems: "center",
      justifyContent: "center",
    },
    lockBadge: {
      position: "absolute",
      bottom: -2,
      right: -2,
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeCardText: { fontSize: type.caption, fontWeight: "700", color: colors.text, textAlign: "center" },
    badgeCardTextLocked: { color: colors.textFaint },
    badgeCardDate: { fontSize: type.micro, color: colors.textFaint, marginTop: -2 },
    badgeCheck: { position: "absolute", top: 6, right: 6 },
  });
}
