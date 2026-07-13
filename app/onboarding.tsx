import { useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  Animated,
  StyleSheet,
  NativeSyntheticEvent,
  NativeScrollEvent,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors, radius, type, dropShadow, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { markOnboardingComplete } from "../lib/onboarding";
import { useMountIn } from "../lib/animations";

interface Slide {
  image: number;
  title: string;
  body: string;
}

// Shown once per device on first login/signup (see the redirect check in
// app/_layout.tsx and lib/onboarding.ts) — a lot of the app's value (Watch
// Next, streaks, activity feed) only becomes visible once you've actually
// followed a few shows, so a brand new account landing straight on an empty
// Shows tab had nothing to explain what to do next. Screenshots (assets/
// onboarding/*.png) instead of a built-from-shapes mockup — real app UI reads
// as more trustworthy than an illustration of it.
export default function OnboardingScreen() {
  const router = useRouter();
  const colors = useColors();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<Slide>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  const slides: Slide[] = [
    {
      image: require("../assets/onboarding/mylist.png"),
      title: t.onboarding.slide1Title,
      body: t.onboarding.slide1Body,
    },
    {
      image: require("../assets/onboarding/upcoming.png"),
      title: t.onboarding.slide2Title,
      body: t.onboarding.slide2Body,
    },
    {
      image: require("../assets/onboarding/details.png"),
      title: t.onboarding.slide4Title,
      body: t.onboarding.slide4Body,
    },
    {
      image: require("../assets/onboarding/explore.png"),
      title: t.onboarding.slide3Title,
      body: t.onboarding.slide3Body,
    },
    {
      image: require("../assets/onboarding/movies.png"),
      title: t.onboarding.slide5Title,
      body: t.onboarding.slide5Body,
    },
    {
      image: require("../assets/onboarding/activity.png"),
      title: t.onboarding.slide6Title,
      body: t.onboarding.slide6Body,
    },
    {
      image: require("../assets/onboarding/profile.png"),
      title: t.onboarding.slide7Title,
      body: t.onboarding.slide7Body,
    },
  ];
  const isLast = index === slides.length - 1;

  async function finish() {
    await markOnboardingComplete();
    router.replace("/(tabs)/explore");
  }

  function next() {
    if (isLast) {
      finish();
      return;
    }
    listRef.current?.scrollToOffset({
      offset: (index + 1) * width,
      animated: true,
    });
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[`${colors.accent}26`, "transparent"]}
        style={[styles.glow, { pointerEvents: "none" }]}
      />

      <View style={styles.topBar}>
        <View style={styles.progressTrack}>
          {slides.map((_s, i) => (
            <View
              key={i}
              style={[
                styles.progressSegment,
                i <= index && { backgroundColor: colors.accent },
              ]}
            />
          ))}
        </View>
        {!isLast && (
          <Pressable onPress={finish} accessibilityRole="button" hitSlop={10}>
            <Text style={styles.skipText}>{t.onboarding.skip}</Text>
          </Pressable>
        )}
      </View>

      <Animated.FlatList
        ref={listRef}
        style={styles.slidesList}
        data={slides}
        keyExtractor={(_s, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        windowSize={3}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          {
            useNativeDriver: false,
            listener: onScroll,
          },
        )}
        scrollEventThrottle={16}
        renderItem={({ item }) => (
          <OnboardingSlide
            slide={item}
            width={width}
            colors={colors}
            styles={styles}
          />
        )}
      />

      <View style={styles.footer}>
        <Pressable
          style={[styles.nextBtn, { backgroundColor: colors.accent }]}
          onPress={next}
          accessibilityRole="button"
        >
          <Text style={styles.nextBtnText}>
            {isLast ? t.onboarding.getStarted : t.onboarding.next}
          </Text>
          <Ionicons
            name={isLast ? "checkmark" : "arrow-forward"}
            size={18}
            color={colors.onAccent}
          />
        </Pressable>
      </View>
    </View>
  );
}

function OnboardingSlide({
  slide,
  width,
  colors,
  styles,
}: {
  slide: Slide;
  width: number;
  colors: Colors;
  styles: OnboardingStyles;
}) {
  const mountIn = useMountIn();

  return (
    <View style={[styles.slide, { width }]}>
      <Animated.View
        style={[
          styles.screenshotWrap,
          { opacity: mountIn.opacity, transform: mountIn.transform },
        ]}
      >
        <Image
          source={slide.image}
          style={styles.screenshot}
          contentFit="cover"
          // Anchored top-left rather than centered — one of these
          // screenshots (mylist.png) has extra blank canvas on its right
          // edge, wider than the other three, so a centered crop clipped
          // into the actual UI on one side while leaving blank space
          // showing on the other. Anchoring top-left keeps the real
          // content (which starts at 0,0 in every one of these) fully
          // in frame regardless of that inconsistency.
          contentPosition="top left"
        />
      </Animated.View>
      <Animated.Text
        style={[
          styles.title,
          { opacity: mountIn.opacity, transform: mountIn.transform },
        ]}
      >
        {slide.title}
      </Animated.Text>
      <Animated.Text
        style={[
          styles.body,
          { opacity: mountIn.opacity, transform: mountIn.transform },
        ]}
      >
        {slide.body}
      </Animated.Text>
    </View>
  );
}

type OnboardingStyles = ReturnType<typeof createStyles>;

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    glow: { position: "absolute", top: 0, left: 0, right: 0, height: 420 },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      paddingHorizontal: 24,
      paddingTop: 40,
      paddingBottom: 15,
    },
    slidesList: { flex: 1 },
    progressTrack: { flex: 1, flexDirection: "row", gap: 6 },
    progressSegment: {
      flex: 1,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.pillBg,
    },
    skipText: {
      color: colors.textMuted,
      fontWeight: "700",
      fontSize: type.bodySm,
    },
    slide: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 28,
    },
    screenshotWrap: {
      // Matches the real screenshots' own ~373:667 ratio (see the crop note
      // on the Image below) rather than an arbitrary box.
      width: 179,
      height: 320,
      borderRadius: radius.lg,
      overflow: "hidden",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 28,
      ...dropShadow({ opacity: 0.18, radius: 20, offsetY: 10, elevation: 8 }),
    },
    screenshot: { width: "100%", height: "100%" },
    title: {
      fontSize: type.display,
      fontWeight: "800",
      color: colors.text,
      textAlign: "center",
      marginBottom: 12,
    },
    body: {
      fontSize: type.body,
      color: colors.textMuted,
      textAlign: "center",
      lineHeight: 22,
      maxWidth: 300,
    },
    footer: { paddingHorizontal: 24, paddingBottom: 44, paddingTop: 8 },
    nextBtn: {
      flexDirection: "row",
      width: "100%",
      borderRadius: radius.pill,
      paddingVertical: 17,
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    nextBtnText: {
      color: colors.onAccent,
      fontWeight: "800",
      fontSize: type.body,
    },
  });
}
