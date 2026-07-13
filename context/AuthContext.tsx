import { createContext, useContext, useEffect, useState, PropsWithChildren } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { fetchMyProfile, createProfile } from "../lib/profiles";
import { consumePendingUsername } from "../lib/pendingUsername";
import { clearWatchingSnapshot } from "../lib/watchingSnapshot";
import { clearAllShowDataCaches } from "../lib/showDataCache";
import { resetPrefetchState } from "../lib/backgroundPrefetch";
import { clearLocalShowStats } from "../lib/showStats";
import { clearProfileSnapshot } from "../lib/profileSnapshot";
import { clearLocalStreakData } from "../lib/streaks";
import { alert } from "../lib/alert";

// None of these caches' storage keys are scoped by user id (see each
// module's own comment) — without clearing them here, signing into a
// different account on the same device would briefly (or, if the fresh
// fetch is slow/fails, not-so-briefly) show the previous account's shows,
// watched status, etc. straight from disk.
function clearUserScopedCaches() {
  clearWatchingSnapshot();
  clearAllShowDataCaches();
  resetPrefetchState();
  clearLocalShowStats();
  clearProfileSnapshot();
  clearLocalStreakData();
}

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  // True once the post-login initial data (e.g. the Shows tab's tracked
  // shows) has loaded at least once — lets the root splash screen stay up
  // until there's actually something to show, not just until the session
  // check resolves. Reset to false on sign-out so the next login shows the
  // splash again instead of reusing a stale "ready" flag.
  dataReady: boolean;
  setDataReady: (ready: boolean) => void;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: true,
  dataReady: false,
  setDataReady: () => {},
});

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataReady, setDataReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (!newSession) {
        setDataReady(false);
        clearUserScopedCaches();
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // Soft ban check — is_banned (see supabase/schema.sql) is enforced here
  // rather than at the auth layer, since there's no server-side session
  // revocation set up: a banned account's session stays technically valid,
  // this just signs it back out immediately on the next app open/session
  // check, same as any other client-side gate in this app.
  useEffect(() => {
    if (!session) return;
    let active = true;
    fetchMyProfile().then((profile) => {
      if (!active || !profile?.is_banned) return;
      // Hardcoded, not lib/i18n's t() — LanguageProvider is mounted *inside*
      // AuthProvider (see app/_layout.tsx), so this runs before it's
      // available, same reasoning as ErrorBoundary's own fixed copy.
      alert("Account suspended", "This account has been suspended for violating community guidelines.");
      supabase.auth.signOut();
    });
    return () => {
      active = false;
    };
  }, [session]);

  // Finishes provisioning the profile row for an account that signed up
  // needing email confirmation (see app/(auth)/signup.tsx and
  // lib/pendingUsername.ts) — signUp() had no session yet to attach the
  // typed username to at that point, so it was stashed locally instead.
  // First real session on this device (confirming the email, then logging
  // in) is what completes it; a no-op for every other login since there's
  // nothing pending by then.
  useEffect(() => {
    if (!session) return;
    let active = true;
    (async () => {
      const pendingUsername = await consumePendingUsername();
      if (!pendingUsername || !active) return;
      const existing = await fetchMyProfile();
      if (existing) return;
      await createProfile(pendingUsername).catch(() => {});
    })();
    return () => {
      active = false;
    };
  }, [session]);

  return (
    <AuthContext.Provider value={{ session, loading, dataReady, setDataReady }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
