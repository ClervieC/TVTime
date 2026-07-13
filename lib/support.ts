import { supabase, getCurrentUserId } from "./supabase";

export type SupportStatus = "open" | "resolved";

export interface SupportMessage {
  id: string;
  user_id: string;
  body: string;
  status: SupportStatus;
  resolution_note: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

export async function sendSupportMessage(body: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase.from("support_messages").insert({ user_id: userId, body: body.trim() });
  if (error) throw error;
}

export async function fetchMySupportMessages(): Promise<SupportMessage[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("support_messages")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as SupportMessage[];
}

// Everything below is admin-only in practice (see the RLS policies in
// supabase/schema.sql) — mirrors lib/reports.ts's own split.
export async function fetchSupportMessagesForAdmin(status?: SupportStatus): Promise<SupportMessage[]> {
  let query = supabase.from("support_messages").select("*").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return data as SupportMessage[];
}

export async function resolveSupportMessage(id: string, note: string | null): Promise<void> {
  const adminId = await getCurrentUserId();
  const { error } = await supabase
    .from("support_messages")
    .update({ status: "resolved", resolution_note: note, resolved_by: adminId, resolved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function fetchOpenSupportMessageCount(): Promise<number> {
  const { count, error } = await supabase
    .from("support_messages")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  if (error) throw error;
  return count ?? 0;
}
