import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  rateEpisode,
  setEpisodeWatched,
  UserShow,
  WatchedEpisode,
} from "../../lib/userShows";
import { getCachedEpisodes, getCachedWatchedEpisodes } from "../../lib/showDataCache";
import { mapWithConcurrency } from "../../lib/concurrency";
import {
  diffDaysFromToday,
  formatTime,
  localDateKey,
  todayISODate,
  upcomingGroupKey,
  upcomingGroupLabel,
} from "../../lib/dates";
import { EpisodeRow } from "../../components/EpisodeRow";
import { FeelingSheet } from "../../components/FeelingSheet";
import { Pill } from "../../components/Pill";
import { EmptyState } from "../../components/EmptyState";
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
  // Full series episode count — only set for "Not started" rows, where
  // there's no watch progress yet to summarize instead.
  totalEpisodes?: number;
}

type EnrichedShowResult =
  | { kind: "none" }
  | { kind: "started"; item: EnrichedEpisode }
  | { kind: "notStarted"; item: EnrichedEpisode };

// Pure function of one show's tracked data — factored out of the watchNext/
// haventStarted useMemo so it can be called only for shows that actually
// changed (see enrichedCacheRef), rather than for every tracked show on
// every recompute.
function computeEnrichedForShow(t: TrackedShow, now: number): EnrichedShowResult {
  const { show, episodes, watchedIds, watchedList } = t;
  const aired = episodes.filter((e) => new Date(e.airstamp).getTime() <= now);
  const nextEpisode = [...aired]
    .sort((a, b) => a.season - b.season || a.number - b.number)
    .find((e) => !watchedIds.has(e.id));
  if (!nextEpisode) return { kind: "none" };

  // Shows with zero watch history yet are "haven't started" — kept
  // separate from Watch Next so newly-added shows don't crowd it out.
  if (watchedList.length === 0) {
    return {
      kind: "notStarted",
      item: { show, episode: nextEpisode, watched: false, totalEpisodes: episodes.length },
    };
  }

  const lastAired = aired.reduce<TVMazeEpisode | null>((latest, e) => {
    if (!latest) return e;
    return new Date(e.airstamp).getTime() > new Date(latest.airstamp).getTime() ? e : latest;
  }, null);
  const isLastEpisode = lastAired?.id === nextEpisode.id;
  const isNew = isLastEpisode && diffDaysFromToday(nextEpisode.airstamp) >= -6;
  const extraEpisodes = aired.filter((e) => !watchedIds.has(e.id)).length - 1;
  const lastWatchedAt = watchedList.reduce<number>((max, w) => {
    const time = new Date(w.watched_at).getTime();
    return time > max ? time : max;
  }, 0);

  return {
    kind: "started",
    item: {
      show,
      episode: nextEpisode,
      watched: false,
      watchedAt: lastWatchedAt ? new Date(lastWatchedAt).toISOString() : undefined,
      isNew,
      extraEpisodes: extraEpisodes > 0 ? extraEpisodes : undefined,
    },
  };
}

type ShowsStyles = ReturnType<typeof createStyles>;

interface WatchListEpisodeRowProps {
  item: EnrichedEpisode;
  dimmed?: boolean;
  onToggleWatched: (item: EnrichedEpisode) => void;
  onRewatch?: (item: EnrichedEpisode) => void;
  styles: ShowsStyles;
}

// Memoized wrapper so an unaffected row (same `item` reference — see
// enrichedCacheRef in ShowsScreen — and the same stable onToggleWatched/
// onRewatch function references) skips re-rendering entirely, rather than
// every visible EpisodeRow (with its own Swipeable/gesture handler and
// image) re-rendering whenever any one show's watched state changes.
const WatchListEpisodeRow = memo(function WatchListEpisodeRow({
  item,
  dimmed,
  onToggleWatched,
  onRewatch,
  styles,
}: WatchListEpisodeRowProps) {
  return (
    <View style={styles.watchListRowWrap}>
      <EpisodeRow
        showId={item.show.tvmaze_id}
        showName={item.show.show_name}
        showImage={item.show.show_image}
        episodeId={item.episode.id}
        season={item.episode.season}
        number={item.episode.number}
        extraEpisodes={item.extraEpisodes}
        totalEpisodes={item.totalEpisodes}
        title={item.episode.name}
        isNew={item.isNew}
        watched={item.watched}
        timesWatched={item.timesWatched}
        dimmed={dimmed}
        onToggleWatched={() => onToggleWatched(item)}
        onRewatch={onRewatch ? () => onRewatch(item) : undefined}
      />
    </View>
  );
});

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

// The TVmaze half of each show's fetch (getShowEpisodes) is paced by the
// shared rate limiter in lib/tvmaze.ts regardless of this value — raising it
// doesn't speed that half up. It only benefits the unthrottled Supabase half
// (fetchWatchedEpisodes), which is where the wins from 6 -> 10 actually come
// from.
const TRACKED_SHOW_FETCH_CONCURRENCY = 10;

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
  // Set right after marking an episode watched (never on unwatch) — opens
  // the quick feeling picker for that specific episode. Tapping outside
  // (Sheet's backdrop) or picking nothing just closes it without saving.
  const [feelingPromptItem, setFeelingPromptItem] = useState<EnrichedEpisode | null>(null);
  const listRef = useRef<FlatList<WatchListRow>>(null);
  const upcomingListRef = useRef<FlatList<UpcomingRow>>(null);
  const hasLoadedOnce = useRef(false);
  const watchListScrollY = useRef(0);
  const upcomingScrollY = useRef(0);
  const pendingPastLoad = useRef<number | null>(null);
  // React state updates aren't synchronous — two onScroll events dispatched
  // in the same batching window could both read loadingHistory as still
  // false and both fire a fetch for the same page. This ref closes that gap;
  // loadingHistory state stays too, purely to drive the spinner.
  const loadingHistoryRef = useRef(false);
  // Per-show cache for the watchNext/haventStarted memo below, keyed by
  // tvmaze_id. toggleWatched/rewatchEpisode already rebuild `tracked` with a
  // new TrackedShow object only for the one show that actually changed
  // (every other show keeps its exact previous reference) — reusing that,
  // this cache lets an unaffected show's EnrichedEpisode object stay the
  // exact same reference across a re-render instead of a brand new object
  // being constructed for every tracked show every time any one of them
  // changes. That object-identity stability is what lets WatchListEpisodeRow's
  // memo() below actually skip re-rendering rows nothing happened to.
  const enrichedCacheRef = useRef(new Map<number, { input: TrackedShow; result: EnrichedShowResult }>());
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
    // Episodes (TVmaze) and watched status (Supabase) are independent —
    // fetching them one after the other doubled the latency per show for no
    // reason. They're also independently allowed to fail: settling instead
    // of Promise.all-ing means a TVmaze hiccup doesn't throw away watched
    // status that Supabase already returned successfully, and vice versa.
    const [episodesResult, watchedResult] = await Promise.allSettled([
      getCachedEpisodes(show.tvmaze_id, () => getShowEpisodes(show.tvmaze_id)),
      getCachedWatchedEpisodes(show.tvmaze_id, () => fetchWatchedEpisodes(show.tvmaze_id)),
    ]);
    const episodes = episodesResult.status === "fulfilled" ? episodesResult.value : [];
    const watchedList = watchedResult.status === "fulfilled" ? watchedResult.value : [];
    return {
      show,
      episodes,
      watchedIds: new Set(watchedList.map((w) => w.tvmaze_episode_id)),
      watchedList,
    };
  }

  const loadData = useCallback(async () => {
    if (!hasLoadedOnce.current) {
      setLoading(true);
    }

    // Reset upfront (rather than after every show has loaded below) so the
    // list is coherent as soon as the very first batch of tracked-show data
    // arrives, instead of mixing fresh data with the previous load's stale
    // history/upcoming state until the whole batch finishes.
    // Watched history is intentionally not loaded here — it's fetched lazily,
    // a page at a time, only once the user scrolls up toward it.
    setHistoryItems([]);
    setHistoryOffset(0);
    setHasMoreHistory(true);
    setUpcomingPastDays(UPCOMING_INITIAL_PAST_DAYS);
    setLoadGeneration((g) => g + 1);
    // The FlatLists below remount at offset 0 on every load (see loadGeneration
    // in their key), but these refs weren't reset with them — leaving a stale
    // scroll position from before the refresh made onWatchListScroll think it
    // was scrolling toward the top on the very next scroll event, spuriously
    // re-triggering the history/past-upcoming load.
    watchListScrollY.current = 0;
    upcomingScrollY.current = 0;

    const shows = await fetchUserShows();
    // Shows already being watched go first in the fetch queue — that's what
    // populates Watch Next and History, the two sections actually visible on
    // load. Shows not started yet only feed "Not started", which the user is
    // less likely to be checking first, so they can trail in behind.
    const watching = shows.filter((s) => s.status === "watching");
    const wantToWatch = shows.filter((s) => s.status === "want_to_watch");
    const followed = [...watching, ...wantToWatch];

    // Render shows as their data arrives instead of blocking on the very
    // last one to resolve — with a couple hundred tracked shows, the TVmaze
    // rate limit alone can take minutes to clear on a cold cache, and there
    // was no reason to hold the whole screen on a spinner while most shows
    // were already done. Flushes are coalesced to one per animation frame
    // rather than one per show, so this doesn't turn into 200+ re-renders.
    const collected: TrackedShow[] = [];
    let flushScheduled = false;
    function flush() {
      flushScheduled = false;
      setTracked([...collected]);
      setLoading(false);
      hasLoadedOnce.current = true;
    }
    function scheduleFlush() {
      if (flushScheduled) return;
      flushScheduled = true;
      requestAnimationFrame(flush);
    }

    await mapWithConcurrency(followed, TRACKED_SHOW_FETCH_CONCURRENCY, fetchTrackedShow, (result) => {
      collected.push(result);
      scheduleFlush();
    });
    // Final flush covers both the trailing rAF-coalesced items and the
    // followed.length === 0 case, where onItemDone never fires at all.
    flush();
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
    if (loadingHistoryRef.current || !hasMoreHistory) return;
    loadingHistoryRef.current = true;
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
      loadingHistoryRef.current = false;
      setLoadingHistory(false);
    }
  }

  function onWatchListScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const previousY = watchListScrollY.current;
    const newY = contentOffset.y;
    watchListScrollY.current = newY;

    // Only a genuinely scrollable list can meaningfully be "near the top" —
    // otherwise (e.g. just a couple of shows, nothing to scroll) the offset
    // sits at 0 permanently and any touch/bounce would spuriously trigger
    // a history load and jump the page around.
    const isScrollable = contentSize.height > layoutMeasurement.height + HISTORY_LOAD_THRESHOLD;
    // Direction matters, not just position: starting a scroll from the very
    // top and swiping down the page (offset climbing away from 0) passes
    // through this same threshold zone as actually pulling up toward the
    // top for older history — only the latter (offset decreasing) means it.
    const isMovingTowardTop = newY <= previousY;
    if (isScrollable && isMovingTowardTop && newY <= HISTORY_LOAD_THRESHOLD) {
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
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const previousY = upcomingScrollY.current;
    const newY = contentOffset.y;
    upcomingScrollY.current = newY;

    const isScrollable = contentSize.height > layoutMeasurement.height + UPCOMING_LOAD_THRESHOLD;
    const isMovingTowardTop = newY <= previousY;
    if (isScrollable && isMovingTowardTop && newY <= UPCOMING_LOAD_THRESHOLD) {
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
    const cache = enrichedCacheRef.current;
    const nextCache = new Map<number, { input: TrackedShow; result: EnrichedShowResult }>();

    for (const t of tracked) {
      const showId = t.show.tvmaze_id;
      const cached = cache.get(showId);
      // Reusing the cached result (same EnrichedEpisode object reference) when
      // this show's TrackedShow itself is unchanged is what lets unaffected
      // rows keep stable identity across a re-render — toggleWatched/
      // rewatchEpisode below only ever build a new TrackedShow for the one
      // show that actually changed, every other show keeps its old reference.
      const result = cached && cached.input === t ? cached.result : computeEnrichedForShow(t, now);
      nextCache.set(showId, { input: t, result });
      if (result.kind === "started") started.push(result.item);
      else if (result.kind === "notStarted") notStarted.push(result.item);
    }
    enrichedCacheRef.current = nextCache;

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
        if (diffDaysFromToday(ep.airstamp) < -upcomingPastDays) continue;
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

  // Stable (empty deps) so that WatchListEpisodeRow's memo() below can
  // actually bail out for unaffected rows — reads item.watched/
  // item.timesWatched (an accurate snapshot as of the row's own render,
  // exactly like the previous tracked.find() lookup was) instead of closing
  // over `tracked`, which would otherwise change this function's identity
  // on every single toggle.
  const toggleWatched = useCallback(async (item: EnrichedEpisode) => {
    const currentlyWatched = item.watched;

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

    // Only on the unwatched -> watched transition, never on unwatch or on a
    // rewatch (which goes through the WatchedCheck rewatch prompt instead).
    if (!currentlyWatched) setFeelingPromptItem(item);
  }, []);

  const handleQuickFeeling = useCallback(
    async (feelingKey: string) => {
      const item = feelingPromptItem;
      setFeelingPromptItem(null);
      if (!item) return;
      await rateEpisode(item.show.tvmaze_id, item.episode.id, null, feelingKey);
      setTracked((prev) =>
        prev.map((t) =>
          t.show.tvmaze_id !== item.show.tvmaze_id
            ? t
            : {
                ...t,
                watchedList: t.watchedList.map((w) =>
                  w.tvmaze_episode_id === item.episode.id ? { ...w, feeling: feelingKey } : w
                ),
              }
        )
      );
    },
    [feelingPromptItem]
  );

  const rewatchEpisode = useCallback(async (item: EnrichedEpisode) => {
    if (item.timesWatched === undefined) return;
    const result = await incrementRewatch(item.episode.id, item.timesWatched);
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
  }, []);

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

  const renderWatchListRow = useCallback(
    ({ item: row }: { item: WatchListRow }) => {
      switch (row.type) {
        case "historyHeader":
          return (
            <View style={styles.groupHeaderRow}>
              <Pill uppercase>{t.shows.history}</Pill>
            </View>
          );
        case "historyItem":
          return (
            <WatchListEpisodeRow
              item={row.item}
              dimmed
              onToggleWatched={toggleWatched}
              onRewatch={rewatchEpisode}
              styles={styles}
            />
          );
        case "watchNextHeader":
          return (
            <View style={styles.groupHeaderRow}>
              <Pill uppercase>{t.shows.watchNext}</Pill>
            </View>
          );
        case "watchNextEmpty":
          return <Text style={styles.empty}>{t.shows.emptyWatchList}</Text>;
        case "watchNextItem":
          return <WatchListEpisodeRow item={row.item} onToggleWatched={toggleWatched} styles={styles} />;
        case "notStartedHeader":
          return (
            <View style={styles.groupHeaderRow}>
              <Pill uppercase>{t.shows.notStarted}</Pill>
            </View>
          );
        case "notStartedItem":
          return <WatchListEpisodeRow item={row.item} onToggleWatched={toggleWatched} styles={styles} />;
      }
    },
    [styles, t, toggleWatched, rewatchEpisode],
  );

  // Keyed by the actual calendar date (or LATER/EARLIER) so dates that share
  // a display label across different years never collapse into one group.
  const { upcomingFlatData, todayHeaderIndex, upcomingOffsets } =
    useMemo(() => {
      const groupedUpcomingMap = upcoming.reduce<
        Record<string, EnrichedEpisode[]>
      >((acc, item) => {
        const key = upcomingGroupKey(item.episode.airstamp);
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
          const offset = diffDaysFromToday(item.episode.airstamp);
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
          label: upcomingGroupLabel(dayKey, items[0]?.episode.airstamp ?? dayKey, language),
        });
        if (items.length === 0) {
          flatData.push({ type: "empty" });
        }

        // Group episodes airing on the exact same calendar day for the same
        // show. Buckets like LATER/EARLIER lump several distinct real dates
        // under one label, so grouping must key off the actual local date
        // (not just the coarser day-group key, or unrelated dates would
        // merge — and not the raw airdate, which is in the show's broadcast
        // timezone rather than the viewer's local one).
        const byShowAndDate = new Map<string, EnrichedEpisode[]>();
        for (const item of items) {
          const subKey = `${localDateKey(item.episode.airstamp)}__${item.show.tvmaze_id}`;
          const arr = byShowAndDate.get(subKey) ?? [];
          arr.push(item);
          byShowAndDate.set(subKey, arr);
        }
        const emitted = new Set<string>();
        for (const item of items) {
          const subKey = `${localDateKey(item.episode.airstamp)}__${item.show.tvmaze_id}`;
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
      const daysOut = diffDaysFromToday(first.episode.airstamp);
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
      const daysOut = diffDaysFromToday(item.episode.airstamp);
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
    const daysOut = diffDaysFromToday(item.episode.airstamp);
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
          <EmptyState icon="calendar-outline" title={t.shows.emptyWatchList} />
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

      <FeelingSheet
        visible={!!feelingPromptItem}
        onClose={() => setFeelingPromptItem(null)}
        onSelect={handleQuickFeeling}
      />
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
  });
}
