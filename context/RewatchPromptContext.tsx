import { createContext, useCallback, useContext, useRef, useState, PropsWithChildren } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors, radius } from "../lib/theme";

type RewatchChoice = "unwatch" | "rewatch";

interface RewatchPromptContextValue {
  askRewatch: () => Promise<RewatchChoice>;
}

const RewatchPromptContext = createContext<RewatchPromptContextValue | null>(null);

export function RewatchPromptProvider({ children }: PropsWithChildren) {
  const [visible, setVisible] = useState(false);
  const resolver = useRef<((choice: RewatchChoice) => void) | null>(null);

  const askRewatch = useCallback(() => {
    return new Promise<RewatchChoice>((resolve) => {
      resolver.current = resolve;
      setVisible(true);
    });
  }, []);

  function choose(choice: RewatchChoice) {
    setVisible(false);
    resolver.current?.(choice);
    resolver.current = null;
  }

  return (
    <RewatchPromptContext.Provider value={{ askRewatch }}>
      {children}
      {visible && (
        <Pressable style={styles.backdrop} onPress={() => choose("unwatch")}>
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.title}>Tu as déjà marqué cet épisode comme vu</Text>
            <Text style={styles.subtitle}>Qu'est-ce que tu veux faire ?</Text>
            <Pressable style={styles.optionBtn} onPress={() => choose("unwatch")}>
              <Text style={styles.optionText}>Je ne l'ai pas regardé</Text>
            </Pressable>
            <Pressable style={[styles.optionBtn, styles.optionBtnPrimary]} onPress={() => choose("rewatch")}>
              <Text style={[styles.optionText, styles.optionTextPrimary]}>Je l'ai revu</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      )}
    </RewatchPromptContext.Provider>
  );
}

export function useRewatchPrompt() {
  const ctx = useContext(RewatchPromptContext);
  if (!ctx) throw new Error("useRewatchPrompt must be used within RewatchPromptProvider");
  return ctx.askRewatch;
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 20,
    width: "100%",
    maxWidth: 360,
  },
  title: { fontSize: 16, fontWeight: "800", color: colors.text, textAlign: "center" },
  subtitle: { fontSize: 13, color: colors.textMuted, textAlign: "center", marginTop: 4, marginBottom: 16 },
  optionBtn: {
    backgroundColor: colors.pillBg,
    borderRadius: radius.sm,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  optionBtnPrimary: { backgroundColor: colors.accent },
  optionText: { fontWeight: "700", fontSize: 14, color: colors.text },
  optionTextPrimary: { color: colors.black },
});
