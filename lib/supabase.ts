import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert } from "react-native";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Set by LanguageProvider (lib/i18n.tsx) whenever the user's language
// changes. Read directly rather than imported from lib/i18n.tsx, since that
// file imports lib/userSettings.ts which imports this file — importing it
// back here would be a circular dependency.
type AlertLanguage = "en" | "fr";
let alertLanguage: AlertLanguage = "en";
export function setSupabaseAlertLanguage(lang: AlertLanguage) {
  alertLanguage = lang;
}

const WRITE_FAILED_TEXT: Record<AlertLanguage, { title: string; message: string }> = {
  en: { title: "Couldn't save", message: "Check your connection and try again." },
  fr: { title: "Échec de l'enregistrement", message: "Vérifie ta connexion et réessaie." },
};

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const MAX_WRITE_RETRIES = 2;

function backoffDelay(attempt: number) {
  return Math.min(500 * 2 ** attempt, 4000);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// supabase-js has no retry of its own: a POST/PATCH/PUT/DELETE that hits a
// dropped connection or a transient 5xx just fails outright, and most call
// sites in this app fire a write straight from onPress with no try/catch —
// so a blip that would have resolved itself a second later previously just
// silently dropped the user's action. This wraps every request the client
// makes (auth, postgrest, storage, realtime all share this fetch) and gives
// writes specifically a couple of quick backed-off retries. GETs and
// definitive 4xx responses (validation, RLS, conflicts) pass straight
// through untouched — retrying those wouldn't help, and some call sites
// already rely on specific 4xx behavior (e.g. unique-constraint conflicts).
async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const isWrite = WRITE_METHODS.has(method);
  let attempt = 0;

  while (true) {
    try {
      const res = await fetch(input, init);
      if (isWrite && res.status >= 500 && attempt < MAX_WRITE_RETRIES) {
        attempt++;
        await sleep(backoffDelay(attempt));
        continue;
      }
      if (isWrite && res.status >= 500) {
        notifyWriteFailed();
      }
      return res;
    } catch (err) {
      // Network-level failure (offline, DNS hiccup, timeout) — fetch throws
      // rather than resolving with a bad status in this case.
      if (isWrite && attempt < MAX_WRITE_RETRIES) {
        attempt++;
        await sleep(backoffDelay(attempt));
        continue;
      }
      if (isWrite) notifyWriteFailed();
      throw err;
    }
  }
}

function notifyWriteFailed() {
  const { title, message } = WRITE_FAILED_TEXT[alertLanguage];
  Alert.alert(title, message);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: resilientFetch,
  },
});

// supabase.auth.getUser() does a real network round-trip every time (it
// re-verifies the JWT with the auth server) — fine for a one-off sensitive
// check, but most call sites just want "my own id" to filter a query, which
// RLS enforces server-side regardless. onAuthStateChange fires once on init
// and again on every sign-in/out/refresh, so caching its session here gives
// every caller the current user id for free instead of paying a network
// round trip on every single query (this mattered a lot for a Watch List
// fetching 200+ shows, one redundant auth call per show).
let cachedUserId: string | null | undefined;
// Single-flights the very first getSession() call: before cachedUserId is
// warm, a Watch List load can fire 10+ concurrent getCurrentUserId() calls
// (one per in-flight show) within the same tick. Without this, each of them
// would start its own supabase.auth.getSession() call, and piling that many
// concurrent calls onto supabase-js's internal auth lock is what caused
// several of them to hang indefinitely — the Watch List loaded its first
// handful of shows and then silently stalled forever. Sharing one in-flight
// promise means only one getSession() call ever happens, no matter how many
// callers ask for it before it resolves.
let inFlightSession: Promise<string | undefined> | null = null;

supabase.auth.onAuthStateChange((_event, session) => {
  cachedUserId = session?.user?.id ?? null;
});

export async function getCurrentUserId(): Promise<string | undefined> {
  if (cachedUserId !== undefined) return cachedUserId ?? undefined;
  if (!inFlightSession) {
    inFlightSession = supabase.auth
      .getSession()
      .then(({ data }) => {
        cachedUserId = data.session?.user?.id ?? null;
        return cachedUserId ?? undefined;
      })
      .finally(() => {
        inFlightSession = null;
      });
  }
  return inFlightSession;
}
