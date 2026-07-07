import { createContext, useCallback, useContext, useMemo, useRef, useState, PropsWithChildren } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useColors, radius, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";

type PreviousEpisodesChoice = "onlyThis" | "allPrevious";

interface PreviousEpisodesPromptContextValue {
  askPreviousEpisodes: () => Promise<PreviousEpisodesChoice>;
}

const PreviousEpisodesPromptContext = createContext<PreviousEpisodesPromptContextValue | null>(null);

export function PreviousEpisodesPromptProvider({ children }: PropsWithChildren) {
  const [visible, setVisible] = useState(false);
  const resolver = useRef<((choice: PreviousEpisodesChoice) => void) | null>(null);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();

  const askPreviousEpisodes = useCallback(() => {
    return new Promise<PreviousEpisodesChoice>((resolve) => {
      resolver.current = resolve;
      setVisible(true);
    });
  }, []);

  function choose(choice: PreviousEpisodesChoice) {
    setVisible(false);
    resolver.current?.(choice);
    resolver.current = null;
  }

  return (
    <PreviousEpisodesPromptContext.Provider value={{ askPreviousEpisodes }}>
      {children}
      {visible && (
        <Pressable style={styles.backdrop} onPress={() => choose("onlyThis")}>
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.title}>{t.previousEpisodesPrompt.title}</Text>
            <Text style={styles.subtitle}>{t.previousEpisodesPrompt.subtitle}</Text>
            <Pressable style={styles.optionBtn} onPress={() => choose("onlyThis")}>
              <Text style={styles.optionText}>{t.previousEpisodesPrompt.onlyThis}</Text>
            </Pressable>
            <Pressable style={[styles.optionBtn, styles.optionBtnPrimary]} onPress={() => choose("allPrevious")}>
              <Text style={[styles.optionText, styles.optionTextPrimary]}>{t.previousEpisodesPrompt.allPrevious}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      )}
    </PreviousEpisodesPromptContext.Provider>
  );
}

export function usePreviousEpisodesPrompt() {
  const ctx = useContext(PreviousEpisodesPromptContext);
  if (!ctx) throw new Error("usePreviousEpisodesPrompt must be used within PreviousEpisodesPromptProvider");
  return ctx.askPreviousEpisodes;
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
    optionTextPrimary: { color: colors.onAccent },
  });
}
