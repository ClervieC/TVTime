import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet, ActivityIndicator, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { getShowsIndex, searchShows, TVMazeShow } from "../../lib/tvmaze";
import { fetchUserShows, removeUserShow, setShowFavorite, upsertUserShow } from "../../lib/userShows";
import { colors, radius } from "../../lib/theme";

const TABS = ["FEED", "DISCOVER", "GROUPS", "ACTIVITY"] as const;
type Tab = (typeof TABS)[number];

function fakeWatchedBy(id: number) {
  return Math.round((((id * 9301 + 49297) % 233280) / 233280) * 900) + 30;
}

export default function ExploreScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("FEED");
  const [query, setQuery] = useState("");
  const [shows, setShows] = useState<TVMazeShow[]>([]);
  const [searchResults, setSearchResults] = useState<TVMazeShow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set());
  let timer: ReturnType<typeof setTimeout>;

  useEffect(() => {
    getShowsIndex(0)
      .then((data) => setShows(data.slice(0, 12)))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      fetchUserShows().then((userShows) => {
        if (!active) return;
        setAddedIds(new Set(userShows.map((s) => s.tvmaze_id)));
        setFavoriteIds(new Set(userShows.filter((s) => s.is_favorite).map((s) => s.tvmaze_id)));
      });
      return () => {
        active = false;
      };
    }, [])
  );

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

  const listData = query.trim() ? searchResults : shows;

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.textFaint} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={onChangeText}
        />
      </View>

      <ScrollView
        horizontal
        style={styles.tabsScroll}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsRow}
      >
        {TABS.map((t) => (
          <Pressable
            key={t}
            style={[styles.tabChip, tab === t && styles.tabChipActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabChipText, tab === t && styles.tabChipTextActive]}>{t}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
      ) : (
        <ScrollView style={styles.feedScroll} contentContainerStyle={styles.feed} showsVerticalScrollIndicator={false}>
          {tab === "FEED" &&
            listData.map((show) => {
              const isAdded = addedIds.has(show.id);
              const isFavorite = favoriteIds.has(show.id);
              return (
                <Pressable key={show.id} style={styles.card} onPress={() => router.push(`/show/${show.id}`)}>
                  <View style={styles.cardImageWrap}>
                    {show.image ? (
                      <Image source={{ uri: show.image.original }} style={styles.cardImage} resizeMode="cover" />
                    ) : (
                      <View style={[styles.cardImage, styles.cardImagePlaceholder]} />
                    )}
                    <View style={styles.cardActions}>
                      <Pressable
                        style={styles.heartBtn}
                        onPress={(e) => {
                          e.stopPropagation();
                          toggleFavorite(show);
                        }}
                      >
                        <Ionicons
                          name={isFavorite ? "heart" : "heart-outline"}
                          size={16}
                          color={isFavorite ? colors.red : "#fff"}
                        />
                      </Pressable>
                      <Pressable
                        style={[styles.addBtn, isAdded && styles.addBtnActive]}
                        onPress={(e) => {
                          e.stopPropagation();
                          quickAdd(show);
                        }}
                      >
                        <Ionicons name={isAdded ? "checkmark" : "add"} size={18} color={isAdded ? colors.black : colors.accent} />
                      </Pressable>
                    </View>
                    <View style={styles.cardOverlay}>
                      <Ionicons name="tv-outline" size={16} color="#fff" />
                      <Text style={styles.cardTitle}>{show.name}</Text>
                    </View>
                  </View>
                  <Text style={styles.cardMeta}>
                    {show.status === "Ended" ? "Ended" : "Running"}
                    {show.network ? ` · ${show.network.name}` : ""}
                  </Text>
                  <View style={styles.watchedByRow}>
                    <Text style={styles.watchedByLabel}>Watched by</Text>
                  </View>
                  <View style={styles.watchedByCount}>
                    <View style={styles.avatarDot} />
                    <Text style={styles.watchedByNumber}>+{fakeWatchedBy(show.id)}K</Text>
                  </View>
                </Pressable>
              );
            })}

          {tab === "FEED" && !!query.trim() && listData.length === 0 && (
            <Text style={styles.placeholder}>Aucun résultat pour "{query}".</Text>
          )}
          {tab !== "FEED" && <Text style={styles.placeholder}>{tab} arrive bientôt.</Text>}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: 16, color: colors.text },
  tabsScroll: { flexGrow: 0, flexShrink: 0 },
  tabsRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  feedScroll: { flex: 1 },
  tabChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.pillBg,
  },
  tabChipActive: { backgroundColor: colors.accent },
  tabChipText: { fontWeight: "800", fontSize: 12, color: colors.textMuted, letterSpacing: 0.4 },
  tabChipTextActive: { color: colors.black },
  feed: { paddingHorizontal: 16, paddingBottom: 24, gap: 20 },
  card: { borderRadius: radius.md, overflow: "hidden" },
  cardImageWrap: { position: "relative" },
  cardImage: { width: "100%", height: 210, backgroundColor: colors.backgroundAlt },
  cardImagePlaceholder: { backgroundColor: colors.backgroundAlt },
  cardActions: { position: "absolute", top: 10, right: 10, flexDirection: "row", gap: 8 },
  heartBtn: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  addBtn: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  cardOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 12,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  cardTitle: { color: "#fff", fontWeight: "800", fontSize: 17 },
  cardMeta: { color: colors.textMuted, fontSize: 12, marginTop: 6 },
  watchedByRow: {
    marginTop: 10,
    backgroundColor: "#fdf3d6",
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopLeftRadius: radius.sm,
    borderTopRightRadius: radius.sm,
  },
  watchedByLabel: { fontWeight: "700", fontSize: 13, color: colors.text },
  watchedByCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fdf3d6",
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 4,
    borderBottomLeftRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
  },
  avatarDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.accentDark },
  watchedByNumber: { fontWeight: "700", color: colors.text },
  placeholder: { color: colors.textMuted, textAlign: "center", marginTop: 40 },
});
