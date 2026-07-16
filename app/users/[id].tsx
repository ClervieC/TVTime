import { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Animated,
  ActivityIndicator,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";
import { fetchProfile, Profile } from "../../lib/profiles";
import { fetchFollowCounts, fetchIsFollowing, followUser, unfollowUser } from "../../lib/follows";
import { fetchEpisodeCount, fetchFavorites, fetchUserShows, UserShow } from "../../lib/userShows";
import {
  fetchPublicWatchedMovies,
  fetchPublicWatchedMovieCount,
  fetchPublicFavoriteMovies,
  fetchUserMovies,
  PublicMovie,
} from "../../lib/userMovies";
import { posterUrl } from "../../lib/tmdb";
import { getCurrentUserId } from "../../lib/supabase";
import { FollowButton } from "../../components/FollowButton";
import { ShowCard } from "../../components/ShowCard";
import { Avatar } from "../../components/Avatar";
import { EmptyState } from "../../components/EmptyState";
import { ReportModal } from "../../components/ReportModal";
import { Pill } from "../../components/Pill";
import { useGoBack } from "../../lib/useGoBack";

const AVG_EPISODE_MINUTES = 42;
// Matches app/(tabs)/profile.tsx's own constant — same rough estimate used
// for a logged-in user's own movie watch time, reused here so the two
// screens' numbers are computed the same way.
const AVG_MOVIE_MINUTES = 110;

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
  const goBack = useGoBack("/(tabs)/profile");
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();

  // Below this height, the fixed avatar/name/pills/follow-button block
  // (profileHeader) ate too much of the little vertical room there is to
  // begin with. Rather than just shrinking it outright (see the Profile
  // tab's own isSmallScreen fix), it collapses away as the user scrolls the
  // content beneath it, and a compact avatar+name fades in up in the
  // back/report row to keep that identity visible while taking almost no
  // space. Larger screens keep the header static, exactly as before.
  const { height: windowHeight } = useWindowDimensions();
  const isSmallScreen = windowHeight < 700;
  const scrollY = useRef(new Animated.Value(0)).current;
  // Measured once from profileHeader's own natural layout (it varies with
  // whether the match pills are present) — the collapse animation's height
  // interpolation needs a concrete start value, not "auto".
  const [headerHeight, setHeaderHeight] = useState(0);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [counts, setCounts] = useState({ followers: 0, following: 0 });
  const [isFollowing, setIsFollowing] = useState(false);
  const [favorites, setFavorites] = useState<UserShow[]>([]);
  const [shows, setShows] = useState<UserShow[]>([]);
  const [movies, setMovies] = useState<PublicMovie[]>([]);
  const [favoriteMovies, setFavoriteMovies] = useState<PublicMovie[]>([]);
  const [episodeCount, setEpisodeCount] = useState(0);
  const [movieCount, setMovieCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  // null until (if ever) the shared-shows/shared-movies match resolves —
  // see the effect below. Reset on every id change so switching between two
  // profiles without this screen fully unmounting (still the same route,
  // new param) can't leave the previous profile's match badges showing
  // briefly. Kept as two separate badges rather than one blended number —
  // same reasoning as Activity's Suggested tab (see app/(tabs)/activity.tsx).
  const [match, setMatch] = useState<{ shared: number; percent: number } | null>(null);
  const [movieMatch, setMovieMatch] = useState<{ shared: number; percent: number } | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setMatch(null);
      setMovieMatch(null);
      Promise.all([
        fetchProfile(id),
        fetchFollowCounts(id),
        fetchIsFollowing(id),
        fetchFavorites(id),
        fetchUserShows(id),
        fetchEpisodeCount(id),
        getCurrentUserId(),
        fetchPublicWatchedMovies(id),
        fetchPublicWatchedMovieCount(id),
        fetchPublicFavoriteMovies(id),
      ]).then(async ([p, c, following, favs, allShows, count, myId, watchedMovies, watchedMovieCount, favMovies]) => {
        if (!active) return;
        setProfile(p);
        setCounts(c);
        setIsFollowing(following);
        setFavorites(favs);
        setShows(allShows);
        setEpisodeCount(count);
        setMovies(watchedMovies);
        setMovieCount(watchedMovieCount);
        setFavoriteMovies(favMovies);
        setLoading(false);

        // Single pairwise comparison (not "rank every other user"), so this
        // is computed directly here rather than through the
        // suggested_show_buddies RPC that backs Activity's Suggested tab
        // (see lib/follows.ts) — that one's built for scanning every user
        // at once, which would be wasteful for just one profile. Same
        // overlap-coefficient definition though (shared / the smaller of
        // the two lists), so the percentage reads consistently wherever it
        // shows up.
        if (myId && myId !== id) {
          const mine = await fetchUserShows();
          if (!active) return;
          const mineIds = new Set(mine.map((s) => s.tvmaze_id));
          const shared = allShows.filter((s) => mineIds.has(s.tvmaze_id)).length;
          if (shared > 0) {
            const percent = Math.round((shared / Math.max(Math.min(mineIds.size, allShows.length), 1)) * 100);
            setMatch({ shared, percent });
          }

          const myMovies = await fetchUserMovies();
          if (!active) return;
          const myMovieIds = new Set(myMovies.filter((m) => m.tmdb_id != null).map((m) => m.tmdb_id));
          const sharedMovies = watchedMovies.filter((m) => myMovieIds.has(m.tmdb_id)).length;
          if (sharedMovies > 0) {
            const moviePercent = Math.round(
              (sharedMovies / Math.max(Math.min(myMovieIds.size, watchedMovies.length), 1)) * 100
            );
            setMovieMatch({ shared: sharedMovies, percent: moviePercent });
          }
        }
      });
      return () => {
        active = false;
      };
    }, [id])
  );

  const tvTime = formatTvTime(episodeCount * AVG_EPISODE_MINUTES);
  const movieTime = formatTvTime(movieCount * AVG_MOVIE_MINUTES);

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

  // Full fade-out/collapse finishes at 100px of scroll regardless of the
  // header's actual measured height — a fixed range reads as consistently
  // "quick" whether the pills are showing or not, rather than a taller
  // header (more content to scroll past) also taking longer to collapse.
  const collapseRange = 100;
  const headerOpacity = scrollY.interpolate({
    inputRange: [0, collapseRange * 0.6],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });
  const headerAnimatedHeight = scrollY.interpolate({
    inputRange: [0, collapseRange],
    outputRange: [headerHeight, 0],
    extrapolate: "clamp",
  });
  const compactOpacity = scrollY.interpolate({
    inputRange: [collapseRange * 0.5, collapseRange],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  return (
    <View style={styles.container}>
      <View style={[styles.header, isSmallScreen && styles.headerSmallScreen]}>
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        {isSmallScreen && (
          <Animated.View style={[styles.compactHeaderInfo, { opacity: compactOpacity }]}>
            <Avatar name={profile.username} imageUri={profile.avatar_url} size="sm" />
            <Text style={styles.compactUsername} numberOfLines={1}>
              {profile.username}
            </Text>
            <FollowButton following={isFollowing} loading={busy} onPress={toggleFollow} />
          </Animated.View>
        )}
        <Pressable
          onPress={() => setReporting(true)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t.report.reportUser}
        >
          <Ionicons name="flag-outline" size={20} color={colors.textFaint} />
        </Pressable>
        {isSmallScreen && (
          // Only actually needed once the compact bar is what's pinned at
          // the top (profileHeader's own border below serves that purpose
          // until then) — faded in with the same compactOpacity rather than
          // a plain static border, so it doesn't show as a stray line under
          // the back/report row before there's anything compact to separate
          // from the content yet.
          <Animated.View style={[styles.headerDivider, { opacity: compactOpacity }]} />
        )}
      </View>
      <ReportModal
        visible={reporting}
        onClose={() => setReporting(false)}
        target={{ targetType: "user", targetUserId: profile.user_id }}
      />

      {isSmallScreen ? (
        <Animated.View
          style={{ height: headerHeight ? headerAnimatedHeight : undefined, overflow: "hidden" }}
        >
          <Animated.View
            style={[styles.profileHeader, { opacity: headerOpacity }]}
            // Not "lock on first measurement" — profileHeader's natural
            // height grows once the match pills row appears (match/
            // movieMatch resolve asynchronously, after this already had its
            // first layout pass with neither one yet). Locking to that
            // earlier, shorter height clipped the follow button clean off
            // the bottom once the pills pushed everything else down.
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              setHeaderHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
            }}
          >
            <Avatar name={profile.username} imageUri={profile.avatar_url} size="lg" />
            <Text style={styles.username}>{profile.username}</Text>
            {(match || movieMatch) && (
              <View style={styles.matchRow}>
                {match && <Pill tone="accent">{t.activity.sharedShows(match.shared, match.percent)}</Pill>}
                {movieMatch && <Pill tone="accent">{t.activity.sharedMovies(movieMatch.shared, movieMatch.percent)}</Pill>}
              </View>
            )}
            <FollowButton following={isFollowing} loading={busy} onPress={toggleFollow} />
          </Animated.View>
        </Animated.View>
      ) : (
        <View style={styles.profileHeader}>
          <Avatar name={profile.username} imageUri={profile.avatar_url} size="lg" />
          <Text style={styles.username}>{profile.username}</Text>
          {(match || movieMatch) && (
            <View style={styles.matchRow}>
              {match && <Pill tone="accent">{t.activity.sharedShows(match.shared, match.percent)}</Pill>}
              {movieMatch && <Pill tone="accent">{t.activity.sharedMovies(movieMatch.shared, movieMatch.percent)}</Pill>}
            </View>
          )}
          <FollowButton following={isFollowing} loading={busy} onPress={toggleFollow} />
        </View>
      )}

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: false,
        })}
        scrollEventThrottle={16}
      >
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

        <SectionHeader title={t.profile.statistics} styles={styles} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsRow}>
          <StatCard
            icon="time-outline"
            color={colors.blue}
            label={t.profile.watchTime}
            value={`${tvTime.months}${t.profile.months[0]} ${tvTime.days}${t.profile.days[0]} ${tvTime.hours}${t.profile.hours[0]}`}
            styles={styles}
          />
          <StatCard
            icon="checkmark-circle-outline"
            color={colors.green}
            label={t.profile.episodesWatched}
            value={episodeCount.toLocaleString()}
            styles={styles}
          />
          <StatCard
            icon="time-outline"
            color={colors.red}
            label={t.profile.movieWatchTime}
            value={`${movieTime.months}${t.profile.months[0]} ${movieTime.days}${t.profile.days[0]} ${movieTime.hours}${t.profile.hours[0]}`}
            styles={styles}
          />
          <StatCard
            icon="checkmark-circle-outline"
            color={colors.yellow}
            label={t.profile.moviesWatched}
            value={movieCount.toLocaleString()}
            styles={styles}
          />
        </ScrollView>

        <SectionHeader title={t.profile.favorites} count={favorites.length} styles={styles} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.showsRow}>
          {favorites.length === 0 ? (
            <EmptyState icon="heart-outline" title={t.profile.noFavorites} />
          ) : (
            favorites.map((s) => <ShowCard key={s.id} id={s.tvmaze_id} name={s.show_name} imageUrl={s.show_image} />)
          )}
        </ScrollView>

        <SectionHeader title={t.profile.shows} count={shows.length} styles={styles} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.showsRow}>
          {shows.length === 0 ? (
            <EmptyState icon="tv-outline" title={t.profile.noShows} />
          ) : (
            shows.map((s) => <ShowCard key={s.id} id={s.tvmaze_id} name={s.show_name} imageUrl={s.show_image} />)
          )}
        </ScrollView>

        <SectionHeader title={t.profile.favoriteMovies} count={favoriteMovies.length} styles={styles} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.showsRow}>
          {favoriteMovies.length === 0 ? (
            <EmptyState icon="heart-outline" title={t.profile.noFavoriteMovies} />
          ) : (
            favoriteMovies.map((m) => (
              <ShowCard
                key={m.tmdb_id}
                id={m.tmdb_id}
                name={m.title}
                imageUrl={posterUrl(m.poster_path, "w200")}
                onPress={() => router.push(`/movie/tmdb/${m.tmdb_id}`)}
              />
            ))
          )}
        </ScrollView>

        <SectionHeader title={t.profile.movies} count={movies.length} styles={styles} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.showsRow}>
          {movies.length === 0 ? (
            <EmptyState icon="film-outline" title={t.profile.noMovies} />
          ) : (
            movies.map((m) => (
              <ShowCard
                key={m.tmdb_id}
                id={m.tmdb_id}
                name={m.title}
                imageUrl={posterUrl(m.poster_path, "w200")}
                onPress={() => router.push(`/movie/tmdb/${m.tmdb_id}`)}
              />
            ))
          )}
        </ScrollView>
      </Animated.ScrollView>
    </View>
  );
}

// Matches app/(tabs)/profile.tsx's own SectionHeader exactly — that screen
// is what this one is meant to look like, just read-only.
function SectionHeader({ title, count, styles }: { title: string; count?: number; styles: ReturnType<typeof createStyles> }) {
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

// Matches app/(tabs)/profile.tsx's own StatCard, minus the onPress/chevron
// — that one drills into /stats/shows, which only exists for your own
// data, so a card here is just a static number.
function StatCard({
  icon,
  color,
  label,
  value,
  styles,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statCardIcon, { backgroundColor: `${color}22` }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <Text style={styles.statCardLabel}>{label}</Text>
      <Text style={styles.statCardValue}>{value}</Text>
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
    // The small-screen compact identity that fades in between the back and
    // report buttons as profileHeader collapses away on scroll (see
    // isSmallScreen in the component) — top-left within the row, not
    // centered, so it reads as "the same info, just smaller" rather than a
    // whole new centered header competing with the one collapsing above it.
    compactHeaderInfo: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      // Centered as a group in the space between the back/report buttons —
      // left-aligned (the default) put it right up against the back button
      // instead of reading as a balanced, centered mini version of the full
      // header above it.
      justifyContent: "center",
      gap: 10,
      marginHorizontal: 12,
    },
    compactUsername: { fontSize: type.body, fontWeight: "800", color: colors.text, flexShrink: 1 },
    headerSmallScreen: { paddingBottom: 14 },
    headerDivider: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    // The fixed part of the screen (this + the back/report row above it) —
    // a bottom border here (not on followRow, which now scrolls with the
    // rest of the content) is what stays visible as the actual boundary
    // once the user scrolls the follow counts/stats/etc. up underneath it.
    profileHeader: {
      alignItems: "center",
      paddingVertical: 20,
      gap: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    username: { fontSize: type.title, fontWeight: "800", color: colors.text },
    matchRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
    followRow: {
      flexDirection: "row",
      marginHorizontal: 16,
      paddingVertical: 16,
      // No top border here anymore — it would sit right under profileHeader's
      // new one and double up before any scrolling has even happened.
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    followStat: { flex: 1, alignItems: "center" },
    followStatBorder: { borderLeftWidth: 1, borderLeftColor: colors.border },
    followNumber: { fontSize: type.title, fontWeight: "800", color: colors.text },
    followLabel: { fontSize: type.caption, color: colors.textMuted, marginTop: 2 },
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
    showsRow: { paddingHorizontal: 16, paddingBottom: 24 },
    statsRow: { paddingHorizontal: 16, gap: 10 },
    statCard: {
      width: 140,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: 12,
    },
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
  });
}
