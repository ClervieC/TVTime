import { useEffect, useRef, useState } from "react";
import { Animated } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

export function useScalePress(toValue = 0.95) {
  const scale = useRef(new Animated.Value(1)).current;

  function onPressIn() {
    Animated.spring(scale, { toValue, useNativeDriver: true, speed: 50, bounciness: 6 }).start();
  }

  function onPressOut() {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 6 }).start();
  }

  return { scale, onPressIn, onPressOut };
}

export function useFadeIn(ready: boolean) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!ready) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, [ready, opacity]);

  return opacity;
}

export function useMountIn() {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 280, useNativeDriver: true }).start();
  }, [progress]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  return { opacity: progress, transform: [{ translateY }] };
}

// Quick color flash overlay, meant to confirm an action (e.g. marking an
// episode watched) happened right away. Imperatively triggered rather than
// derived from state, so it fires the instant the user acts — it doesn't
// depend on the row still showing the same data (or even still being
// mounted at the same list position) once a network round-trip resolves.
export function useFlashPulse() {
  const opacity = useRef(new Animated.Value(0)).current;

  function flash() {
    opacity.setValue(0.35);
    Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: true }).start();
  }

  return { opacity, flash };
}

const DISMISS_DISTANCE = 100;
const DISMISS_VELOCITY = 800;

// Pull-down-to-close, scoped to whatever it's attached to (typically just the
// hero image) rather than the whole screen — so it doesn't fight the page's
// own vertical scroll, the same way iOS/Android modals close on a swipe down
// from their top area.
export function useSwipeDownToDismiss(onDismiss: () => void) {
  const translateY = useSharedValue(0);

  const gesture = Gesture.Pan()
    .activeOffsetY(10)
    .failOffsetY(-10)
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
        runOnJS(onDismiss)();
      } else {
        translateY.value = withSpring(0, { damping: 20, stiffness: 300 });
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return { gesture, animatedStyle };
}

const SWIPE_DISTANCE = 60;
const SWIPE_VELOCITY = 500;

// Swipe left/right to change episode, scoped to whatever it's attached to
// (the hero image — see EpisodePage in app/episode/[id].tsx) instead of the
// whole page. That page also has a plain vertical ScrollView for its actual
// content (summary, rating, comments); on web, the FlatList that pages
// between episodes claims horizontal touch panning for its *entire* width
// via CSS touch-action, and a descendant can't reliably carve out "but let
// vertical panning through here" — the browser intersects the two, which
// left neither direction usable in some spots. Detecting the swipe with our
// own X-locked gesture here (activeOffsetX/failOffsetY, same shape as
// useSwipeDownToDismiss's Y-locked one above) and disabling the FlatList's
// own touch scrolling on web (see episode/[id].tsx) removes that conflict —
// this becomes the only thing claiming horizontal touches, and only over the
// hero image, so the rest of the page scrolls vertically like normal.
export function useSwipeHorizontal(onSwipeLeft: () => void, onSwipeRight: () => void) {
  const gesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-10, 10])
    .onEnd((e) => {
      if (e.translationX < -SWIPE_DISTANCE || e.velocityX < -SWIPE_VELOCITY) {
        runOnJS(onSwipeLeft)();
      } else if (e.translationX > SWIPE_DISTANCE || e.velocityX > SWIPE_VELOCITY) {
        runOnJS(onSwipeRight)();
      }
    });

  return gesture;
}

// Drives Sheet's open/close transition. Unlike the other hooks here, the
// component needs to stay mounted while animating OUT (a plain `if
// (!visible) return null` pops instantly with no chance to animate), so this
// tracks its own `mounted` flag: true immediately on open, but only flips
// back to false once the close animation actually finishes.
export function useSheetTransition(visible: boolean) {
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 4 }).start();
    } else {
      Animated.timing(progress, { toValue: 0, duration: 200, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, progress]);

  return { mounted, progress };
}

export function useGrowIn(trigger: unknown) {
  const scaleX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    scaleX.setValue(0);
    Animated.timing(scaleX, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  return scaleX;
}
