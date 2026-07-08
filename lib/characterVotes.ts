import { supabase, getCurrentUserId } from "./supabase";

export interface CharacterVoteTally {
  characterId: number;
  characterName: string;
  personId: number;
  personName: string;
  personImage: string | null;
  count: number;
}

interface CharacterVoteRow {
  user_id: string;
  character_id: number;
  character_name: string;
  person_id: number;
  person_name: string;
  person_image: string | null;
}

export interface CharacterVoteChoice {
  personId: number;
  personName: string;
  personImage: string | null;
  characterId: number;
  characterName: string;
}

export async function fetchCharacterVotes(
  episodeId: number
): Promise<{ tally: CharacterVoteTally[]; myCharacterId: number | null }> {
  const myId = await getCurrentUserId();

  const { data, error } = await supabase
    .from("character_votes")
    .select("user_id, character_id, character_name, person_id, person_name, person_image")
    .eq("tvmaze_episode_id", episodeId);
  if (error) throw error;

  const byCharacter = new Map<number, CharacterVoteTally>();
  let myCharacterId: number | null = null;
  for (const row of data as CharacterVoteRow[]) {
    if (row.user_id === myId) myCharacterId = row.character_id;
    const existing = byCharacter.get(row.character_id);
    if (existing) {
      existing.count += 1;
    } else {
      byCharacter.set(row.character_id, {
        characterId: row.character_id,
        characterName: row.character_name,
        personId: row.person_id,
        personName: row.person_name,
        personImage: row.person_image,
        count: 1,
      });
    }
  }

  return { tally: [...byCharacter.values()].sort((a, b) => b.count - a.count), myCharacterId };
}

export async function voteForCharacter(
  showId: number,
  episodeId: number,
  character: CharacterVoteChoice
): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase.from("character_votes").upsert(
    {
      user_id: userId,
      tvmaze_show_id: showId,
      tvmaze_episode_id: episodeId,
      person_id: character.personId,
      person_name: character.personName,
      person_image: character.personImage,
      character_id: character.characterId,
      character_name: character.characterName,
    },
    { onConflict: "user_id,tvmaze_episode_id" }
  );
  if (error) throw error;
}

export async function removeCharacterVote(episodeId: number): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;

  const { error } = await supabase
    .from("character_votes")
    .delete()
    .eq("user_id", userId)
    .eq("tvmaze_episode_id", episodeId);
  if (error) throw error;
}
