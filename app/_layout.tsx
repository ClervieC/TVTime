import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { initAds } from "../lib/adsInit";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { NotificationsProvider } from "../context/NotificationsContext";
import { ActivityProvider } from "../context/ActivityContext";
import { NetworkProvider } from "../context/NetworkContext";
import { RewatchPromptProvider } from "../context/RewatchPromptContext";
import { PreviousEpisodesPromptProvider } from "../context/PreviousEpisodesPromptContext";
import { AddToListPromptProvider } from "../context/AddToListPromptContext";
import { BadgeUnlockProvider } from "../context/BadgeUnlockContext";
import { LanguageProvider } from "../lib/i18n";
import { ThemeProvider, useThemeMode } from "../lib/theme";
import { AppSplash } from "../components/AppSplash";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { OfflineBanner } from "../components/OfflineBanner";
import { shouldShowOnboarding } from "../lib/onboarding";

// Keeps the native splash screen (configured via the expo-splash-screen
// config plugin in app.json) visible until the JS AppSplash overlay below
// is ready to take over. Called eagerly at module scope — per Expo's
// guidance — so it can't lose the race against the native auto-hide.
SplashScreen.preventAutoHideAsync();

function RootNavigation() {
  const { session, loading, dataReady, setDataReady } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const nativeSplashHidden = useRef(false);
  // null = not checked yet (or signed out) — deliberately distinct from
  // false, so the redirect effect below doesn't fire a false "onboarding
  // already done" redirect in the brief window before the async check below
  // resolves.
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    if (!session) {
      setNeedsOnboarding(null);
      return;
    }
    shouldShowOnboarding().then(setNeedsOnboarding);
  }, [session]);

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === "(auth)";
    // Terms/Privacy stay reachable whether or not you're logged in — app
    // stores expect a privacy policy link that doesn't require an account,
    // and it's a reasonable thing to want to check before signing up.
    const isLegalRoute = segments[0] === "legal";
    const isOnboardingRoute = segments[0] === "onboarding";

    if (!session && !inAuthGroup && !isLegalRoute) {
      router.replace("/(auth)/login");
    } else if (session && inAuthGroup) {
      router.replace(needsOnboarding ? "/onboarding" : "/(tabs)");
    } else if (session && needsOnboarding && !isOnboardingRoute && !isLegalRoute) {
      router.replace("/onboarding");
    }
  }, [session, loading, segments, needsOnboarding]);

  // Universal fallback for the splash gate below: the Shows tab's own
  // loadData() (app/(tabs)/index.tsx) normally flips dataReady itself, but
  // only mounts/runs when the Shows tab is the one actually focused. A deep
  // link or refresh landing straight on any other route while
  // authenticated — another tab (Profile, Movies, Explore), or a route
  // entirely outside the (tabs) group like /admin, show/[id], notifications
  // — never mounts the Shows tab, so that signal would never fire and the
  // splash (a full-screen, high-zIndex overlay — see AppSplash) would stay
  // up forever, silently blocking every click behind it. This runs for
  // every route, so it covers all of those; harmless if the Shows tab
  // already set it (setDataReady is idempotent).
  useEffect(() => {
    if (session && !loading) setDataReady(true);
  }, [session, loading, setDataReady]);

  // Covers both a cold start/refresh (still checking the session) and the
  // moment right after login (session is known but the Shows tab hasn't
  // finished its first load of tracked shows yet) — see dataReady in
  // AuthContext and app/(tabs)/index.tsx.
  const showSplash = loading || (!!session && !dataReady);

  // Fire the native-splash handoff at the same point AppSplash starts its
  // own fade-out, so there's no gap/flash between the native splash and the
  // JS one — this only ever transitions true -> false, once.
  useEffect(() => {
    if (!showSplash && !nativeSplashHidden.current) {
      nativeSplashHidden.current = true;
      SplashScreen.hideAsync();
    }
  }, [showSplash]);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="show/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="show/tmdb/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="episode/[id]" options={{ headerShown: false, presentation: "modal" }} />
        <Stack.Screen name="list/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="users/search" options={{ headerShown: false }} />
        <Stack.Screen name="users/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="connections/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen name="legal/terms" options={{ headerShown: false }} />
        <Stack.Screen name="legal/privacy" options={{ headerShown: false }} />
        <Stack.Screen name="admin/index" options={{ headerShown: false }} />
        <Stack.Screen name="stats/shows" options={{ headerShown: false }} />
        <Stack.Screen name="recap" options={{ headerShown: false }} />
        <Stack.Screen name="support" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="streaks" options={{ headerShown: false }} />
      </Stack>
      <AppSplash visible={showSplash} />
      <OfflineBanner />
    </>
  );
}

function ThemedStatusBar() {
  const { resolvedScheme } = useThemeMode();
  // expo-status-bar's "dark"/"light" name the *content* color, which is the
  // inverse of the background scheme — a dark background needs light text.
  return <StatusBar style={resolvedScheme === "dark" ? "light" : "dark"} />;
}

export default function RootLayout() {
  useEffect(() => {
    initAds();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <ThemeProvider>
            <NetworkProvider>
              <AuthProvider>
                <LanguageProvider>
                  <NotificationsProvider>
                    <ActivityProvider>
                      <View style={{ flex: 1 }}>
                        <RewatchPromptProvider>
                          <PreviousEpisodesPromptProvider>
                            <AddToListPromptProvider>
                              <BadgeUnlockProvider>
                                <RootNavigation />
                              </BadgeUnlockProvider>
                            </AddToListPromptProvider>
                          </PreviousEpisodesPromptProvider>
                        </RewatchPromptProvider>
                      </View>
                    </ActivityProvider>
                  </NotificationsProvider>
                </LanguageProvider>
              </AuthProvider>
            </NetworkProvider>
            <ThemedStatusBar />
          </ThemeProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
