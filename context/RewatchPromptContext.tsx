import { createContext, useCallback, useContext, useRef, useState, PropsWithChildren } from "react";
import { useLanguage } from "../lib/i18n";
import { ChoiceDialog } from "../components/ChoiceDialog";

type RewatchChoice = "unwatch" | "rewatch" | "cancel";

interface RewatchPromptContextValue {
  askRewatch: () => Promise<RewatchChoice>;
}

const RewatchPromptContext = createContext<RewatchPromptContextValue | null>(null);

export function RewatchPromptProvider({ children }: PropsWithChildren) {
  const [visible, setVisible] = useState(false);
  const resolver = useRef<((choice: RewatchChoice) => void) | null>(null);
  const { t } = useLanguage();

  const askRewatch = useCallback(() => {
    return new Promise<RewatchChoice>((resolve) => {
      // Only one dialog can be on screen at a time. If a prior ask is still
      // pending (e.g. a fast double-tap across two episode rows before the
      // first dialog finishes mounting), resolve it as cancelled rather than
      // clobbering resolver.current and leaving that caller's promise to
      // hang forever.
      resolver.current?.("cancel");
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
      <ChoiceDialog
        visible={visible}
        title={t.rewatchPrompt.alreadyWatched}
        subtitle={t.rewatchPrompt.whatToDo}
        options={[
          { value: "unwatch", label: t.rewatchPrompt.unwatch },
          { value: "rewatch", label: t.rewatchPrompt.rewatch, primary: true },
        ]}
        onChoose={choose}
        // Dismissing by tapping outside the card is a cancel, not a choice —
        // only an explicit option button should change the episode's state.
        onDismiss={() => choose("cancel")}
      />
    </RewatchPromptContext.Provider>
  );
}

export function useRewatchPrompt() {
  const ctx = useContext(RewatchPromptContext);
  if (!ctx) throw new Error("useRewatchPrompt must be used within RewatchPromptProvider");
  return ctx.askRewatch;
}
