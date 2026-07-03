import { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getShowEpisodes, TVMazeEpisode } from "../../lib/tvmaze";
import {
  fetchUserShows,
  fetchWatchedEpisodes,
  incrementRewatch,
  setEpisodeWatched,
  UserShow,
  WatchedEpisode,
} from "../../lib/userShows";
import {
  diffDaysFromToday,
  formatTime,
  todayISODate,
  upcomingGroupKey,
  upcomingGroupLabel,
} from "../../lib/dates";
import { EpisodeRow } from "../../components/EpisodeRow";
import { colors, radius } from "../../lib/theme";

type ViewTab = "WATCH LIST" | "UPCOMING";

interface TrackedShow {
  show: UserShow;
  episodes: TVMazeEpisode[];
  watchedIds: Set<number>;
  watchedList: WatchedEpisode[];
}

interface EnrichedEpisode {
  show: UserShow;
  episode: TVMazeEpisode;
  watched: boolean;
  watchedAt?: string;
  isNew?: boolean;
  extraEpisodes?: number;
  timesWatched?: number;
}

type UpcomingRow =
  | { type: "header"; key: string; label: string; showGrid: boolean }
  | { type: "empty" }
  | { type: "episode"; item: EnrichedEpisode };

// Fixed row heights so scroll offsets can be computed exactly (via getItemLayout)
// instead of waiting on onLayout/measurement, which was never reliably ready
// in time once the list had more than a handful of rows.
const HEADER_HEIGHT = 56;
const EMPTY_ROW_HEIGHT = 40;
const EPISODE_ROW_HEIGHT = 125;

function upcomingRowHeight(row: UpcomingRow) {
  if (row.type === "header") return HEADER_HEIGHT;
  if (row.type === "empty") return EMPTY_ROW_HEIGHT;
  return EPISODE_ROW_HEIGHT;
}

export default function ShowsScreen() {
  const [tab, setTab] = useState<ViewTab>("WATCH LIST");
  const [loading, setLoading] = useState(true);
  const [tracked, setTracked] = useState<TrackedShow[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  const upcomingListRef = useRef<FlatList<UpcomingRow>>(null);
  const watchNextY = useRef(0);
  const hasLoadedOnce = useRef(false);

  const loadData = useCallback(async () => {
    if (!hasLoadedOnce.current) {
      setLoading(true);
    }

    const shows = await fetchUserShows();
    const followed = shows.filter(
      (s) => s.status === "watching" || s.status === "want_to_watch",
    );

    const results = await Promise.all(
      followed.map(async (show): Promise<TrackedShow> => {
        try {
          const [episodes, watchedList] = await Promise.all([
            getShowEpisodes(show.tvmaze_id),
            fetchWatchedEpisodes(show.tvmaze_id),
          ]);
          return {
            show,
            episodes,
            watchedIds: new Set(watchedList.map((w) => w.tvmaze_episode_id)),
            watchedList,
          };
        } catch {
          return { show, episodes: [], watchedIds: new Set(), watchedList: [] };
        }
      }),
    );

    setTracked(results);
    setLoading(false);
    hasLoadedOnce.current = true;
  }, []);

  function scrollToWatchNext() {
    const attempt = () =>
      scrollRef.current?.scrollTo({ y: watchNextY.current, animated: false });
    requestAnimationFrame(() => requestAnimationFrame(attempt));
    setTimeout(attempt, 80);
    setTimeout(attempt, 250);
  }

  function scrollToUpcomingToday() {
    // getItemLayout below gives exact offsets up front, so this doesn't need
    // to wait for anything to actually finish rendering/measuring.
    requestAnimationFrame(() => {
      upcomingListRef.current?.scrollToIndex({
        index: todayHeaderIndex,
        animated: false,
      });
    });
  }

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadData().then(() => {
        if (!active) return;
        if (tab === "WATCH LIST") scrollToWatchNext();
        else scrollToUpcomingToday();
      });
      return () => {
        active = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadData, tab]),
  );

  function goToWatchList() {
    setTab("WATCH LIST");
    loadData().then(scrollToWatchNext);
  }

  function goToUpcoming() {
    setTab("UPCOMING");
    loadData().then(scrollToUpcomingToday);
  }

  const watchedHistory = useMemo<EnrichedEpisode[]>(() => {
    const result: EnrichedEpisode[] = [];
    for (const { show, episodes, watchedList } of tracked) {
      const byId = new Map(episodes.map((e) => [e.id, e]));
      for (const w of watchedList) {
        const episode = byId.get(w.tvmaze_episode_id);
        if (episode) {
          result.push({
            show,
            episode,
            watched: true,
            watchedAt: w.watched_at,
            timesWatched: w.times_watched,
          });
        }
      }
    }
    result.sort(
      (a, b) =>
        new Date(b.watchedAt ?? 0).getTime() -
        new Date(a.watchedAt ?? 0).getTime(),
    );
    return result.slice(0, 20).reverse();
  }, [tracked]);

  const { watchNext, haventStarted } = useMemo(() => {
    const now = Date.now();
    const started: EnrichedEpisode[] = [];
    const notStarted: EnrichedEpisode[] = [];
    for (const { show, episodes, watchedIds, watchedList } of tracked) {
      const aired = episodes.filter((e) => new Date(e.airstamp).getTime() <= now);
      const nextEpisode = [...aired]
        .sort((a, b) => a.season - b.season || a.number - b.number)
        .find((e) => !watchedIds.has(e.id));
      if (!nextEpisode) continue;

      // Shows with zero watch history yet are "haven't started" — kept
      // separate from Watch Next so newly-added shows don't crowd it out.
      if (watchedList.length === 0) {
        notStarted.push({ show, episode: nextEpisode, watched: false });
        continue;
      }

      const lastAired = aired.reduce<TVMazeEpisode | null>((latest, e) => {
        if (!latest) return e;
        return new Date(e.airstamp).getTime() > new Date(latest.airstamp).getTime() ? e : latest;
      }, null);
      const isLastEpisode = lastAired?.id === nextEpisode.id;
      const isNew = isLastEpisode && diffDaysFromToday(nextEpisode.airdate) >= -6;

      const extraEpisodes = aired.filter((e) => !watchedIds.has(e.id)).length - 1;

      const lastWatchedAt = watchedList.reduce<number>((max, w) => {
        const t = new Date(w.watched_at).getTime();
        return t > max ? t : max;
      }, 0);

      started.push({
        show,
        episode: nextEpisode,
        watched: false,
        watchedAt: lastWatchedAt ? new Date(lastWatchedAt).toISOString() : undefined,
        isNew,
        extraEpisodes: extraEpisodes > 0 ? extraEpisodes : undefined,
      });
    }

    started.sort((a, b) => {
      if (!!a.isNew !== !!b.isNew) return a.isNew ? -1 : 1;
      const aTime = a.watchedAt ? new Date(a.watchedAt).getTime() : 0;
      const bTime = b.watchedAt ? new Date(b.watchedAt).getTime() : 0;
      return bTime - aTime;
    });

    return { watchNext: started, haventStarted: notStarted };
  }, [tracked]);

  const upcoming = useMemo<EnrichedEpisode[]>(() => {
    const result: EnrichedEpisode[] = [];
    for (const { show, episodes, watchedIds, watchedList } of tracked) {
      const timesByEpisode = new Map(watchedList.map((w) => [w.tvmaze_episode_id, w.times_watched]));
      for (const ep of episodes) {
        // Rendering every past episode a long-running show ever aired (hundreds
        // of rows) is unnecessary noise — cap how far back we go, same spirit
        // as Watch List's capped WATCHED HISTORY.
        if (diffDaysFromToday(ep.airdate) < -90) continue;
        result.push({
          show,
          episode: ep,
          watched: watchedIds.has(ep.id),
          timesWatched: timesByEpisode.get(ep.id),
        });
      }
    }
    result.sort(
      (a, b) =>
        new Date(a.episode.airstamp).getTime() -
        new Date(b.episode.airstamp).getTime(),
    );
    return result;
  }, [tracked]);

  async function toggleWatched(item: EnrichedEpisode) {
    const currentlyWatched = tracked
      .find((t) => t.show.tvmaze_id === item.show.tvmaze_id)
      ?.watchedIds.has(item.episode.id);

    const result = await setEpisodeWatched({
      tvmaze_show_id: item.show.tvmaze_id,
      tvmaze_episode_id: item.episode.id,
      season: item.episode.season,
      number: item.episode.number,
      watched: !currentlyWatched,
    });

    setTracked((prev) =>
      prev.map((t) => {
        if (t.show.tvmaze_id !== item.show.tvmaze_id) return t;
        const nextIds = new Set(t.watchedIds);
        let nextList = t.watchedList;
        if (currentlyWatched) {
          nextIds.delete(item.episode.id);
          nextList = nextList.filter(
            (w) => w.tvmaze_episode_id !== item.episode.id,
          );
        } else {
          nextIds.add(item.episode.id);
          if (result) nextList = [...nextList, result];
        }
        return { ...t, watchedIds: nextIds, watchedList: nextList };
      }),
    );
  }

  async function rewatchEpisode(item: EnrichedEpisode) {
    const show = tracked.find((t) => t.show.tvmaze_id === item.show.tvmaze_id);
    const entry = show?.watchedList.find((w) => w.tvmaze_episode_id === item.episode.id);
    if (!entry) return;
    const result = await incrementRewatch(item.episode.id, entry.times_watched);
    setTracked((prev) =>
      prev.map((t) =>
        t.show.tvmaze_id !== item.show.tvmaze_id
          ? t
          : {
              ...t,
              watchedList: t.watchedList.map((w) =>
                w.tvmaze_episode_id === item.episode.id ? result : w
              ),
            }
      )
    );
  }

  // Keyed by the actual calendar date (or LATER/EARLIER) so dates that share
  // a display label across different years never collapse into one group.
  const { upcomingFlatData, todayHeaderIndex, upcomingOffsets } =
    useMemo(() => {
      const groupedUpcomingMap = upcoming.reduce<
        Record<string, EnrichedEpisode[]>
      >((acc, item) => {
        const key = upcomingGroupKey(item.episode.airdate);
        acc[key] = acc[key] ?? [];
        acc[key].push(item);
        return acc;
      }, {});

      // Always keep a TODAY entry, even empty, so it's a stable, guaranteed anchor.
      const todayKey = todayISODate();
      if (!groupedUpcomingMap[todayKey]) {
        groupedUpcomingMap[todayKey] = [];
      }

      const offsetByKey: Record<string, number> = { [todayKey]: 0 };
      for (const [key, items] of Object.entries(groupedUpcomingMap)) {
        for (const item of items) {
          const offset = diffDaysFromToday(item.episode.airdate);
          if (
            offsetByKey[key] === undefined ||
            Math.abs(offset) < Math.abs(offsetByKey[key])
          ) {
            offsetByKey[key] = offset;
          }
        }
      }

      const sortedEntries = Object.entries(groupedUpcomingMap).sort(
        (a, b) => offsetByKey[a[0]] - offsetByKey[b[0]],
      );

      const flatData: UpcomingRow[] = [];
      let todayIndex = 0;
      sortedEntries.forEach(([key, items], groupIndex) => {
        if (key === todayKey) todayIndex = flatData.length;
        flatData.push({
          type: "header",
          key,
          label: upcomingGroupLabel(key, items[0]?.episode.airdate ?? key),
          showGrid: groupIndex === 0,
        });
        if (items.length === 0) {
          flatData.push({ type: "empty" });
        }
        for (const item of items) {
          flatData.push({ type: "episode", item });
        }
      });

      const offsets: number[] = [];
      let acc = 0;
      for (const row of flatData) {
        offsets.push(acc);
        acc += upcomingRowHeight(row);
      }

      return {
        upcomingFlatData: flatData,
        todayHeaderIndex: todayIndex,
        upcomingOffsets: offsets,
      };
    }, [upcoming]);

  function renderUpcomingRow({ item: row }: { item: UpcomingRow }) {
    if (row.type === "header") {
      return (
        <View style={styles.groupHeaderRow}>
          <View style={styles.groupHeaderSpacer} />
          <View style={styles.groupPill}>
            <Text style={styles.groupPillText}>{row.label}</Text>
          </View>
          {row.showGrid ? (
            <Pressable style={styles.gridBtn}>
              <Ionicons name="grid-outline" size={18} color={colors.text} />
            </Pressable>
          ) : (
            <View style={styles.groupHeaderSpacer} />
          )}
        </View>
      );
    }
    if (row.type === "empty") {
      return <Text style={styles.empty}>Rien de prévu aujourd'hui.</Text>;
    }
    const item = row.item;
    const isFuture = new Date(item.episode.airstamp).getTime() > Date.now();
    const daysOut = diffDaysFromToday(item.episode.airdate);
    const isFarFuture = isFuture && daysOut >= 7;
    return (
      <View style={styles.upcomingRowWrap}>
        <EpisodeRow
          showId={item.show.tvmaze_id}
          showName={item.show.show_name}
          showImage={item.show.show_image}
          episodeId={item.episode.id}
          season={item.episode.season}
          number={item.episode.number}
          title={item.episode.name}
          watched={item.watched}
          isNew={isFuture && !isFarFuture}
          isPremiere={item.episode.number === 1}
          hasAired={!isFuture}
          time={
            isFuture && !isFarFuture
              ? formatTime(item.episode.airstamp)
              : undefined
          }
          daysAway={isFarFuture ? daysOut : undefined}
          timesWatched={item.timesWatched}
          onToggleWatched={() => toggleWatched(item)}
          onRewatch={() => rewatchEpisode(item)}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabsRow}>
        <Pressable style={styles.tabBtn} onPress={goToWatchList}>
          <Text
            style={[
              styles.tabText,
              tab === "WATCH LIST" && styles.tabTextActive,
            ]}
          >
            WATCH LIST
          </Text>
          {tab === "WATCH LIST" && <View style={styles.tabUnderline} />}
        </Pressable>
        <Pressable style={styles.tabBtn} onPress={goToUpcoming}>
          <Text
            style={[styles.tabText, tab === "UPCOMING" && styles.tabTextActive]}
          >
            UPCOMING
          </Text>
          {tab === "UPCOMING" && <View style={styles.tabUnderline} />}
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
      ) : tab === "WATCH LIST" ? (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {watchedHistory.length > 0 && (
            <>
              <View style={styles.groupHeaderRow}>
                <View style={styles.groupHeaderSpacer} />
                <View style={styles.groupPill}>
                  <Text style={styles.groupPillText}>WATCHED HISTORY</Text>
                </View>
                <Pressable style={styles.gridBtn}>
                  <Ionicons name="grid-outline" size={18} color={colors.text} />
                </Pressable>
              </View>
              {watchedHistory.map((item) => (
                <EpisodeRow
                  key={`history-${item.episode.id}`}
                  showId={item.show.tvmaze_id}
                  showName={item.show.show_name}
                  showImage={item.show.show_image}
                  episodeId={item.episode.id}
                  season={item.episode.season}
                  number={item.episode.number}
                  title={item.episode.name}
                  watched={item.watched}
                  timesWatched={item.timesWatched}
                  dimmed
                  onToggleWatched={() => toggleWatched(item)}
                  onRewatch={() => rewatchEpisode(item)}
                />
              ))}
            </>
          )}

          <View
            style={styles.groupHeaderRow}
            onLayout={(e) => {
              watchNextY.current = e.nativeEvent.layout.y;
            }}
          >
            <View style={styles.groupHeaderSpacer} />
            <View style={styles.groupPill}>
              <Text style={styles.groupPillText}>WATCH NEXT</Text>
            </View>
            {watchedHistory.length === 0 ? (
              <Pressable style={styles.gridBtn}>
                <Ionicons name="grid-outline" size={18} color={colors.text} />
              </Pressable>
            ) : (
              <View style={styles.groupHeaderSpacer} />
            )}
          </View>
          {watchNext.length === 0 ? (
            <Text style={styles.empty}>
              Ajoute des séries à suivre pour les voir ici.
            </Text>
          ) : (
            watchNext.map((item) => (
              <EpisodeRow
                key={item.episode.id}
                showId={item.show.tvmaze_id}
                showName={item.show.show_name}
                showImage={item.show.show_image}
                episodeId={item.episode.id}
                season={item.episode.season}
                number={item.episode.number}
                title={item.episode.name}
                watched={item.watched}
                isNew={item.isNew}
                extraEpisodes={item.extraEpisodes}
                onToggleWatched={() => toggleWatched(item)}
              />
            ))
          )}

          {haventStarted.length > 0 && (
            <>
              <View style={styles.groupHeaderRow}>
                <View style={styles.groupHeaderSpacer} />
                <View style={styles.groupPill}>
                  <Text style={styles.groupPillText}>HAVEN'T STARTED</Text>
                </View>
                <View style={styles.groupHeaderSpacer} />
              </View>
              {haventStarted.map((item) => (
                <EpisodeRow
                  key={`unstarted-${item.episode.id}`}
                  showId={item.show.tvmaze_id}
                  showName={item.show.show_name}
                  showImage={item.show.show_image}
                  episodeId={item.episode.id}
                  season={item.episode.season}
                  number={item.episode.number}
                  title={item.episode.name}
                  watched={item.watched}
                  onToggleWatched={() => toggleWatched(item)}
                />
              ))}
            </>
          )}
        </ScrollView>
      ) : (
        <FlatList
          ref={upcomingListRef}
          data={upcomingFlatData}
          keyExtractor={(row, i) =>
            row.type === "header"
              ? `h-${row.key}`
              : row.type === "empty"
                ? `e-${i}`
                : `ep-${row.item.episode.id}`
          }
          renderItem={renderUpcomingRow}
          getItemLayout={(_data, index) => ({
            length: upcomingRowHeight(upcomingFlatData[index]),
            offset: upcomingOffsets[index],
            index,
          })}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          onScrollToIndexFailed={({ index }) => {
            upcomingListRef.current?.scrollToOffset({
              offset: upcomingOffsets[index] ?? 0,
              animated: false,
            });
          }}
          ListEmptyComponent={
            <Text style={styles.empty}>Rien de prévu prochainement.</Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  tabsRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 14 },
  tabText: {
    fontWeight: "800",
    fontSize: 13,
    color: colors.textFaint,
    letterSpacing: 0.4,
  },
  tabTextActive: { color: colors.black },
  tabUnderline: {
    height: 2,
    backgroundColor: colors.black,
    width: "60%",
    marginTop: 8,
  },
  content: { padding: 16 },
  groupHeaderRow: {
    height: HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  groupHeaderSpacer: { width: 30 },
  groupPill: {
    backgroundColor: colors.pillBg,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  groupPillText: {
    fontWeight: "800",
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  gridBtn: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    color: colors.textMuted,
    textAlign: "center",
    height: EMPTY_ROW_HEIGHT,
  },
  upcomingRowWrap: { height: EPISODE_ROW_HEIGHT, overflow: "hidden" },
});
