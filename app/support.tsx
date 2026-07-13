import { useCallback, useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, TextInput, ActivityIndicator, StyleSheet } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { sendSupportMessage, fetchMySupportMessages, SupportMessage } from "../lib/support";
import { alert } from "../lib/alert";
import { useGoBack } from "../lib/useGoBack";
import { EmptyState } from "../components/EmptyState";

export default function SupportScreen() {
  const goBack = useGoBack("/(tabs)/profile");
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetchMySupportMessages()
      .then(setMessages)
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleSend() {
    if (!body.trim()) return;
    setSending(true);
    try {
      await sendSupportMessage(body);
      setBody("");
      load();
    } catch {
      alert(t.support.title, t.support.sendFailed);
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t.support.title}</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.composer}>
        <Text style={styles.composerLabel}>{t.support.composerLabel}</Text>
        <TextInput
          style={styles.input}
          placeholder={t.support.placeholder}
          placeholderTextColor={colors.textFaint}
          value={body}
          onChangeText={setBody}
          multiline
          numberOfLines={4}
        />
        <Pressable
          style={[styles.sendBtn, (!body.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!body.trim() || sending}
        >
          {sending ? <ActivityIndicator size="small" color={colors.onAccent} /> : <Text style={styles.sendBtnText}>{t.support.send}</Text>}
        </Pressable>
      </View>

      <Text style={styles.historyLabel}>{t.support.historyLabel}</Text>

      {loading ? (
        <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.statusPill, item.status === "resolved" && styles.statusPillResolved]}>
                  <Text style={styles.statusPillText}>
                    {item.status === "resolved" ? t.support.statusResolved : t.support.statusOpen}
                  </Text>
                </View>
                <Text style={styles.cardDate}>{item.created_at.slice(0, 10)}</Text>
              </View>
              <Text style={styles.cardBody}>{item.body}</Text>
              {item.status === "resolved" && item.resolution_note && (
                <View style={styles.replyBox}>
                  <Text style={styles.replyLabel}>{t.support.replyLabel}</Text>
                  <Text style={styles.replyText}>{item.resolution_note}</Text>
                </View>
              )}
            </View>
          )}
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title={t.support.empty} />}
        />
      )}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 12,
    },
    title: { fontSize: type.title, fontWeight: "800", color: colors.text },
    composer: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
    composerLabel: { fontSize: type.caption, fontWeight: "700", color: colors.textMuted },
    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: 12,
      color: colors.text,
      fontSize: type.body,
      minHeight: 90,
      textAlignVertical: "top",
    },
    sendBtn: {
      alignSelf: "flex-end",
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
      paddingVertical: 10,
      paddingHorizontal: 20,
    },
    sendBtnDisabled: { opacity: 0.5 },
    sendBtnText: { color: colors.onAccent, fontWeight: "700" },
    historyLabel: {
      fontSize: type.caption,
      fontWeight: "800",
      color: colors.textFaint,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    list: { padding: 16, paddingTop: 0, gap: 10 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
    },
    cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
    statusPill: { backgroundColor: colors.pillBg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
    statusPillResolved: { backgroundColor: colors.greenLight },
    statusPillText: { fontSize: type.caption, fontWeight: "700", color: colors.textMuted },
    cardDate: { fontSize: type.caption, color: colors.textFaint },
    cardBody: { fontSize: type.bodySm, color: colors.text, lineHeight: 19 },
    replyBox: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
    replyLabel: { fontSize: type.micro, fontWeight: "800", color: colors.textFaint, textTransform: "uppercase" },
    replyText: { fontSize: type.caption, color: colors.textMuted, marginTop: 2 },
  });
}
