import { useMemo } from "react";
import { View, Text, Pressable, Linking, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { WatchProviders } from "../lib/tmdb";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";

const PROVIDER_LOGO_BASE = "https://image.tmdb.org/t/p/w92";

interface WatchInfoProps {
  trailerUrl: string | null;
  providers: WatchProviders | null;
}

// Trailer button + streaming/rent/buy provider logos — shown identically on
// a movie or a show's detail page (see app/movie/tmdb/[id].tsx and
// app/show/[id].tsx), so this doesn't know or care which one it's for; both
// come from lib/tmdb.ts regardless (TVmaze has neither).
export function WatchInfo({ trailerUrl, providers }: WatchInfoProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();

  const hasProviders = providers && (providers.flatrate.length > 0 || providers.rent.length > 0 || providers.buy.length > 0);
  if (!trailerUrl && !hasProviders) return null;

  return (
    <View>
      {hasProviders && (
        <>
          <Text style={styles.sectionHeader}>{t.common.whereToWatch}</Text>
          <ProviderGroup label={t.common.stream} providers={providers!.flatrate} link={providers!.link} styles={styles} />
          <ProviderGroup label={t.common.rent} providers={providers!.rent} link={providers!.link} styles={styles} />
          <ProviderGroup label={t.common.buy} providers={providers!.buy} link={providers!.link} styles={styles} />
        </>
      )}

      {trailerUrl && (
        <Pressable style={styles.trailerBtn} onPress={() => Linking.openURL(trailerUrl)}>
          <Ionicons name="play-circle" size={20} color={colors.onAccent} />
          <Text style={styles.trailerBtnText}>{t.common.watchTrailer}</Text>
        </Pressable>
      )}
    </View>
  );
}

function ProviderGroup({
  label,
  providers,
  link,
  styles,
}: {
  label: string;
  providers: WatchProviders["flatrate"];
  link: string | null;
  styles: Styles;
}) {
  if (providers.length === 0) return null;
  return (
    <View style={styles.providerGroup}>
      <Text style={styles.providerGroupLabel}>{label}</Text>
      <View style={styles.providerRow}>
        {providers.map((p) => (
          <Pressable key={p.provider_id} onPress={() => link && Linking.openURL(link)}>
            {p.logo_path ? (
              <Image source={{ uri: `${PROVIDER_LOGO_BASE}${p.logo_path}` }} style={styles.providerLogo} contentFit="cover" />
            ) : (
              <View style={styles.providerLogo} />
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;

function createStyles(colors: Colors) {
  return StyleSheet.create({
    trailerBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: colors.accent,
      borderRadius: radius.sm,
      paddingVertical: 12,
      marginTop: 16,
    },
    trailerBtnText: { color: colors.onAccent, fontWeight: "700", fontSize: type.body },
    sectionHeader: { color: colors.text, fontSize: type.subtitle, fontWeight: "800", marginTop: 24, marginBottom: 8 },
    providerGroup: { marginBottom: 10 },
    providerGroupLabel: { color: colors.textMuted, fontSize: type.caption, marginBottom: 6 },
    providerRow: { flexDirection: "row", gap: 8 },
    providerLogo: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.backgroundAlt },
  });
}
