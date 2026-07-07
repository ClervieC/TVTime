import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  ScrollView,
  Pressable,
  Animated,
  StyleSheet,
  ActivityIndicator,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect, useNavigation } from "expo-router";
import { getShow, getShowsPool, searchShows, TVMazeShow } from "../../lib/tvmaze";
import {
  fetchUserShows,
  removeUserShow,
  setShowFavorite,
  upsertUserShow,
} from "../../lib/userShows";
import { useColors, radius, Colors } from "../../lib/theme";
import { useLanguage, Translations } from "../../lib/i18n";
import { useScalePress, useMountIn } from "../../lib/animations";

// K-Drama and New Releases are rare in TVmaze's index (ordered by internal
// ID, roughly chronological by when the show was added — not by premiere
// date or language), so a small sample mostly misses them. A bigger pool
// costs nothing extra after the first load: each page is cached individually
// (see getShowsIndex) for an hour, so repeat visits stay fast.
const POOL_PAGES = 15;
const CATEGORY_SIZE = 30;
const NEW_RELEASE_WINDOW_DAYS = 120;

export default function ExploreScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const [query, setQuery] = useState("");
  const [pool, setPool] = useState<TVMazeShow[]>([]);
  const [searchResults, setSearchResults] = useState<TVMazeShow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set());
  const [preferredGenres, setPreferredGenres] = useState<Set<string>>(new Set());
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  let timer: ReturnType<typeof setTimeout>;

  useEffect(() => {
    getShowsPool(POOL_PAGES)
      .then(setPool)
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      fetchUserShows().then((userShows) => {
        if (!active) return;
        setAddedIds(new Set(userShows.map((s) => s.tvmaze_id)));
        setFavoriteIds(
          new Set(
            userShows.filter((s) => s.is_favorite).map((s) => s.tvmaze_id),
          ),
        );

        // Bias "New releases" toward genres the user already follows —
        // getShow is cached (see lib/tvmaze), so this is free for shows
        // already opened elsewhere (Watch List, show detail, ...).
        const followed = userShows.filter((s) => s.status !== "dropped");
        Promise.all(followed.map((s) => getShow(s.tvmaze_id).catch(() => null))).then(
          (shows) => {
            if (!active) return;
            const genres = new Set<string>();
            for (const s of shows) {
              if (!s) continue;
              for (const g of s.genres) genres.add(g);
            }
            setPreferredGenres(genres);
          },
        );
      });
      // Clear the search on the way out, so coming back to a fresh Explore
      // (from another tab) never shows a stale query/result set.
      return () => {
        active = false;
        setQuery("");
        setSearchResults([]);
      };
    }, []),
  );

  // Re-tapping the Explore tab while already on it doesn't change focus (no
  // navigation happens), so the blur cleanup above never runs — this listens
  // for that specific re-tap to clear the search the same way.
  useEffect(() => {
    const unsubscribe = (navigation as any).addListener("tabPress", () => {
      setQuery("");
      setSearchResults([]);
    });
    return unsubscribe;
  }, [navigation]);

  // TVmaze has no server-side "trending" or genre filter, so Discover
  // categories are derived client-side from one shared pool of shows —
  // fetched once and reused, instead of a separate request per category.
  const categories = useMemo(() => {
    const withImage = pool.filter((s) => s.image?.medium);
    const now = Date.now();

    const newReleases = [...withImage]
      .filter((s) => {
        if (!s.premiered) return false;
        const days =
          (now - new Date(s.premiered).getTime()) / (1000 * 60 * 60 * 24);
        return days >= 0 && days <= NEW_RELEASE_WINDOW_DAYS;
      })
      .sort((a, b) => {
        // Shows matching a genre the user already follows are surfaced
        // first; within each group, most recent premiere first.
        const aMatch = a.genres.some((g) => preferredGenres.has(g)) ? 1 : 0;
        const bMatch = b.genres.some((g) => preferredGenres.has(g)) ? 1 : 0;
        if (aMatch !== bMatch) return bMatch - aMatch;
        return new Date(b.premiered!).getTime() - new Date(a.premiered!).getTime();
      })
      .slice(0, CATEGORY_SIZE);

    const popular = [...withImage]
      .filter((s) => s.rating.average != null)
      .sort((a, b) => (b.rating.average ?? 0) - (a.rating.average ?? 0))
      .slice(0, CATEGORY_SIZE);

    const comedy = withImage
      .filter((s) => s.genres.includes("Comedy"))
      .slice(0, CATEGORY_SIZE);
    const drama = withImage
      .filter((s) => s.genres.includes("Drama"))
      .slice(0, CATEGORY_SIZE);
    const kdrama = withImage
      .filter((s) => s.language === "Korean")
      .slice(0, CATEGORY_SIZE);
    const sciFi = withImage
      .filter((s) => s.genres.includes("Science-Fiction"))
      .slice(0, CATEGORY_SIZE);

    return [
      { key: "new", title: t.explore.categoryNew, data: newReleases },
      { key: "popular", title: t.explore.categoryPopular, data: popular },
      { key: "comedy", title: t.explore.categoryComedy, data: comedy },
      { key: "drama", title: t.explore.categoryDrama, data: drama },
      { key: "kdrama", title: t.explore.categoryKdrama, data: kdrama },
      { key: "scifi", title: t.explore.categorySciFi, data: sciFi },
    ].filter((c) => c.data.length > 0);
  }, [pool, t, preferredGenres]);

  function onChangeText(text: string) {
    setQuery(text);
    clearTimeout(timer);
    if (!text.trim()) {
      setSearchResults([]);
      return;
    }
    timer = setTimeout(async () => {
      const data = await searchShows(text);
      setSearchResults(data.map((d) => d.show));
    }, 400);
  }

  async function quickAdd(show: TVMazeShow) {
    const isAdded = addedIds.has(show.id);
    if (isAdded) {
      await removeUserShow(show.id);
      setAddedIds((prev) => {
        const next = new Set(prev);
        next.delete(show.id);
        return next;
      });
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        next.delete(show.id);
        return next;
      });
    } else {
      await upsertUserShow({
        tvmaze_id: show.id,
        show_name: show.name,
        show_image: show.image?.medium ?? null,
        status: "want_to_watch",
      });
      setAddedIds((prev) => new Set(prev).add(show.id));
    }
  }

  async function toggleFavorite(show: TVMazeShow) {
    const isFavorite = favoriteIds.has(show.id);
    if (!addedIds.has(show.id)) {
      await upsertUserShow({
        tvmaze_id: show.id,
        show_name: show.name,
        show_image: show.image?.medium ?? null,
        status: "want_to_watch",
      });
      setAddedIds((prev) => new Set(prev).add(show.id));
    }
    await setShowFavorite(show.id, !isFavorite);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (isFavorite) next.delete(show.id);
      else next.add(show.id);
      return next;
    });
  }

  const isSearching = !!query.trim();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t.explore.title}</Text>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.textFaint} />
        <TextInput
          style={styles.searchInput}
          placeholder={t.explore.searchPlaceholder}
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={onChangeText}
        />
        {isSearching && (
          <Pressable onPress={() => onChangeText("")} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textFaint} />
          </Pressable>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
      ) : isSearching ? (
        <FlatList
          data={searchResults}
          keyExtractor={(show) => String(show.id)}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Text style={styles.placeholder}>{t.explore.noResults(query)}</Text>
          }
          renderItem={({ item: show }) => (
            <ExploreCard
              show={show}
              isAdded={addedIds.has(show.id)}
              isFavorite={favoriteIds.has(show.id)}
              onPress={() => router.push(`/show/${show.id}`)}
              onToggleFavorite={() => toggleFavorite(show)}
              onQuickAdd={() => quickAdd(show)}
              colors={colors}
              styles={styles}
              t={t}
            />
          )}
        />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.categoriesScroll}
        >
          {categories.map((category) => (
            <View key={category.key} style={styles.categorySection}>
              <Text style={styles.categoryTitle}>{category.title}</Text>
              <FlatList
                data={category.data}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyExtractor={(show) => String(show.id)}
                contentContainerStyle={styles.categoryRow}
                renderItem={({ item: show }) => (
                  <View style={styles.categoryCard}>
                    <ExploreCard
                      show={show}
                      isAdded={addedIds.has(show.id)}
                      isFavorite={favoriteIds.has(show.id)}
                      onPress={() => router.push(`/show/${show.id}`)}
                      onToggleFavorite={() => toggleFavorite(show)}
                      onQuickAdd={() => quickAdd(show)}
                      colors={colors}
                      styles={styles}
                      t={t}
                    />
                  </View>
                )}
              />
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

type ExploreStyles = ReturnType<typeof createStyles>;

function ExploreCard({
  show,
  isAdded,
  isFavorite,
  onPress,
  onToggleFavorite,
  onQuickAdd,
  colors,
  styles,
  t,
}: {
  show: TVMazeShow;
  isAdded: boolean;
  isFavorite: boolean;
  onPress: () => void;
  onToggleFavorite: () => void;
  onQuickAdd: () => void;
  colors: Colors;
  styles: ExploreStyles;
  t: Translations;
}) {
  const { scale, onPressIn, onPressOut } = useScalePress();
  const mountIn = useMountIn();

  return (
    <Pressable
      style={styles.card}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={onPress}
    >
      <Animated.View
        style={{
          opacity: mountIn.opacity,
          transform: [...mountIn.transform, { scale }],
        }}
      >
        <View style={styles.cardImageWrap}>
          {show.image ? (
            <Image
              source={{ uri: show.image.medium }}
              style={styles.cardImage}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.cardImage, styles.cardImagePlaceholder]} />
          )}
          <View style={styles.cardActions}>
            <Pressable
              style={styles.iconBtn}
              onPress={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
            >
              <Ionicons
                name={isFavorite ? "heart" : "heart-outline"}
                size={15}
                color={isFavorite ? colors.red : "#fff"}
              />
            </Pressable>
            <Pressable
              style={[styles.iconBtn, isAdded && styles.iconBtnActive]}
              onPress={(e) => {
                e.stopPropagation();
                onQuickAdd();
              }}
            >
              <Ionicons
                name={isAdded ? "checkmark" : "add"}
                size={16}
                color={isAdded ? colors.onAccent : "#fff"}
              />
            </Pressable>
          </View>
        </View>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {show.name}
        </Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {show.status === "Ended" ? t.explore.ended : t.explore.running}
          {show.network ? ` · ${show.network.name}` : ""}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    title: {
      fontSize: 22,
      fontWeight: "800",
      color: colors.text,
      paddingHorizontal: 16,
      paddingTop: 20,
    },
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginHorizontal: 16,
      marginTop: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.backgroundAlt,
      borderRadius: radius.sm,
    },
    searchInput: { flex: 1, fontSize: 16, color: colors.text },
    grid: { padding: 16, paddingTop: 8, gap: 16 },
    row: { gap: 16 },
    categoriesScroll: { paddingTop: 16, paddingBottom: 24 },
    categorySection: { marginBottom: 20 },
    categoryTitle: {
      fontSize: 17,
      fontWeight: "800",
      color: colors.text,
      paddingHorizontal: 16,
      marginBottom: 12,
    },
    categoryRow: { paddingHorizontal: 16, gap: 12 },
    categoryCard: { width: 130 },
    card: { flex: 1 },
    cardImageWrap: { position: "relative" },
    cardImage: {
      width: "100%",
      aspectRatio: 2 / 3,
      borderRadius: radius.md,
      backgroundColor: colors.backgroundAlt,
    },
    cardImagePlaceholder: { backgroundColor: colors.backgroundAlt },
    cardActions: { position: "absolute", top: 8, right: 8, gap: 6 },
    iconBtn: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: "rgba(0,0,0,0.45)",
      alignItems: "center",
      justifyContent: "center",
    },
    iconBtnActive: { backgroundColor: colors.accent },
    cardTitle: {
      color: colors.text,
      fontWeight: "700",
      fontSize: 13,
      marginTop: 8,
    },
    cardMeta: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
    placeholder: {
      color: colors.textMuted,
      textAlign: "center",
      marginTop: 40,
    },
  });
}
