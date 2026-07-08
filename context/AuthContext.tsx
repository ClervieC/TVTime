import { createContext, useContext, useEffect, useState, PropsWithChildren } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

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
      if (!newSession) setDataReady(false);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading, dataReady, setDataReady }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
