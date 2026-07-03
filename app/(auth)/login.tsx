import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Link } from "expo-router";
import { supabase } from "../../lib/supabase";
import { colors, radius } from "../../lib/theme";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>TVTime</Text>
      <Text style={styles.subtitle}>Suis tes séries</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Mot de passe"
        placeholderTextColor={colors.textFaint}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable style={styles.button} onPress={handleLogin} disabled={loading}>
        {loading ? <ActivityIndicator color={colors.black} /> : <Text style={styles.buttonText}>Se connecter</Text>}
      </Pressable>

      <Link href="/(auth)/signup" style={styles.link}>
        Pas de compte ? Créer un compte
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: colors.background },
  title: { fontSize: 36, fontWeight: "800", color: colors.text, textAlign: "center" },
  subtitle: { fontSize: 16, color: colors.textMuted, textAlign: "center", marginBottom: 32 },
  input: {
    backgroundColor: colors.backgroundAlt,
    color: colors.text,
    borderRadius: radius.sm,
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
  buttonText: { color: colors.black, fontWeight: "700", fontSize: 16 },
  error: { color: colors.red, marginBottom: 12, textAlign: "center" },
  link: { color: colors.textMuted, textAlign: "center", marginTop: 20 },
});
