import {
  createContext,
  PropsWithChildren,
  useContext,
  useEffect,
  useMemo
} from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase } from "@ops/supabase";
import { useAuthStore, type AuthStatus } from "./useAuth";

type AuthContextValue = {
  initialized: boolean;
  status: AuthStatus;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const initialized = useAuthStore((s) => s.initialized);
  const status = useAuthStore((s) => s.status);
  const hydrateFromSupabase = useAuthStore((s) => s.hydrateFromSupabase);
  const syncFromSession = useAuthStore((s) => s.syncFromSession);

  useEffect(() => {
    void hydrateFromSupabase();
  }, [hydrateFromSupabase]);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        syncFromSession(session);
      }
    );
    return () => {
      data.subscription.unsubscribe();
    };
  }, [syncFromSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      initialized,
      status
    }),
    [initialized, status]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthProvider() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthProvider must be used within AuthProvider");
  }
  return context;
}
