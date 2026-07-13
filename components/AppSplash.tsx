import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useColors } from "../lib/theme";
import { NATIVE_DRIVER } from "../lib/animations";

interface AppSplashProps {
  visible: boolean;
}

// Sits as an absolutely-positioned overlay above the root Stack (see
// app/_layout.tsx) rather than replacing it — the screens underneath mount
// and start fetching immediately, so by the time this fades out their data
// is already there instead of starting a fresh spinner.
export function AppSplash({ visible }: AppSplashProps) {
  const colors = useColors();
  const [mounted, setMounted] = useState(visible);
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.86)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  // Entrance + idle pulse, run once on mount — independent of `visible` so it
  // keeps breathing for as long as the overlay stays up, however long that
  // ends up being.
  useEffect(() => {
    Animated.parallel([
      Animated.timing(logoOpacity, { toValue: 1, duration: 420, useNativeDriver: NATIVE_DRIVER }),
      Animated.spring(logoScale, { toValue: 1, useNativeDriver: NATIVE_DRIVER, speed: 10, bounciness: 6 }),
    ]).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: NATIVE_DRIVER }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [logoOpacity, logoScale, pulse]);

  // Fades the whole overlay out and only then unmounts it — an instant
  // `if (!visible) return null` would pop off with no transition.
  useEffect(() => {
    if (visible) {
      setMounted(true);
      overlayOpacity.setValue(1);
      return;
    }
    Animated.timing(overlayOpacity, { toValue: 0, duration: 380, useNativeDriver: NATIVE_DRIVER }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [visible, overlayOpacity]);

  if (!mounted) return null;

  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        styles.container,
        { backgroundColor: colors.background, opacity: overlayOpacity, pointerEvents: visible ? "auto" : "none" },
      ]}
    >
      <Animated.View style={{ opacity: logoOpacity, transform: [{ scale: Animated.multiply(logoScale, pulseScale) }] }}>
        <Image source={require("../assets/logo.png")} style={styles.logo} contentFit="contain" />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  logo: { width: 120, height: 120, borderRadius: 28 },
});
