import { createContext, useCallback, useContext, useEffect, useRef, useState, PropsWithChildren } from "react";
import { Animated, View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Badge, BADGE_ICON, categoryColor, badgeLabel } from "../lib/streaks";
import { useColors, radius, type, dropShadow, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { NATIVE_DRIVER } from "../lib/animations";

interface BadgeUnlockContextValue {
  announceBadges: (badges: Badge[]) => void;
}

const BadgeUnlockContext = createContext<BadgeUnlockContextValue | null>(null);

const VISIBLE_MS = 3200;

// Mounted once at the app root so a badge earned while on any screen (Shows,
// an episode detail, wherever computeStreakData() happens to run — see its
// onNewlyUnlocked param) shows the same top banner regardless of which
// screen is currently active, rather than each call site having to know how
// to render one. Queues rather than overlapping when several badges unlock
// in the same compute (e.g. crossing two thresholds in one watch session).
export function BadgeUnlockProvider({ children }: PropsWithChildren) {
  const colors = useColors();
  const styles = useStyles(colors);
  const { t } = useLanguage();
  const router = useRouter();
  const [queue, setQueue] = useState<Badge[]>([]);
  const current = queue[0] ?? null;
  const translateY = useRef(new Animated.Value(-80)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announceBadges = useCallback((badges: Badge[]) => {
    if (badges.length === 0) return;
    setQueue((prev) => [...prev, ...badges]);
  }, []);

  function dismiss() {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    Animated.timing(translateY, { toValue: -80, duration: 220, useNativeDriver: NATIVE_DRIVER }).start(() => {
      setQueue((prev) => prev.slice(1));
    });
  }

  useEffect(() => {
    if (!current) return;
    translateY.setValue(-80);
    Animated.spring(translateY, { toValue: 0, useNativeDriver: NATIVE_DRIVER, speed: 14, bounciness: 8 }).start();
    dismissTimer.current = setTimeout(dismiss, VISIBLE_MS);
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const color = current ? categoryColor(colors, current.category) : colors.accent;

  return (
    <BadgeUnlockContext.Provider value={{ announceBadges }}>
      {children}
      {current && (
        <Animated.View style={[styles.banner, { transform: [{ translateY }] }]} pointerEvents="box-none">
          <Pressable
            style={[styles.card, { borderColor: `${color}55` }]}
            onPress={() => {
              dismiss();
              router.push("/streaks");
            }}
          >
            <View style={[styles.iconWrap, { backgroundColor: `${color}22` }]}>
              <Ionicons name={BADGE_ICON[current.category]} size={20} color={color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{t.profile.badgeUnlockedTitle}</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {badgeLabel(t, current)}
              </Text>
            </View>
            <Pressable onPress={dismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel={t.common.cancel}>
              <Ionicons name="close" size={18} color={colors.textFaint} />
            </Pressable>
          </Pressable>
        </Animated.View>
      )}
    </BadgeUnlockContext.Provider>
  );
}

export function useBadgeUnlockToast() {
  const ctx = useContext(BadgeUnlockContext);
  if (!ctx) throw new Error("useBadgeUnlockToast must be used within BadgeUnlockProvider");
  return ctx.announceBadges;
}

function useStyles(colors: Colors) {
  return StyleSheet.create({
    banner: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      paddingTop: 50,
      paddingHorizontal: 16,
      zIndex: 1000,
    },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: 12,
      ...dropShadow({ opacity: 0.2, radius: 16, offsetY: 6, elevation: 8 }),
    },
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    title: { fontSize: type.caption, fontWeight: "800", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
    subtitle: { fontSize: type.body, fontWeight: "800", color: colors.text, marginTop: 2 },
  });
}
