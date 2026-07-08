import { useCallback, useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, type, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";
import { fetchFollowerIds, fetchFollowingIds } from "../../lib/follows";
import { fetchProfiles, Profile } from "../../lib/profiles";
import { UserRow } from "../../components/UserRow";
import { EmptyState } from "../../components/EmptyState";

export default function ConnectionsScreen() {
  const { id, type } = useLocalSearchParams<{ id: string; type: "followers" | "following" }>();
  const router = useRouter();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const isFollowers = type === "followers";

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      const fetchIds = isFollowers ? fetchFollowerIds(id) : fetchFollowingIds(id);
      fetchIds
        .then((ids) => fetchProfiles(ids))
        .then((data) => {
          if (!active) return;
          setProfiles(data);
          setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [id, isFollowers])
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{isFollowers ? t.social.followersTitle : t.social.followingTitle}</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={profiles}
          keyExtractor={(item) => item.user_id}
          renderItem={({ item }) => (
            <UserRow
              username={item.username}
              onPress={() => router.push({ pathname: "/users/[id]", params: { id: item.user_id } })}
            />
          )}
          ListEmptyComponent={
            <EmptyState icon="people-outline" title={isFollowers ? t.social.noFollowers : t.social.noFollowing} />
          }
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
  });
}
