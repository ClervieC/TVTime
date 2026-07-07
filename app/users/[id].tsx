import { useCallback, useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";
import { fetchProfile, Profile } from "../../lib/profiles";
import { fetchFollowCounts, fetchIsFollowing, followUser, unfollowUser } from "../../lib/follows";
import { fetchEpisodeCount, fetchFavorites, fetchUserShows, UserShow } from "../../lib/userShows";
import { FollowButton } from "../../components/FollowButton";
import { ShowCard } from "../../components/ShowCard";

const AVG_EPISODE_MINUTES = 42;

function formatTvTime(totalMinutes: number) {
  const totalHours = Math.floor(totalMinutes / 60);
  const months = Math.floor(totalHours / (24 * 30));
  const days = Math.floor((totalHours % (24 * 30)) / 24);
  const hours = totalHours % 24;
  return { months, days, hours };
}

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [counts, setCounts] = useState({ followers: 0, following: 0 });
  const [isFollowing, setIsFollowing] = useState(false);
  const [favorites, setFavorites] = useState<UserShow[]>([]);
  const [shows, setShows] = useState<UserShow[]>([]);
  const [episodeCount, setEpisodeCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      Promise.all([
        fetchProfile(id),
        fetchFollowCounts(id),
        fetchIsFollowing(id),
        fetchFavorites(id),
        fetchUserShows(id),
        fetchEpisodeCount(id),
      ]).then(([p, c, following, favs, allShows, count]) => {
        if (!active) return;
        setProfile(p);
        setCounts(c);
        setIsFollowing(following);
        setFavorites(favs);
        setShows(allShows);
        setEpisodeCount(count);
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }, [id])
  );

  const tvTime = formatTvTime(episodeCount * AVG_EPISODE_MINUTES);

  async function toggleFollow() {
    setBusy(true);
    try {
      if (isFollowing) {
        await unfollowUser(id);
        setIsFollowing(false);
        setCounts((prev) => ({ ...prev, followers: Math.max(0, prev.followers - 1) }));
      } else {
        await followUser(id);
        setIsFollowing(true);
        setCounts((prev) => ({ ...prev, followers: prev.followers + 1 }));
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading || !profile) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.black} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.profileHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarInitial}>{profile.username[0]?.toUpperCase()}</Text>
        </View>
        <Text style={styles.username}>{profile.username}</Text>
        <FollowButton following={isFollowing} loading={busy} onPress={toggleFollow} />
      </View>

      <View style={styles.followRow}>
        <Pressable
          style={styles.followStat}
          onPress={() => router.push({ pathname: "/connections/[id]", params: { id: profile.user_id, type: "followers" } })}
        >
          <Text style={styles.followNumber}>{counts.followers}</Text>
          <Text style={styles.followLabel}>{t.profile.followers}</Text>
        </Pressable>
        <Pressable
          style={[styles.followStat, styles.followStatBorder]}
          onPress={() => router.push({ pathname: "/connections/[id]", params: { id: profile.user_id, type: "following" } })}
        >
          <Text style={styles.followNumber}>{counts.following}</Text>
          <Text style={styles.followLabel}>{t.profile.following}</Text>
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t.profile.statistics}</Text>
        </View>
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

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t.profile.favorites}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.showsRow}>
          {favorites.length === 0 ? (
            <Text style={styles.empty}>{t.profile.noFavorites}</Text>
          ) : (
            favorites.map((s) => <ShowCard key={s.id} id={s.tvmaze_id} name={s.show_name} imageUrl={s.show_image} />)
          )}
        </ScrollView>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t.profile.shows}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.showsRow}>
          {shows.length === 0 ? (
            <Text style={styles.empty}>{t.profile.noShows}</Text>
          ) : (
            shows.map((s) => <ShowCard key={s.id} id={s.tvmaze_id} name={s.show_name} imageUrl={s.show_image} />)
          )}
        </ScrollView>
      </ScrollView>
    </View>
  );
}

function TvTimeUnit({ value, label, styles }: { value: number; label: string; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.tvTimeUnit}>
      <Text style={styles.tvTimeValue}>{value}</Text>
      <Text style={styles.tvTimeLabel}>{label}</Text>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 16,
    },
    profileHeader: { alignItems: "center", paddingVertical: 20, gap: 10 },
    avatar: {
      width: 84,
      height: 84,
      borderRadius: 42,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarInitial: { fontSize: 34, fontWeight: "800", color: colors.onAccent },
    username: { fontSize: 20, fontWeight: "800", color: colors.text },
    followRow: {
      flexDirection: "row",
      marginHorizontal: 16,
      paddingVertical: 16,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    followStat: { flex: 1, alignItems: "center" },
    followStatBorder: { borderLeftWidth: 1, borderLeftColor: colors.border },
    followNumber: { fontSize: 18, fontWeight: "800", color: colors.text },
    followLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    sectionHeader: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 12 },
    sectionTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
    showsRow: { paddingHorizontal: 16, paddingBottom: 24 },
    empty: { color: colors.textMuted },
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
  });
}
