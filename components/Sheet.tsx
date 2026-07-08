import { ReactNode, useMemo } from "react";
import { Animated, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { useColors, radius, Colors } from "../lib/theme";
import { useSheetTransition } from "../lib/animations";

const WIDE_BREAKPOINT = 700;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

// The one bottom-sheet/dialog chrome in the app — a menu, a list picker,
// anything that's "a card of options over a backdrop." On mobile it's a
// sheet glued to the bottom edge (slides up + backdrop fades in); on a wide
// (tablet/desktop web) viewport that reads as an unadapted mobile pattern,
// so it becomes a centered dialog that scales in instead. Content is up to
// the caller.
export function Sheet({ visible, onClose, children }: SheetProps) {
  const { width } = useWindowDimensions();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isWide = width >= WIDE_BREAKPOINT;
  const { mounted, progress } = useSheetTransition(visible);

  if (!mounted) return null;

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });

  return (
    <AnimatedPressable
      style={[styles.backdrop, isWide && styles.backdropWide, { opacity: progress }]}
      onPress={onClose}
    >
      <Animated.View
        style={[styles.sheet, isWide && styles.sheetWide, { transform: [isWide ? { scale } : { translateY }] }]}
      >
        <Pressable onPress={(e) => e.stopPropagation()}>{children}</Pressable>
      </Animated.View>
    </AnimatedPressable>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    backdrop: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "flex-end",
    },
    backdropWide: { justifyContent: "center", alignItems: "center", padding: 24 },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: 16,
      paddingBottom: 32,
      gap: 4,
    },
    sheetWide: {
      width: "100%",
      maxWidth: 420,
      borderRadius: radius.lg,
      paddingBottom: 16,
      shadowColor: "#000",
      shadowOpacity: 0.25,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 8 },
      elevation: 12,
    },
  });
}
