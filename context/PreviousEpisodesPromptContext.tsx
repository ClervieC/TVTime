import { createContext, useCallback, useContext, useRef, useState, PropsWithChildren } from "react";
import { useLanguage } from "../lib/i18n";
import { ChoiceDialog } from "../components/ChoiceDialog";

type PreviousEpisodesChoice = "onlyThis" | "allPrevious";

interface PreviousEpisodesPromptContextValue {
  askPreviousEpisodes: () => Promise<PreviousEpisodesChoice>;
}

const PreviousEpisodesPromptContext = createContext<PreviousEpisodesPromptContextValue | null>(null);

export function PreviousEpisodesPromptProvider({ children }: PropsWithChildren) {
  const [visible, setVisible] = useState(false);
  const resolver = useRef<((choice: PreviousEpisodesChoice) => void) | null>(null);
  const { t } = useLanguage();

  const askPreviousEpisodes = useCallback(() => {
    return new Promise<PreviousEpisodesChoice>((resolve) => {
      // Only one dialog can be on screen at a time. If a prior ask is still
      // pending, resolve it (matching the dismiss default) rather than
      // clobbering resolver.current and leaving that caller's promise to
      // hang forever.
      resolver.current?.("onlyThis");
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
      <ChoiceDialog
        visible={visible}
        title={t.previousEpisodesPrompt.title}
        subtitle={t.previousEpisodesPrompt.subtitle}
        options={[
          { value: "onlyThis", label: t.previousEpisodesPrompt.onlyThis },
          { value: "allPrevious", label: t.previousEpisodesPrompt.allPrevious, primary: true },
        ]}
        onChoose={choose}
        onDismiss={() => choose("onlyThis")}
      />
    </PreviousEpisodesPromptContext.Provider>
  );
}

export function usePreviousEpisodesPrompt() {
  const ctx = useContext(PreviousEpisodesPromptContext);
  if (!ctx) throw new Error("usePreviousEpisodesPrompt must be used within PreviousEpisodesPromptProvider");
  return ctx.askPreviousEpisodes;
}
