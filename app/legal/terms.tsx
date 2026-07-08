import { useMemo } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, type, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";

const CONTENT = {
  en: {
    title: "Terms & Conditions",
    updated: "Last updated: July 2026",
    sections: [
      {
        heading: "1. About Epify",
        body: "Epify is a personal show and movie tracking app that lets you follow series, mark episodes and movies as watched, rate them, and keep lists. It's built and maintained by a single independent developer, not a company.",
      },
      {
        heading: "2. Your account",
        body: "You need an account (email and password) to use Epify. You're responsible for keeping your login details safe and for anything that happens under your account.",
      },
      {
        heading: "3. Third-party data",
        body: "Show, episode, and movie information (titles, images, air dates, synopses) comes from third-party sources such as TVmaze and TMDB. Epify doesn't control the accuracy of that data and isn't affiliated with either service.",
      },
      {
        heading: "4. Acceptable use",
        body: "Don't use Epify to harass other users, post illegal content, or attempt to disrupt or reverse-engineer the service. Accounts that do may be suspended or removed.",
      },
      {
        heading: "5. No warranty",
        body: "Epify is provided \"as is\", as a hobby project, without any guarantee of uptime, accuracy, or fitness for a particular purpose. Features may change or be removed at any time.",
      },
      {
        heading: "6. Changes to these terms",
        body: "These terms may be updated occasionally. Continuing to use the app after a change means you accept the updated terms.",
      },
      {
        heading: "7. Contact",
        body: "Questions about these terms? Reach out at clervie@bluedays.com.",
      },
    ],
  },
  fr: {
    title: "Conditions d'utilisation",
    updated: "Dernière mise à jour : juillet 2026",
    sections: [
      {
        heading: "1. À propos d'Epify",
        body: "Epify est une application personnelle de suivi de séries et de films qui permet de suivre des séries, marquer des épisodes et des films comme vus, les noter et créer des listes. Elle est développée et maintenue par un développeur indépendant, pas une entreprise.",
      },
      {
        heading: "2. Ton compte",
        body: "Un compte (email et mot de passe) est nécessaire pour utiliser Epify. Tu es responsable de la confidentialité de tes identifiants et de tout ce qui se passe sur ton compte.",
      },
      {
        heading: "3. Données tierces",
        body: "Les informations sur les séries, épisodes et films (titres, images, dates de diffusion, synopsis) proviennent de sources tierces comme TVmaze et TMDB. Epify ne contrôle pas l'exactitude de ces données et n'est affilié à aucun de ces services.",
      },
      {
        heading: "4. Utilisation acceptable",
        body: "N'utilise pas Epify pour harceler d'autres utilisateurs, publier du contenu illégal, ou tenter de perturber ou d'analyser le fonctionnement interne du service. Les comptes qui enfreignent ces règles peuvent être suspendus ou supprimés.",
      },
      {
        heading: "5. Aucune garantie",
        body: "Epify est fourni « tel quel », en tant que projet personnel, sans garantie de disponibilité, d'exactitude ou d'adéquation à un usage particulier. Les fonctionnalités peuvent changer ou être retirées à tout moment.",
      },
      {
        heading: "6. Modifications de ces conditions",
        body: "Ces conditions peuvent être mises à jour occasionnellement. Continuer à utiliser l'application après une modification signifie que tu acceptes les nouvelles conditions.",
      },
      {
        heading: "7. Contact",
        body: "Des questions sur ces conditions ? Écris à clervie@bluedays.com.",
      },
    ],
  },
};

export default function TermsScreen() {
  const router = useRouter();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { language } = useLanguage();
  const content = CONTENT[language];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{content.title}</Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>{content.updated}</Text>
        {content.sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text style={styles.heading}>{section.heading}</Text>
            <Text style={styles.body}>{section.body}</Text>
          </View>
        ))}
      </ScrollView>
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
    content: { paddingHorizontal: 20, paddingBottom: 40 },
    updated: { fontSize: type.caption, color: colors.textMuted, marginBottom: 16 },
    section: { marginBottom: 20 },
    heading: { fontSize: type.subtitle, fontWeight: "800", color: colors.text, marginBottom: 6 },
    body: { fontSize: type.body, color: colors.textMuted, lineHeight: 21 },
  });
}
