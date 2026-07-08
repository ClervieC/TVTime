import { useCallback, useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { fetchNotifications, EnrichedNotification } from "../lib/notifications";
import { useNotifications } from "../context/NotificationsContext";
import { Avatar } from "../components/Avatar";
import { EmptyState } from "../components/EmptyState";

export default function NotificationsScreen() {
  const router = useRouter();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const [notifications, setNotifications] = useState<EnrichedNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const { markAllRead } = useNotifications();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      fetchNotifications().then((data) => {
        if (!active) return;
        setNotifications(data);
        setLoading(false);
        markAllRead();
      });
      return () => {
        active = false;
      };
    }, [markAllRead])
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t.social.notifications}</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => item.actor && router.push({ pathname: "/users/[id]", params: { id: item.actor!.user_id } })}
            >
              <Avatar name={item.actor?.username} size="sm" />
              <View style={{ flex: 1 }}>
                <Text style={styles.text}>
                  <Text style={styles.bold}>{item.actor?.username ?? "?"}</Text> {t.social.startedFollowingYou}
                </Text>
                <Text style={styles.date}>{new Date(item.created_at).toLocaleDateString()}</Text>
              </View>
              {!item.read && <View style={styles.unreadDot} />}
            </Pressable>
          )}
          ListEmptyComponent={<EmptyState icon="notifications-outline" title={t.social.noNotifications} />}
        />
      )}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 12,
    },
    title: { fontSize: type.title, fontWeight: "800", color: colors.text },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
    text: { fontSize: type.body, color: colors.text },
    bold: { fontWeight: "800" },
    date: { fontSize: type.caption, color: colors.textMuted, marginTop: 2 },
    unreadDot: { width: 8, height: 8, borderRadius: 999, backgroundColor: colors.accent },
  });
}
