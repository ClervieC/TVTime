import { useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useColors, radius, type, Colors } from "../lib/theme";

interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  primary?: boolean;
}

interface ChoiceDialogProps<T extends string> {
  visible: boolean;
  title: string;
  subtitle: string;
  options: ChoiceOption<T>[];
  onChoose: (value: T) => void;
  // Tapping outside the card — a dismiss, not necessarily one of the options
  // above (e.g. it might mean "cancel, nothing changes" for one prompt and
  // "assume the safe default" for another — the caller decides which).
  onDismiss: () => void;
}

// The one small "pick one of two things" popup in the app — used by the
// rewatch prompt and the previous-episodes prompt. Same backdrop, same card,
// same button shapes; only the copy and options differ.
export function ChoiceDialog<T extends string>({
  visible,
  title,
  subtitle,
  options,
  onChoose,
  onDismiss,
}: ChoiceDialogProps<T>) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (!visible) return null;

  return (
    <Pressable style={styles.backdrop} onPress={onDismiss}>
      <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {options.map((opt) => (
          <Pressable
            key={opt.value}
            style={[styles.optionBtn, opt.primary && styles.optionBtnPrimary]}
            onPress={() => onChoose(opt.value)}
          >
            <Text style={[styles.optionText, opt.primary && styles.optionTextPrimary]}>{opt.label}</Text>
          </Pressable>
        ))}
      </Pressable>
    </Pressable>
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
    title: { fontSize: type.body, fontWeight: "800", color: colors.text, textAlign: "center" },
    subtitle: { fontSize: type.bodySm, color: colors.textMuted, textAlign: "center", marginTop: 4, marginBottom: 16 },
    optionBtn: {
      backgroundColor: colors.pillBg,
      borderRadius: radius.sm,
      paddingVertical: 14,
      alignItems: "center",
      marginTop: 8,
    },
    optionBtnPrimary: { backgroundColor: colors.accent },
    optionText: { fontWeight: "700", fontSize: type.bodySm, color: colors.text },
    optionTextPrimary: { color: colors.onAccent },
  });
}
