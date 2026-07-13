import { useCallback, useMemo, useRef, useState } from "react";
import { Animated, View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { fetchFollowingActivity, ActivityItem } from "../../lib/activity";
import { fetchFollowingIds } from "../../lib/follows";
import { getCurrentUserId } from "../../lib/supabase";
import { posterUrl } from "../../lib/tmdb";
import { FEELING_EMOJIS } from "../../lib/feelings";
import { useColors, radius, type, Colors } from "../../lib/theme";
import { useLanguage, Translations } from "../../lib/i18n";
import { useScrollToTopOnTabPress } from "../../lib/useScrollToTopOnTabPress";
import { useActivityUnseen } from "../../context/ActivityContext";
import { useMountIn } from "../../lib/animations";
import { Avatar } from "../../components/Avatar";
import { EmptyState } from "../../components/EmptyState";

function feelingEmoji(key: string | null): string | null {
  return FEELING_EMOJIS.find((f) => f.key === key)?.emoji ?? null;
}

// Small glyph badge on the avatar corner, one per activity kind — gives the
// feed visual rhythm to scan (comments vs. watches) instead of every row
// looking identical until you read the sentence.
type IoniconName = keyof typeof Ionicons.glyphMap;
function kindIcon(kind: ActivityItem["kind"]): IoniconName {
  switch (kind) {
    case "episode_watched":
    case "movie_watched":
      return "eye";
    default:
      return "chatbubble-ellipses";
  }
}

// Matches app/notifications.tsx's own plain-date formatting rather than
// inventing a new relative-time i18n subsystem ("3h ago", "2d ago", ...)
// just for this screen.
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

// One feed row for any ActivityItem kind — image/title/verb/meta vary by
// kind (see lib/activity.ts), but the avatar+username+timestamp shell and
// tap-to-open behavior are identical either way.
function ActivityRow({
  item,
  index,
  t,
  colors,
  styles,
}: {
  item: ActivityItem;
  index: number;
  t: Translations;
  colors: Colors;
  styles: Styles;
}) {
  const router = useRouter();
  const username = item.user?.username ?? "?";
  // Only the first screenful staggers — capped so a long feed doesn't leave
  // rows 30+ waiting on a multi-second delay chain before they ever appear.
  const mountIn = useMountIn(Math.min(index, 8) * 45);

  let image: string | null = null;
  let title = "";
  let verb = "";
  let rating: number | null = null;
  let feeling: string | null = null;
  let body: string | null = null;
  let onPress = () => {};

  switch (item.kind) {
    case "episode_watched":
      image = item.showImage;
      title = item.showName;
      verb = t.activity.watchedEpisode(item.season, item.number);
      rating = item.rating;
      feeling = item.feeling;
      onPress = () => router.push({ pathname: "/episode/[id]", params: { id: String(item.episodeId), showId: String(item.showId) } });
      break;
    case "movie_watched":
      image = posterUrl(item.moviePosterPath, "w200");
      title = item.movieTitle;
      verb = t.activity.watchedMovie;
      rating = item.rating;
      feeling = item.feeling;
      onPress = () => item.movieTmdbId != null && router.push(`/movie/tmdb/${item.movieTmdbId}`);
      break;
    case "show_comment":
      image = item.showImage;
      title = item.showName;
      verb = t.activity.commentedOnShow;
      body = item.body;
      onPress = () => router.push(`/show/${item.showId}`);
      break;
    case "episode_comment":
      image = item.showImage;
      title = item.showName;
      verb = t.activity.commentedOnEpisode;
      body = item.body;
      onPress = () =>
        item.episodeId != null &&
        router.push({ pathname: "/episode/[id]", params: { id: String(item.episodeId), showId: String(item.showId) } });
      break;
    case "movie_comment":
      image = posterUrl(item.moviePosterPath, "w200");
      title = item.movieTitle;
      verb = t.activity.commentedOnMovie;
      body = item.body;
      onPress = () => router.push(`/movie/tmdb/${item.movieTmdbId}`);
      break;
  }

  return (
    <Animated.View style={{ opacity: mountIn.opacity, transform: mountIn.transform }}>
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={onPress}
      >
        <View style={styles.avatarWrap}>
          <Avatar name={username} imageUri={item.user?.avatar_url} size="sm" />
          <View style={[styles.kindBadge, { backgroundColor: rating != null || feeling ? colors.accent : colors.blue }]}>
            <Ionicons name={kindIcon(item.kind)} size={11} color={colors.onAccent} />
          </View>
        </View>
        <View style={styles.rowContent}>
          <Text style={styles.rowText}>
            <Text style={styles.username}>{username}</Text>
            <Text style={styles.verb}> {verb} </Text>
            <Text style={styles.title}>{title}</Text>
          </Text>
          {body && (
            <Text style={styles.body} numberOfLines={2}>
              {body}
            </Text>
          )}
          <View style={styles.metaRow}>
            {rating != null && (
              <View style={styles.metaChip}>
                <Text style={styles.metaChipText}>⭐ {rating}</Text>
              </View>
            )}
            {feeling && (
              <View style={styles.metaChip}>
                <Text style={styles.metaChipText}>{feelingEmoji(feeling)}</Text>
              </View>
            )}
            <Text style={styles.metaTime}>{formatDate(item.createdAt)}</Text>
          </View>
        </View>
        {image ? (
          <Image source={{ uri: image }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Ionicons name="film-outline" size={18} color={colors.textFaint} />
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

export default function ActivityScreen() {
  const router = useRouter();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasFollows, setHasFollows] = useState(true);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const listRef = useRef<FlatList<ActivityItem>>(null);
  const { markSeen } = useActivityUnseen();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchFollowingActivity();
      setItems(data);
      // fetchFollowingActivity() returns [] both when you follow nobody and
      // when everyone you follow simply has no activity yet — the empty
      // state should say something different for each (see below), so this
      // needs its own check rather than inferring it from items.length.

      // Marks seen using the timestamp of the item actually on screen (the
      // list is sorted newest-first), not ActivityContext's own `latestAt` —
      // that one is only refreshed by the Stack-level focus effect, which
      // doesn't fire on a plain tab switch to Activity, so it could still be
      // pointing at an older "latest" than what just loaded here.
      markSeen(data[0]?.createdAt);
    } finally {
      setLoading(false);
    }
  }, [markSeen]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      load();
      getCurrentUserId().then(async (myId) => {
        if (!active || !myId) return;
        const following = await fetchFollowingIds(myId);
        if (active) setHasFollows(following.length > 0);
      });
      return () => {
        active = false;
      };
    }, [load])
  );

  useScrollToTopOnTabPress(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));

  return (
    <View style={styles.container}>
      <LinearGradient colors={[`${colors.accent}1f`, "transparent"]} style={styles.headerGlow} />
      <View style={styles.headerBlock}>
        <Text style={styles.header}>{t.activity.title}</Text>
        {!loading && items.length > 0 && <Text style={styles.subtitle}>{t.activity.subtitle}</Text>}
      </View>
      {loading ? (
        <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="pulse-outline"
          title={hasFollows ? t.activity.empty : t.activity.emptyNoFollows}
        />
      ) : (
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => <ActivityRow item={item} index={index} t={t} colors={colors} styles={styles} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
      {!hasFollows && !loading && (
        <Pressable style={styles.findPeopleBtn} onPress={() => router.push("/users/search")}>
          <Text style={styles.findPeopleBtnText}>{t.activity.findPeople}</Text>
        </Pressable>
      )}
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    headerGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 140, pointerEvents: "none" },
    headerBlock: { padding: 16, paddingBottom: 12 },
    header: { fontSize: type.title, fontWeight: "800", color: colors.text },
    subtitle: { fontSize: type.bodySm, color: colors.textMuted, marginTop: 2 },
    list: { paddingHorizontal: 16, paddingBottom: 32 },
    separator: { height: 10 },
    row: {
      flexDirection: "row",
      gap: 12,
      alignItems: "flex-start",
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
    },
    rowPressed: { opacity: 0.7 },
    avatarWrap: { position: "relative" },
    kindBadge: {
      position: "absolute",
      bottom: -2,
      right: -2,
      width: 18,
      height: 18,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: colors.surface,
    },
    rowContent: { flex: 1, gap: 2 },
    rowText: { fontSize: type.bodySm, lineHeight: 19 },
    username: { fontWeight: "800", color: colors.text },
    verb: { color: colors.textMuted },
    title: { fontWeight: "700", color: colors.text },
    body: {
      fontSize: type.caption,
      color: colors.textMuted,
      marginTop: 2,
      backgroundColor: colors.backgroundAlt,
      borderRadius: radius.sm,
      padding: 8,
    },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
    metaChip: {
      backgroundColor: colors.accentSoft,
      borderRadius: radius.pill,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    metaChipText: { fontSize: type.caption, color: colors.accentDark, fontWeight: "700" },
    metaTime: { fontSize: type.micro, color: colors.textFaint, marginLeft: "auto" },
    thumb: {
      width: 46,
      height: 66,
      borderRadius: radius.sm,
      backgroundColor: colors.backgroundAlt,
    },
    thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
    findPeopleBtn: {
      alignSelf: "center",
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
      paddingVertical: 10,
      paddingHorizontal: 20,
      marginBottom: 24,
    },
    findPeopleBtnText: { color: colors.onAccent, fontWeight: "700" },
  });
}
