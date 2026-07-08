import { useMemo } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, type, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";

const CONTENT = {
  en: {
    title: "Privacy Policy",
    updated: "Last updated: July 2026",
    sections: [
      {
        heading: "1. What's collected",
        body: "Your email and password (used for account sign-in), the username and profile info you choose to set, and the shows, movies, episodes, ratings, comments, and lists you add in the app.",
      },
      {
        heading: "2. How it's used",
        body: "Solely to run the app: tracking what you watch, showing your watchlist and stats, and letting other users you follow (or who follow you) see the profile info and activity you've chosen to share. Your data is never sold.",
      },
      {
        heading: "3. Where it's stored",
        body: "App data is stored with Supabase, the backend provider Epify runs on. Show/movie artwork and metadata is fetched from TVmaze and TMDB at request time and isn't stored beyond normal caching.",
      },
      {
        heading: "4. Who can see what",
        body: "Your email is only visible to you. Your username, favorites, and public activity may be visible to other users depending on the follow/social features you use.",
      },
      {
        heading: "5. Your rights",
        body: "You can delete shows, lists, or your account data at any time from within the app. To request a full export or deletion of your account, contact clervie@bluedays.com.",
      },
      {
        heading: "6. Changes to this policy",
        body: "This policy may be updated occasionally to reflect changes to the app. Continuing to use Epify after a change means you accept the update.",
      },
      {
        heading: "7. Contact",
        body: "Questions about your data? Reach out at clervie@bluedays.com.",
      },
    ],
  },
  fr: {
    title: "Politique de confidentialité",
    updated: "Dernière mise à jour : juillet 2026",
    sections: [
      {
        heading: "1. Ce qui est collecté",
        body: "Ton email et mot de passe (utilisés pour la connexion), le pseudo et les infos de profil que tu choisis de renseigner, ainsi que les séries, films, épisodes, notes, commentaires et listes que tu ajoutes dans l'application.",
      },
      {
        heading: "2. Comment c'est utilisé",
        body: "Uniquement pour faire fonctionner l'application : suivre ce que tu regardes, afficher ta liste et tes statistiques, et permettre aux autres utilisateurs que tu suis (ou qui te suivent) de voir les infos de profil et l'activité que tu as choisi de partager. Tes données ne sont jamais vendues.",
      },
      {
        heading: "3. Où c'est stocké",
        body: "Les données de l'application sont stockées chez Supabase, le prestataire backend utilisé par Epify. Les images et métadonnées des séries/films proviennent de TVmaze et TMDB, récupérées à la demande, sans stockage au-delà d'une mise en cache classique.",
      },
      {
        heading: "4. Qui voit quoi",
        body: "Ton email n'est visible que par toi. Ton pseudo, tes favoris et ton activité publique peuvent être visibles par d'autres utilisateurs selon les fonctionnalités sociales (abonnements) que tu utilises.",
      },
      {
        heading: "5. Tes droits",
        body: "Tu peux supprimer des séries, des listes ou les données de ton compte à tout moment depuis l'application. Pour demander un export complet ou la suppression de ton compte, contacte clervie@bluedays.com.",
      },
      {
        heading: "6. Modifications de cette politique",
        body: "Cette politique peut être mise à jour occasionnellement pour refléter des changements de l'application. Continuer à utiliser Epify après une modification signifie que tu acceptes la mise à jour.",
      },
      {
        heading: "7. Contact",
        body: "Des questions sur tes données ? Écris à clervie@bluedays.com.",
      },
    ],
  },
};

export default function PrivacyScreen() {
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
