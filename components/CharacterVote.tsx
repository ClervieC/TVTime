import { useMemo } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { CastMember } from "../lib/tvmaze";
import { CharacterVoteTally } from "../lib/characterVotes";
import { Avatar } from "./Avatar";
import { Pill } from "./Pill";

const MAX_CANDIDATES = 20;

interface CharacterVoteProps {
  cast: CastMember[];
  tally: CharacterVoteTally[];
  myCharacterId: number | null;
  onVote: (member: CastMember) => void;
  onRemoveVote: () => void;
}

export function CharacterVote({ cast, tally, myCharacterId, onVote, onRemoveVote }: CharacterVoteProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();

  const countByCharacter = useMemo(() => new Map(tally.map((v) => [v.characterId, v.count])), [tally]);
  const candidates = cast.filter((c) => !!c.person).slice(0, MAX_CANDIDATES);

  if (candidates.length === 0) return null;

  return (
    <View>
      <Text style={styles.title}>{t.characterVote.title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {candidates.map((c) => {
          const selected = myCharacterId === c.character.id;
          const count = countByCharacter.get(c.character.id) ?? 0;
          return (
            <Pressable
              key={c.character.id}
              style={styles.card}
              onPress={() => (selected ? onRemoveVote() : onVote(c))}
            >
              <View style={styles.avatarWrap}>
                <Avatar imageUri={c.person.image?.medium} size="md" />
                {selected && (
                  <View style={styles.selectedBadge}>
                    <Ionicons name="checkmark" size={11} color="#fff" />
                  </View>
                )}
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {c.character.name}
              </Text>
              {count > 0 && <Pill size="sm">{t.characterVote.voteCount(count)}</Pill>}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    title: { fontSize: type.title, fontWeight: "800", color: colors.text, marginBottom: 12 },
    card: { width: 80, marginRight: 14, alignItems: "center", gap: 4 },
    avatarWrap: { position: "relative" },
    selectedBadge: {
      position: "absolute",
      bottom: -2,
      right: -2,
      width: 18,
      height: 18,
      borderRadius: 999,
      backgroundColor: colors.green,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: colors.background,
    },
    name: { fontSize: type.micro, fontWeight: "700", color: colors.text, textAlign: "center" },
  });
}
