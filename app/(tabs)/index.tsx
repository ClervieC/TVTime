import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  Animated,
  StyleSheet,
  ActivityIndicator,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getShowEpisodes, TVMazeEpisode } from "../../lib/tvmaze";
import {
  fetchUserShows,
  fetchWatchedEpisodes,
  fetchWatchedEpisodesPage,
  incrementRewatch,
  setEpisodeWatched,
  UserShow,
  WatchedEpisode,
} from "../../lib/userShows";
import { getCachedEpisodes, getCachedWatchedEpisodes } from "../../lib/showDataCache";
import {
  diffDaysFromToday,
  formatTime,
  todayISODate,
  upcomingGroupKey,
  upcomingGroupLabel,
} from "../../lib/dates";
import { EpisodeRow } from "../../components/EpisodeRow";
import { useColors, radius, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";
import { useGrowIn, useFadeIn } from "../../lib/animations";

type ViewTab = "list" | "upcoming";

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
  | { type: "header"; key: string; label: string }
  | { type: "empty" }
  | { type: "episode"; item: EnrichedEpisode }
  // Multiple episodes of the same show airing the same day collapse into one
  // expandable row instead of a wall of near-identical cards.
  | { type: "group"; key: string; items: EnrichedEpisode[] }
  | { type: "groupChild"; item: EnrichedEpisode };

type WatchListRow =
  | { type: "historyHeader" }
  | { type: "historyItem"; item: EnrichedEpisode }
  | { type: "watchNextHeader" }
  | { type: "watchNextEmpty" }
  | { type: "watchNextItem"; item: EnrichedEpisode }
  | { type: "notStartedHeader" }
  | { type: "notStartedItem"; item: EnrichedEpisode };

const HISTORY_PAGE_SIZE = 20;
// Scrolling within this many pixels of the top triggers loading the next
// (older) page of history — the natural "pull up for more" gesture instead
// of a tap button, without ever holding the full history in memory at once.
const HISTORY_LOAD_THRESHOLD = 40;

// Upcoming only preloads a week of past episodes; scrolling further up
// reveals more, the same "lazy load on swipe up" gesture as Watch List's
// history. Unlike Watch List, the underlying data is already in memory (each
// tracked show's full episode list is fetched once) — "loading more" here is
// just widening the date window we render, not another network request.
const UPCOMING_INITIAL_PAST_DAYS = 7;
const UPCOMING_MAX_PAST_DAYS = 90;
const UPCOMING_PAST_STEP_DAYS = 30;
const UPCOMING_LOAD_THRESHOLD = 40;

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

function watchListRowHeight(row: WatchListRow) {
  if (row.type === "historyHeader" || row.type === "watchNextHeader" || row.type === "notStartedHeader") {
    return HEADER_HEIGHT;
  }
  if (row.type === "watchNextEmpty") return EMPTY_ROW_HEIGHT;
  return EPISODE_ROW_HEIGHT;
}

export default function ShowsScreen() {
  const [tab, setTab] = useState<ViewTab>("list");
  const [loading, setLoading] = useState(true);
  // Bumped on every loadData() to force both FlatLists to remount: combined
  // with initialScrollIndex/a plain offset-0 default, the list is already
  // positioned correctly on its very first layout, instead of rendering at
  // its old scroll position and being corrected (visibly) afterwards.
  const [loadGeneration, setLoadGeneration] = useState(0);
  const [tracked, setTracked] = useState<TrackedShow[]>([]);
  const [historyItems, setHistoryItems] = useState<EnrichedEpisode[]>([]);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [upcomingPastDays, setUpcomingPastDays] = useState(UPCOMING_INITIAL_PAST_DAYS);
  const listRef = useRef<FlatList<WatchListRow>>(null);
  const upcomingListRef = useRef<FlatList<UpcomingRow>>(null);
  const hasLoadedOnce = useRef(false);
  const watchListScrollY = useRef(0);
  const upcomingScrollY = useRef(0);
  const pendingPastLoad = useRef<number | null>(null);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t, language } = useLanguage();
  const underlineGrow = useGrowIn(tab);
  const contentFade = useFadeIn(!loading);

  // Episode/show lookup built from the already-loaded tracked shows, used to
  // hydrate the lazily paginated history rows without extra network calls.
  const episodeIndex = useMemo(() => {
    const map = new Map<number, { show: UserShow; episode: TVMazeEpisode }>();
    for (const { show, episodes } of tracked) {
      for (const episode of episodes) {
        map.set(episode.id, { show, episode });
      }
    }
    return map;
  }, [tracked]);

  // Cached per show (see lib/showDataCache): repeat visits within the TTL
  // skip the network entirely instead of re-fetching every followed show's
  // episodes/watched rows on every focus.
  async function fetchTrackedShow(show: UserShow): Promise<TrackedShow> {
    try {
      const episodes = await getCachedEpisodes(show.tvmaze_id, () => getShowEpisodes(show.tvmaze_id));
      const watchedList = await getCachedWatchedEpisodes(show.tvmaze_id, () => fetchWatchedEpisodes(show.tvmaze_id));
      return {
        show,
        episodes,
        watchedIds: new Set(watchedList.map((w) => w.tvmaze_episode_id)),
        watchedList,
      };
    } catch {
      return { show, episodes: [], watchedIds: new Set(), watchedList: [] };
    }
  }

  const loadData = useCallback(async () => {
    if (!hasLoadedOnce.current) {
      setLoading(true);
    }

    const shows = await fetchUserShows();
    const followed = shows.filter(
      (s) => s.status === "watching" || s.status === "want_to_watch",
    );

    const results = await Promise.all(followed.map(fetchTrackedShow));

    setTracked(results);
    setLoading(false);
    hasLoadedOnce.current = true;
    // Watched history is intentionally not loaded here — it's fetched lazily,
    // a page at a time, only once the user scrolls up toward it.
    setHistoryItems([]);
    setHistoryOffset(0);
    setHasMoreHistory(true);
    setUpcomingPastDays(UPCOMING_INITIAL_PAST_DAYS);
    setLoadGeneration((g) => g + 1);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (active) loadData();
      return () => {
        active = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadData, tab]),
  );

  function goToWatchList() {
    setTab("list");
    loadData();
  }

  function goToUpcoming() {
    setTab("upcoming");
    loadData();
  }

  async function loadMoreHistory() {
    if (loadingHistory || !hasMoreHistory) return;
    setLoadingHistory(true);
    try {
      const page = await fetchWatchedEpisodesPage(historyOffset, HISTORY_PAGE_SIZE);
      if (page.length < HISTORY_PAGE_SIZE) setHasMoreHistory(false);

      const enriched: EnrichedEpisode[] = [];
      for (const w of page) {
        const hit = episodeIndex.get(w.tvmaze_episode_id);
        if (!hit) continue;
        enriched.push({
          show: hit.show,
          episode: hit.episode,
          watched: true,
          watchedAt: w.watched_at,
          timesWatched: w.times_watched,
        });
      }
      enriched.reverse(); // oldest-of-this-page first, so it reads top-to-bottom chronologically

      // Prepending content above the current viewport would otherwise shove
      // everything down and visually "jump" the user to the top of what just
      // loaded. Compensate by scrolling down by exactly the height we added,
      // so the view stays put and the newly loaded page sits above, ready to
      // be revealed by scrolling up again — i.e. it "starts from the bottom".
      const addedHeaderHeight = historyItems.length === 0 ? HEADER_HEIGHT : 0;
      const addedHeight = addedHeaderHeight + enriched.length * EPISODE_ROW_HEIGHT;

      setHistoryItems((prev) => [...enriched, ...prev]);
      setHistoryOffset((prev) => prev + page.length);

      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({
          offset: watchListScrollY.current + addedHeight,
          animated: false,
        });
      });
    } finally {
      setLoadingHistory(false);
    }
  }

  function onWatchListScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    watchListScrollY.current = e.nativeEvent.contentOffset.y;
    if (e.nativeEvent.contentOffset.y <= HISTORY_LOAD_THRESHOLD) {
      loadMoreHistory();
    }
  }

  function loadMorePastUpcoming() {
    if (upcomingPastDays >= UPCOMING_MAX_PAST_DAYS) return;
    // Record today's current pixel offset before the window widens — once
    // more past rows are prepended, today's row shifts down by however much
    // content was just added, and we scroll by exactly that much to keep the
    // viewport visually anchored (same trick as loadMoreHistory above).
    pendingPastLoad.current = upcomingOffsets[todayHeaderIndex] ?? 0;
    setUpcomingPastDays((d) => Math.min(d + UPCOMING_PAST_STEP_DAYS, UPCOMING_MAX_PAST_DAYS));
  }

  function onUpcomingScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    upcomingScrollY.current = e.nativeEvent.contentOffset.y;
    if (e.nativeEvent.contentOffset.y <= UPCOMING_LOAD_THRESHOLD) {
      loadMorePastUpcoming();
    }
  }

  useEffect(() => {
    if (pendingPastLoad.current === null) return;
    const prevOffset = pendingPastLoad.current;
    pendingPastLoad.current = null;
    const newOffset = upcomingOffsets[todayHeaderIndex] ?? 0;
    const delta = newOffset - prevOffset;
    if (delta > 0) {
      requestAnimationFrame(() => {
        upcomingListRef.current?.scrollToOffset({
          offset: upcomingScrollY.current + delta,
          animated: false,
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcomingPastDays]);

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
        // of rows) is unnecessary noise — only the current past window is
        // shown, widened lazily as the user scrolls up (see loadMorePastUpcoming).
        if (diffDaysFromToday(ep.airdate) < -upcomingPastDays) continue;
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
  }, [tracked, upcomingPastDays]);

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
    setHistoryItems((prev) =>
      prev.map((h) => (h.episode.id === item.episode.id ? { ...h, timesWatched: result.times_watched } : h))
    );
  }

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const { watchListData, watchListOffsets } = useMemo(() => {
    const rows: WatchListRow[] = [];
    if (historyItems.length > 0) {
      rows.push({ type: "historyHeader" });
      for (const item of historyItems) rows.push({ type: "historyItem", item });
    }
    rows.push({ type: "watchNextHeader" });
    if (watchNext.length === 0) {
      rows.push({ type: "watchNextEmpty" });
    } else {
      for (const item of watchNext) rows.push({ type: "watchNextItem", item });
    }
    if (haventStarted.length > 0) {
      rows.push({ type: "notStartedHeader" });
      for (const item of haventStarted) rows.push({ type: "notStartedItem", item });
    }

    const offsets: number[] = [];
    let acc = 0;
    for (const row of rows) {
      offsets.push(acc);
      acc += watchListRowHeight(row);
    }

    return { watchListData: rows, watchListOffsets: offsets };
  }, [historyItems, watchNext, haventStarted]);

  function watchListKey(row: WatchListRow, index: number) {
    switch (row.type) {
      case "historyHeader":
        return "history-header";
      case "historyItem":
        return `history-${row.item.episode.id}`;
      case "watchNextHeader":
        return "watchnext-header";
      case "watchNextEmpty":
        return "watchnext-empty";
      case "watchNextItem":
        return `watchnext-${row.item.episode.id}`;
      case "notStartedHeader":
        return "notstarted-header";
      case "notStartedItem":
        return `notstarted-${row.item.episode.id}-${index}`;
    }
  }

  function renderWatchListRow({ item: row }: { item: WatchListRow }) {
    switch (row.type) {
      case "historyHeader":
        return (
          <View style={styles.groupHeaderRow}>
            <View style={styles.groupPill}>
              <Text style={styles.groupPillText}>{t.shows.history}</Text>
            </View>
          </View>
        );
      case "historyItem":
        return (
          <View style={styles.watchListRowWrap}>
            <EpisodeRow
              showId={row.item.show.tvmaze_id}
              showName={row.item.show.show_name}
              showImage={row.item.show.show_image}
              episodeId={row.item.episode.id}
              season={row.item.episode.season}
              number={row.item.episode.number}
              title={row.item.episode.name}
              watched={row.item.watched}
              timesWatched={row.item.timesWatched}
              dimmed
              onToggleWatched={() => toggleWatched(row.item)}
              onRewatch={() => rewatchEpisode(row.item)}
            />
          </View>
        );
      case "watchNextHeader":
        return (
          <View style={styles.groupHeaderRow}>
            <View style={styles.groupPill}>
              <Text style={styles.groupPillText}>{t.shows.watchNext}</Text>
            </View>
          </View>
        );
      case "watchNextEmpty":
        return <Text style={styles.empty}>{t.shows.emptyWatchList}</Text>;
      case "watchNextItem":
        return (
          <View style={styles.watchListRowWrap}>
            <EpisodeRow
              showId={row.item.show.tvmaze_id}
              showName={row.item.show.show_name}
              showImage={row.item.show.show_image}
              episodeId={row.item.episode.id}
              season={row.item.episode.season}
              number={row.item.episode.number}
              title={row.item.episode.name}
              watched={row.item.watched}
              isNew={row.item.isNew}
              extraEpisodes={row.item.extraEpisodes}
              onToggleWatched={() => toggleWatched(row.item)}
            />
          </View>
        );
      case "notStartedHeader":
        return (
          <View style={styles.groupHeaderRow}>
            <View style={styles.groupPill}>
              <Text style={styles.groupPillText}>{t.shows.notStarted}</Text>
            </View>
          </View>
        );
      case "notStartedItem":
        return (
          <View style={styles.watchListRowWrap}>
            <EpisodeRow
              showId={row.item.show.tvmaze_id}
              showName={row.item.show.show_name}
              showImage={row.item.show.show_image}
              episodeId={row.item.episode.id}
              season={row.item.episode.season}
              number={row.item.episode.number}
              title={row.item.episode.name}
              watched={row.item.watched}
              onToggleWatched={() => toggleWatched(row.item)}
            />
          </View>
        );
    }
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
      sortedEntries.forEach(([dayKey, items]) => {
        if (dayKey === todayKey) todayIndex = flatData.length;
        flatData.push({
          type: "header",
          key: dayKey,
          label: upcomingGroupLabel(dayKey, items[0]?.episode.airdate ?? dayKey, language),
        });
        if (items.length === 0) {
          flatData.push({ type: "empty" });
        }

        // Group episodes airing on the exact same calendar day for the same
        // show. Buckets like LATER/EARLIER lump several distinct real dates
        // under one label, so grouping must key off the actual airdate, not
        // just the (coarser) day-group key, or unrelated dates would merge.
        const byShowAndDate = new Map<string, EnrichedEpisode[]>();
        for (const item of items) {
          const subKey = `${item.episode.airdate}__${item.show.tvmaze_id}`;
          const arr = byShowAndDate.get(subKey) ?? [];
          arr.push(item);
          byShowAndDate.set(subKey, arr);
        }
        const emitted = new Set<string>();
        for (const item of items) {
          const subKey = `${item.episode.airdate}__${item.show.tvmaze_id}`;
          if (emitted.has(subKey)) continue;
          emitted.add(subKey);
          const group = byShowAndDate.get(subKey)!;
          if (group.length > 1) {
            const groupKey = `${dayKey}__${subKey}`;
            flatData.push({ type: "group", key: groupKey, items: group });
            if (expandedGroups.has(groupKey)) {
              for (const child of group.slice(1)) {
                flatData.push({ type: "groupChild", item: child });
              }
            }
          } else {
            flatData.push({ type: "episode", item });
          }
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
    }, [upcoming, language, expandedGroups]);

  function renderUpcomingRow({ item: row }: { item: UpcomingRow }) {
    if (row.type === "header") {
      return (
        <View style={styles.dateHeaderRow}>
          <View style={styles.dateHeaderLine} />
          <Text style={styles.dateHeaderText}>{row.label}</Text>
          <View style={styles.dateHeaderLine} />
        </View>
      );
    }
    if (row.type === "empty") {
      return (
        <View style={styles.emptyTodayCard}>
          <Ionicons name="cafe-outline" size={16} color={colors.textFaint} />
          <Text style={styles.emptyTodayText}>{t.shows.emptyToday}</Text>
        </View>
      );
    }
    if (row.type === "group") {
      const first = row.items[0];
      const isFuture = new Date(first.episode.airstamp).getTime() > Date.now();
      const daysOut = diffDaysFromToday(first.episode.airdate);
      const isFarFuture = isFuture && daysOut >= 7;
      const groupKey = row.key;
      const expanded = expandedGroups.has(groupKey);
      return (
        <View style={styles.upcomingRowWrap}>
          <EpisodeRow
            showId={first.show.tvmaze_id}
            showName={first.show.show_name}
            showImage={first.show.show_image}
            episodeId={first.episode.id}
            season={first.episode.season}
            number={first.episode.number}
            title={first.episode.name}
            watched={first.watched}
            isPremiere={first.episode.number === 1}
            hasAired={!isFuture}
            extraEpisodes={row.items.length - 1}
            timesWatched={first.timesWatched}
            daysAway={isFarFuture ? daysOut : undefined}
            expandIcon={expanded ? "up" : "down"}
            onToggleWatched={() => toggleWatched(first)}
            onPress={() => toggleGroup(groupKey)}
          />
        </View>
      );
    }
    if (row.type === "groupChild") {
      const item = row.item;
      const isFuture = new Date(item.episode.airstamp).getTime() > Date.now();
      const daysOut = diffDaysFromToday(item.episode.airdate);
      const isFarFuture = isFuture && daysOut >= 7;
      return (
        <View style={[styles.upcomingRowWrap, styles.groupChildWrap]}>
          <EpisodeRow
            showId={item.show.tvmaze_id}
            showName={item.show.show_name}
            showImage={item.show.show_image}
            episodeId={item.episode.id}
            season={item.episode.season}
            number={item.episode.number}
            title={item.episode.name}
            watched={item.watched}
            hasAired={!isFuture}
            time={isFuture && !isFarFuture ? formatTime(item.episode.airstamp) : undefined}
            daysAway={isFarFuture ? daysOut : undefined}
            timesWatched={item.timesWatched}
            onToggleWatched={() => toggleWatched(item)}
            onRewatch={() => rewatchEpisode(item)}
          />
        </View>
      );
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
              tab === "list" && styles.tabTextActive,
            ]}
          >
            {t.shows.tabList}
          </Text>
          {tab === "list" && <Animated.View style={[styles.tabUnderline, { transform: [{ scaleX: underlineGrow }] }]} />}
        </Pressable>
        <Pressable style={styles.tabBtn} onPress={goToUpcoming}>
          <Text
            style={[styles.tabText, tab === "upcoming" && styles.tabTextActive]}
          >
            {t.shows.tabUpcoming}
          </Text>
          {tab === "upcoming" && <Animated.View style={[styles.tabUnderline, { transform: [{ scaleX: underlineGrow }] }]} />}
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
      ) : tab === "list" ? (
        <Animated.View style={{ flex: 1, opacity: contentFade }}>
          <FlatList
            key={`watchlist-${loadGeneration}`}
            ref={listRef}
            data={watchListData}
            keyExtractor={watchListKey}
            renderItem={renderWatchListRow}
            getItemLayout={(_data, index) => ({
              length: watchListRowHeight(watchListData[index]),
              offset: watchListOffsets[index],
              index,
            })}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            onScroll={onWatchListScroll}
            scrollEventThrottle={32}
          />
          {loadingHistory && (
            <View style={styles.historyLoadingOverlay} pointerEvents="none">
              <ActivityIndicator color={colors.textFaint} size="small" />
            </View>
          )}
        </Animated.View>
      ) : tracked.length === 0 ? (
        <View style={styles.fullEmpty}>
          <Ionicons name="calendar-outline" size={32} color={colors.textFaint} />
          <Text style={styles.fullEmptyText}>{t.shows.emptyWatchList}</Text>
        </View>
      ) : (
        <Animated.View style={{ flex: 1, opacity: contentFade }}>
          <FlatList
            key={`upcoming-${loadGeneration}`}
            ref={upcomingListRef}
            data={upcomingFlatData}
            keyExtractor={(row, i) =>
              row.type === "header"
                ? `h-${row.key}`
                : row.type === "empty"
                  ? `e-${i}`
                  : row.type === "group"
                    ? `g-${row.key}`
                    : row.type === "groupChild"
                      ? `gc-${row.item.episode.id}`
                      : `ep-${row.item.episode.id}`
            }
            renderItem={renderUpcomingRow}
            getItemLayout={(_data, index) => ({
              length: upcomingRowHeight(upcomingFlatData[index]),
              offset: upcomingOffsets[index],
              index,
            })}
            initialScrollIndex={todayHeaderIndex}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            onScroll={onUpcomingScroll}
            scrollEventThrottle={32}
            onScrollToIndexFailed={({ index }) => {
              upcomingListRef.current?.scrollToOffset({
                offset: upcomingOffsets[index] ?? 0,
                animated: false,
              });
            }}
          />
        </Animated.View>
      )}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
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
  tabTextActive: { color: colors.accent },
  tabUnderline: {
    height: 2,
    backgroundColor: colors.accent,
    width: "60%",
    marginTop: 8,
  },
  content: { padding: 16 },
  groupHeaderRow: {
    height: HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  historyLoadingOverlay: {
    position: "absolute",
    top: 8,
    left: 0,
    right: 0,
    alignItems: "center",
  },
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
  empty: {
    color: colors.textMuted,
    textAlign: "center",
    height: EMPTY_ROW_HEIGHT,
  },
  watchListRowWrap: { height: EPISODE_ROW_HEIGHT, overflow: "hidden" },
  upcomingRowWrap: { height: EPISODE_ROW_HEIGHT, overflow: "hidden" },
  groupChildWrap: { paddingLeft: 20 },
  dateHeaderRow: {
    height: HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dateHeaderLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dateHeaderText: {
    fontWeight: "800",
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  emptyTodayCard: {
    height: EMPTY_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  emptyTodayText: { color: colors.textMuted, fontSize: 13 },
  fullEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 40 },
  fullEmptyText: { color: colors.textMuted, textAlign: "center" },
  });
}
