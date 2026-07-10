import { useMemo } from "react";
import { View, Text, Pressable, Animated, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { useScalePress } from "../lib/animations";
import { FEELING_EMOJIS } from "../lib/feelings";
import { CommentsSection, CommentLike } from "./CommentsSection";

interface MovieRatingSectionProps {
  rating: number | null;
  feeling: string | null;
  onRate: (value: number) => void;
  onFeeling: (key: string) => void;
  feelingCounts: Record<string, number>;
  comments: CommentLike[];
  commentsLoading: boolean;
  myUserId: string | null;
  onSubmitComment: (body: string) => Promise<void>;
  onDeleteComment: (id: string) => void;
  onToggleReaction: (id: string, currentlyReacted: boolean) => void;
}

// Rating stars + feeling picker + others' feelings tally + comments, shown
// once a movie is marked watched — mirrors the same section on episode
// detail (app/episode/[id].tsx), reused as-is by both app/movie/[id].tsx and
// app/movie/tmdb/[id].tsx.
export function MovieRatingSection({
  rating,
  feeling,
  onRate,
  onFeeling,
  feelingCounts,
  comments,
  commentsLoading,
  myUserId,
  onSubmitComment,
  onDeleteComment,
  onToggleReaction,
}: MovieRatingSectionProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();

  return (
    <View>
      <View style={styles.divider} />
      <Text style={styles.sectionLabel}>{t.episodeDetail.yourRating}</Text>
      <View style={styles.starsRow}>
        {[1, 2, 3, 4, 5].map((n) => (
          <RatingStar
            key={n}
            index={n}
            filled={!!(rating && rating >= n)}
            onPress={() => onRate(n)}
            colors={colors}
            styles={styles}
          />
        ))}
      </View>

      <Text style={styles.sectionLabel}>{t.episodeDetail.howDidYouFeel}</Text>
      <View style={styles.feelingsRow}>
        {FEELING_EMOJIS.map((f) => (
          <FeelingChip
            key={f.key}
            emoji={f.emoji}
            label={t.feelings[f.key]}
            active={feeling === f.key}
            onPress={() => onFeeling(f.key)}
            colors={colors}
            styles={styles}
          />
        ))}
      </View>

      {Object.keys(feelingCounts).length > 0 && (
        <>
          <View style={styles.divider} />
          <Text style={styles.sectionLabel}>{t.episodeDetail.othersFelt}</Text>
          <View style={styles.feelingsRow}>
            {FEELING_EMOJIS.filter((f) => feelingCounts[f.key] > 0).map((f) => (
              <View key={f.key} style={styles.feelingTally}>
                <Text style={styles.feelingEmoji}>{f.emoji}</Text>
                <Text style={styles.feelingTallyCount}>{feelingCounts[f.key]}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      <View style={styles.divider} />
      <Text style={styles.sectionLabel}>{t.episodeDetail.comments}</Text>
      <CommentsSection
        comments={comments}
        loading={commentsLoading}
        myUserId={myUserId}
        onSubmit={onSubmitComment}
        onDelete={onDeleteComment}
        onToggleReaction={onToggleReaction}
        reportTargetType="movie_comment"
      />
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;

function RatingStar({
  index,
  filled,
  onPress,
  colors,
  styles,
}: {
  index: number;
  filled: boolean;
  onPress: () => void;
  colors: Colors;
  styles: Styles;
}) {
  const { scale, onPressIn, onPressOut } = useScalePress(0.75);

  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={onPress}
      style={styles.starCol}
      accessibilityRole="button"
      accessibilityLabel={`Rate ${index} star${index > 1 ? "s" : ""}`}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Ionicons name={filled ? "star" : "star-outline"} size={28} color={filled ? colors.starOn : colors.starOff} />
      </Animated.View>
    </Pressable>
  );
}

function FeelingChip({
  emoji,
  label,
  active,
  onPress,
  colors,
  styles,
}: {
  emoji: string;
  label: string;
  active: boolean;
  onPress: () => void;
  colors: Colors;
  styles: Styles;
}) {
  const { scale, onPressIn, onPressOut } = useScalePress(0.88);

  return (
    <Pressable onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress}>
      <Animated.View style={[styles.feelingChip, active && styles.feelingChipActive, { transform: [{ scale }] }]}>
        <Text style={styles.feelingEmoji}>{emoji}</Text>
        <Text style={[styles.feelingLabel, active && { color: colors.accent }]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    divider: { height: 1, backgroundColor: colors.border, marginVertical: 20 },
    sectionLabel: {
      textAlign: "center",
      fontWeight: "800",
      fontSize: 12,
      color: colors.textMuted,
      letterSpacing: 0.5,
      marginBottom: 12,
    },
    starsRow: { flexDirection: "row", justifyContent: "center", gap: 12, marginBottom: 20 },
    starCol: { alignItems: "center" },
    feelingsRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 4 },
    feelingChip: { alignItems: "center", gap: 4, padding: 8, borderRadius: radius.sm },
    feelingChipActive: { backgroundColor: colors.accentSoft },
    feelingEmoji: { fontSize: 26 },
    feelingLabel: { fontSize: type.micro, fontWeight: "700", color: colors.textMuted },
    feelingTally: { alignItems: "center", gap: 4, padding: 8 },
    feelingTallyCount: { fontSize: 12, fontWeight: "700", color: colors.textMuted },
  });
}
