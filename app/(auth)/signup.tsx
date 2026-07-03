import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Link } from "expo-router";
import { supabase } from "../../lib/supabase";
import { colors, radius } from "../../lib/theme";

export default function SignupScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignup() {
    setError(null);
    setInfo(null);
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setInfo("Compte créé. Vérifie ta boîte mail si une confirmation est requise.");
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Créer un compte</Text>

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
      {info && <Text style={styles.info}>{info}</Text>}

      <Pressable style={styles.button} onPress={handleSignup} disabled={loading}>
        {loading ? <ActivityIndicator color={colors.black} /> : <Text style={styles.buttonText}>S'inscrire</Text>}
      </Pressable>

      <Link href="/(auth)/login" style={styles.link}>
        Déjà un compte ? Se connecter
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: colors.background },
  title: { fontSize: 28, fontWeight: "800", color: colors.text, textAlign: "center", marginBottom: 32 },
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
  info: { color: colors.green, marginBottom: 12, textAlign: "center" },
  link: { color: colors.textMuted, textAlign: "center", marginTop: 20 },
});
