import { useCallback, useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { fetchListItems, fetchLists, ListItem, ShowList } from "../../lib/userShows";
import { useColors, type, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";
import { ShowCard } from "../../components/ShowCard";
import { EmptyState } from "../../components/EmptyState";

export default function ListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [list, setList] = useState<ShowList | null>(null);
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      Promise.all([fetchLists(), fetchListItems(id)]).then(([lists, listItems]) => {
        if (!active) return;
        setList(lists.find((l) => l.id === id) ?? null);
        setItems(listItems);
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }, [id])
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.black} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{list?.name ?? t.listDetail.title}</Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={3}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={{ gap: 12 }}
        renderItem={({ item }) => <ShowCard id={item.tvmaze_id} name={item.show_name} imageUrl={item.show_image} />}
        ListEmptyComponent={<EmptyState icon="list-outline" title={t.listDetail.empty} />}
      />
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 12,
    },
    title: { fontSize: type.title, fontWeight: "800", color: colors.text },
    grid: { padding: 16, gap: 16 },
  });
}
