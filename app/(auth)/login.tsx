import { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useColors, radius, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();

  async function handleLogin() {
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (error) setError(error.message);
  }

  return (
    <View style={styles.container}>
      <Image
        source={require("../../assets/logo.png")}
        style={styles.logo}
        contentFit="contain"
      />
      <Text style={styles.subtitle}>{t.login.tagline}</Text>

      <TextInput
        style={styles.input}
        placeholder={t.login.email}
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder={t.login.password}
        placeholderTextColor={colors.textFaint}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable style={styles.button} onPress={handleLogin} disabled={loading}>
        {loading ? (
          <ActivityIndicator color={colors.onAccent} />
        ) : (
          <Text style={styles.buttonText}>{t.login.signIn}</Text>
        )}
      </Pressable>

      <Link href="/(auth)/signup" style={styles.link}>
        {t.login.noAccount}
      </Link>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: "center",
      padding: 24,
      backgroundColor: colors.background,
    },
    logo: {
      width: 96,
      height: 96,
      alignSelf: "center",
      marginBottom: 12,
      borderRadius: radius.lg,
    },
    subtitle: {
      fontSize: 16,
      color: colors.textMuted,
      textAlign: "center",
      marginBottom: 32,
    },
    input: {
      backgroundColor: colors.surface,
      color: colors.text,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 12,
      fontSize: 16,
    },
    button: {
      backgroundColor: colors.accent,
      borderRadius: radius.sm,
      padding: 16,
      alignItems: "center",
      marginTop: 8,
    },
    buttonText: { color: colors.onAccent, fontWeight: "700", fontSize: 16 },
    error: { color: colors.red, marginBottom: 12, textAlign: "center" },
    link: { color: colors.textMuted, textAlign: "center", marginTop: 20 },
  });
}
