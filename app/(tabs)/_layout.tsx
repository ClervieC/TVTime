import { useCallback, useMemo, useRef, useState } from "react";
import { Tabs, useFocusEffect } from "expo-router";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AdBanner } from "../../components/AdBanner";
import { useColors, Colors } from "../../lib/theme";
import { useLanguage, Translations } from "../../lib/i18n";
import { useNotifications } from "../../context/NotificationsContext";
import { useActivityUnseen } from "../../context/ActivityContext";
import { fetchMyProfile } from "../../lib/profiles";
import { fetchOpenReportCount } from "../../lib/reports";
import { fetchOpenSupportMessageCount } from "../../lib/support";

interface TabBarProps {
  state: { routes: { key: string; name: string }[]; index: number };
  navigation: any;
  unreadCount: number;
  hasUnseenActivity: boolean;
  hasAdminAlerts: boolean;
}

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: "tv-outline",
  movies: "film-outline",
  explore: "search-outline",
  activity: "pulse-outline",
  profile: "person-outline",
};

function tabLabels(t: Translations): Record<string, string> {
  return {
    index: t.tabs.shows,
    movies: t.tabs.movies,
    explore: t.tabs.explore,
    activity: t.tabs.activity,
    profile: t.tabs.profile,
  };
}

function CustomTabBar({ state, navigation, unreadCount, hasUnseenActivity, hasAdminAlerts }: TabBarProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const labels = tabLabels(t);

  return (
    <View>
      <AdBanner />
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const color = focused ? colors.accent : colors.textFaint;

          return (
            <Pressable
              key={route.key}
              style={styles.item}
              onPress={() => {
                const event = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                // Already on this tab — block the navigator's default action
                // entirely so it doesn't reset/refocus the screen (which was
                // re-triggering that screen's focus-effect data reload).
                if (focused) {
                  event.preventDefault();
                  return;
                }
                if (!event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              }}
            >
              <View>
                <Ionicons name={ICONS[route.name]} size={22} color={color} />
                {route.name === "profile" && (unreadCount > 0 || hasAdminAlerts) && <View style={styles.badge} />}
                {route.name === "activity" && hasUnseenActivity && <View style={styles.badge} />}
              </View>
              <Text style={[styles.label, { color }]}>{labels[route.name]}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const MIN_REFETCH_INTERVAL_MS = 10_000;

export default function TabsLayout() {
  const { t } = useLanguage();
  const { unreadCount, refresh } = useNotifications();
  const { hasUnseen: hasUnseenActivity, refresh: refreshActivity } = useActivityUnseen();
  const [hasAdminAlerts, setHasAdminAlerts] = useState(false);
  const lastFetchedAt = useRef(0);

  // Only admins ever see this (fetchMyProfile()'s own is_admin check gates
  // it before either count query fires), so this stays a single cheap
  // is_admin lookup for every other user. Combines open reports and open
  // support messages (see app/admin/index.tsx's two queues) into one badge —
  // this is "something needs your attention," not two separate signals.
  const refreshAdminAlerts = useCallback(() => {
    fetchMyProfile().then((profile) => {
      if (!profile?.is_admin) {
        setHasAdminAlerts(false);
        return;
      }
      Promise.all([fetchOpenReportCount(), fetchOpenSupportMessageCount()])
        .then(([reports, support]) => setHasAdminAlerts(reports > 0 || support > 0))
        .catch(() => {});
    });
  }, []);

  // (tabs) is one Stack.Screen among several siblings (episode/[id], show/[id],
  // list/[id], users/*, connections/[id], notifications — see app/_layout.tsx),
  // so this refires on return from ANY of those, not just notifications, and
  // NOT on switching between this group's own tabs (index/movies/explore/profile
  // — that's a child-navigator change, not a focus change on this screen).
  // The min-interval guard avoids a Supabase round trip on every quick
  // in-and-out navigation (e.g. opening and closing an episode modal). This
  // only needs to catch NEW notifications that arrived elsewhere — clearing
  // the badge after the user actually reads them is handled instantly by
  // NotificationsContext's markAllRead(), not by this poll.
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastFetchedAt.current < MIN_REFETCH_INTERVAL_MS) return;
      lastFetchedAt.current = now;
      refresh();
      refreshActivity();
      refreshAdminAlerts();
    }, [refresh, refreshActivity, refreshAdminAlerts])
  );

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => (
        <CustomTabBar
          {...(props as any)}
          unreadCount={unreadCount}
          hasUnseenActivity={hasUnseenActivity}
          hasAdminAlerts={hasAdminAlerts}
        />
      )}
    >
      <Tabs.Screen name="index" options={{ title: t.tabs.shows }} />
      <Tabs.Screen name="movies" options={{ title: t.tabs.movies }} />
      <Tabs.Screen name="explore" options={{ title: t.tabs.explore }} />
      <Tabs.Screen name="activity" options={{ title: t.tabs.activity }} />
      <Tabs.Screen name="profile" options={{ title: t.tabs.profile }} />
    </Tabs>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    bar: {
      flexDirection: "row",
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 8,
      paddingBottom: 10,
    },
    item: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    label: {
      fontSize: 11,
      fontWeight: "600",
    },
    badge: {
      position: "absolute",
      top: -2,
      right: -4,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.red,
    },
  });
}
