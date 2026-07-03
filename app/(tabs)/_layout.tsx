import { Tabs } from "expo-router";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../lib/theme";

interface TabBarProps {
  state: { routes: { key: string; name: string }[]; index: number };
  navigation: any;
}

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: "tv-outline",
  movies: "film-outline",
  explore: "search-outline",
  profile: "person-outline",
};

const LABELS: Record<string, string> = {
  index: "Shows",
  movies: "Movies",
  explore: "Explore",
  profile: "Profile",
};

function CustomTabBar({ state, navigation }: TabBarProps) {
  return (
    <View style={styles.bar}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const color = focused ? colors.black : colors.textFaint;

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
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            }}
          >
            <Ionicons name={ICONS[route.name]} size={22} color={color} />
            <Text style={[styles.label, { color }]}>{LABELS[route.name]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <CustomTabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: "Shows" }} />
      <Tabs.Screen name="movies" options={{ title: "Movies" }} />
      <Tabs.Screen name="explore" options={{ title: "Explore" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
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
});
