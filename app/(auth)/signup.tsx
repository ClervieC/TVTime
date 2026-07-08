import { useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useColors, radius, type, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";
import { createProfile } from "../../lib/profiles";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export default function SignupScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();

  async function handleSignup() {
    setError(null);
    setInfo(null);

    if (!USERNAME_RE.test(username)) {
      setError(t.signup.usernameInvalid);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }

    if (data.session) {
      try {
        await createProfile(username);
      } catch {
        setLoading(false);
        setError(t.signup.usernameTaken);
        return;
      }
    }
    // If there's no session yet (email confirmation required), the profile gets
    // created on first login instead — see the missing-profile prompt in Profile.

    setLoading(false);
    setInfo(t.signup.success);
  }

  return (
    <View style={styles.container}>
      <Image source={require("../../assets/logo.png")} style={styles.logo} contentFit="contain" />
      <Text style={styles.title}>{t.signup.title}</Text>

      <TextInput
        style={styles.input}
        placeholder={t.signup.email}
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder={t.signup.username}
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        value={username}
        onChangeText={setUsername}
      />
      <TextInput
        style={styles.input}
        placeholder={t.signup.password}
        placeholderTextColor={colors.textFaint}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error && <Text style={styles.error}>{error}</Text>}
      {info && <Text style={styles.info}>{info}</Text>}

      <Pressable style={styles.button} onPress={handleSignup} disabled={loading}>
        {loading ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.buttonText}>{t.signup.signUp}</Text>}
      </Pressable>

      <Link href="/(auth)/login" style={styles.link}>
        {t.signup.hasAccount}
      </Link>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: colors.background },
    logo: { width: 96, height: 96, alignSelf: "center", marginBottom: 12, borderRadius: radius.lg },
    title: { fontSize: type.display, fontWeight: "800", color: colors.text, textAlign: "center", marginBottom: 32 },
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
    info: { color: colors.green, marginBottom: 12, textAlign: "center" },
    link: { color: colors.textMuted, textAlign: "center", marginTop: 20 },
  });
}
