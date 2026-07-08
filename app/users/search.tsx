import { useMemo, useState } from "react";
import { View, Text, TextInput, FlatList, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";
import { searchProfiles, Profile } from "../../lib/profiles";
import { followUser, unfollowUser } from "../../lib/follows";
import { UserRow } from "../../components/UserRow";
import { FollowButton } from "../../components/FollowButton";
import { EmptyState } from "../../components/EmptyState";

export default function UserSearchScreen() {
  const router = useRouter();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  let timer: ReturnType<typeof setTimeout>;

  function onChangeText(text: string) {
    setQuery(text);
    clearTimeout(timer);
    if (!text.trim()) {
      setResults([]);
      return;
    }
    timer = setTimeout(async () => {
      const data = await searchProfiles(text.trim());
      setResults(data);
    }, 300);
  }

  async function toggleFollow(profile: Profile) {
    const isFollowing = followingIds.has(profile.user_id);
    setBusyIds((prev) => new Set(prev).add(profile.user_id));
    try {
      if (isFollowing) {
        await unfollowUser(profile.user_id);
        setFollowingIds((prev) => {
          const next = new Set(prev);
          next.delete(profile.user_id);
          return next;
        });
      } else {
        await followUser(profile.user_id);
        setFollowingIds((prev) => new Set(prev).add(profile.user_id));
      }
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(profile.user_id);
        return next;
      });
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t.social.searchTitle}</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.textFaint} />
        <TextInput
          style={styles.searchInput}
          placeholder={t.social.searchPlaceholder}
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          value={query}
          onChangeText={onChangeText}
          autoFocus
        />
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.user_id}
        renderItem={({ item }) => (
          <UserRow
            username={item.username}
            onPress={() => router.push({ pathname: "/users/[id]", params: { id: item.user_id } })}
            trailing={
              <FollowButton
                following={followingIds.has(item.user_id)}
                loading={busyIds.has(item.user_id)}
                onPress={() => toggleFollow(item)}
              />
            }
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title={query.trim() ? t.social.noUsersFound(query.trim()) : t.social.searchHint}
          />
        }
      />
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
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginHorizontal: 16,
      marginBottom: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.backgroundAlt,
      borderRadius: radius.sm,
    },
    searchInput: { flex: 1, fontSize: type.input, color: colors.text },
  });
}
