import { useEffect } from "react";
import { View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { NotificationsProvider } from "../context/NotificationsContext";
import { RewatchPromptProvider } from "../context/RewatchPromptContext";
import { PreviousEpisodesPromptProvider } from "../context/PreviousEpisodesPromptContext";
import { LanguageProvider } from "../lib/i18n";
import { AppSplash } from "../components/AppSplash";

function RootNavigation() {
  const { session, loading, dataReady } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === "(auth)";
    // Terms/Privacy stay reachable whether or not you're logged in — app
    // stores expect a privacy policy link that doesn't require an account,
    // and it's a reasonable thing to want to check before signing up.
    const isLegalRoute = segments[0] === "legal";

    if (!session && !inAuthGroup && !isLegalRoute) {
      router.replace("/(auth)/login");
    } else if (session && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [session, loading, segments]);

  // Covers both a cold start/refresh (still checking the session) and the
  // moment right after login (session is known but the Shows tab hasn't
  // finished its first load of tracked shows yet) — see dataReady in
  // AuthContext and app/(tabs)/index.tsx.
  const showSplash = loading || (!!session && !dataReady);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="show/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="episode/[id]" options={{ headerShown: false, presentation: "modal" }} />
        <Stack.Screen name="list/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="users/search" options={{ headerShown: false }} />
        <Stack.Screen name="users/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="connections/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen name="legal/terms" options={{ headerShown: false }} />
        <Stack.Screen name="legal/privacy" options={{ headerShown: false }} />
      </Stack>
      <AppSplash visible={showSplash} />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <LanguageProvider>
            <NotificationsProvider>
              <View style={{ flex: 1 }}>
                <RewatchPromptProvider>
                  <PreviousEpisodesPromptProvider>
                    <RootNavigation />
                  </PreviousEpisodesPromptProvider>
                </RewatchPromptProvider>
              </View>
            </NotificationsProvider>
          </LanguageProvider>
        </AuthProvider>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
