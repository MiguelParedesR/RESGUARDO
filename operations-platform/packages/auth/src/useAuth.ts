import { create } from "zustand";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@ops/supabase";

const LEGACY_BRIDGE_MARKER = "ops_auth_bridge_active";

export type AuthRole = "ADMIN" | "CUSTODIA" | "CONSULTA" | "UNKNOWN";
export type AuthStatus =
  | "idle"
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "error";

export type AuthUser = {
  id: string;
  email: string | null;
  role: AuthRole;
  empresa: string | null;
};

type AuthState = {
  status: AuthStatus;
  initialized: boolean;
  session: Session | null;
  user: User | null;
  profile: AuthUser | null;
  role: AuthRole;
  empresa: string | null;
  error: string | null;
  bridgeLegacySession: boolean;
  hydrateFromSupabase: () => Promise<void>;
  syncFromSession: (session: Session | null) => void;
  signInWithPassword: (payload: {
    email: string;
    password: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  setBridgeLegacySession: (enabled: boolean) => void;
};

function readLegacyRole(): AuthRole {
  if (typeof window === "undefined") return "UNKNOWN";
  const raw = (window.sessionStorage.getItem("auth_role") || "").toUpperCase();
  return normalizeRole(raw);
}

function readLegacyEmpresa(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem("auth_empresa");
}

function resolveRoleFromUser(user: User | null): AuthRole {
  if (!user) return readLegacyRole();
  const metaRole =
    user.user_metadata?.role ??
    user.user_metadata?.auth_role ??
    user.app_metadata?.role ??
    user.app_metadata?.auth_role ??
    null;
  if (typeof metaRole === "string") {
    return normalizeRole(metaRole);
  }
  return readLegacyRole();
}

function resolveEmpresaFromUser(user: User | null): string | null {
  if (!user) return readLegacyEmpresa();
  const metaEmpresa =
    user.user_metadata?.empresa ??
    user.user_metadata?.auth_empresa ??
    user.app_metadata?.empresa ??
    null;
  if (typeof metaEmpresa === "string" && metaEmpresa.trim()) {
    return metaEmpresa.trim();
  }
  return readLegacyEmpresa();
}

function normalizeSessionPayload(session: Session | null): {
  session: Session | null;
  user: User | null;
  role: AuthRole;
  empresa: string | null;
  profile: AuthUser | null;
  status: AuthStatus;
} {
  const user = session?.user ?? null;
  const role = resolveRoleFromUser(user);
  const empresa = resolveEmpresaFromUser(user);
  const profile = user
    ? {
        id: user.id,
        email: user.email ?? null,
        role,
        empresa
      }
    : null;
  return {
    session,
    user,
    role,
    empresa,
    profile,
    status: user ? "authenticated" : "unauthenticated"
  };
}

function syncLegacySessionBridge(
  enabled: boolean,
  session: Session | null,
  role: AuthRole,
  empresa: string | null,
  userId: string | null
) {
  if (typeof window === "undefined") return;
  if (!enabled) return;

  if (session?.user) {
    window.sessionStorage.setItem(LEGACY_BRIDGE_MARKER, "1");
    window.sessionStorage.setItem("auth_role", role);
    window.sessionStorage.setItem("auth_usuario_id", userId || "");
    if (empresa) {
      window.sessionStorage.setItem("auth_empresa", empresa);
    } else {
      window.sessionStorage.removeItem("auth_empresa");
    }
    return;
  }

  if (window.sessionStorage.getItem(LEGACY_BRIDGE_MARKER) === "1") {
    window.sessionStorage.removeItem("auth_role");
    window.sessionStorage.removeItem("auth_usuario_id");
    window.sessionStorage.removeItem("auth_empresa");
    window.sessionStorage.removeItem(LEGACY_BRIDGE_MARKER);
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "idle",
  initialized: false,
  session: null,
  user: null,
  profile: null,
  role: readLegacyRole(),
  empresa: readLegacyEmpresa(),
  error: null,
  bridgeLegacySession: true,

  hydrateFromSupabase: async () => {
    set({ status: "loading", error: null });
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        set({
          status: "error",
          error: error.message,
          initialized: true
        });
        return;
      }
      get().syncFromSession(data.session ?? null);
      set({ initialized: true });
    } catch (error) {
      set({
        status: "error",
        initialized: true,
        error: error instanceof Error ? error.message : "auth_hydration_failed"
      });
    }
  },

  syncFromSession: (session) => {
    const normalized = normalizeSessionPayload(session);
    syncLegacySessionBridge(
      get().bridgeLegacySession,
      normalized.session,
      normalized.role,
      normalized.empresa,
      normalized.user?.id ?? null
    );
    set({
      ...normalized,
      error: null
    });
  },

  signInWithPassword: async ({ email, password }) => {
    set({ status: "loading", error: null });
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    if (error) {
      set({
        status: "error",
        error: error.message,
        session: null,
        user: null,
        profile: null
      });
      return { ok: false, error: error.message };
    }
    get().syncFromSession(data.session ?? null);
    return { ok: true };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    get().syncFromSession(null);
  },

  setBridgeLegacySession: (enabled) => {
    set({ bridgeLegacySession: enabled });
  }
}));

export function normalizeRole(roleRaw: string | null | undefined): AuthRole {
  const role = (roleRaw || "").toUpperCase().trim();
  if (role === "ADMIN") return "ADMIN";
  if (role === "CUSTODIA") return "CUSTODIA";
  if (role === "CONSULTA") return "CONSULTA";
  return "UNKNOWN";
}

export function useAuth() {
  return useAuthStore((state) => ({
    status: state.status,
    initialized: state.initialized,
    session: state.session,
    user: state.user,
    profile: state.profile,
    role: state.role,
    empresa: state.empresa,
    error: state.error,
    bridgeLegacySession: state.bridgeLegacySession,
    hydrateFromSupabase: state.hydrateFromSupabase,
    syncFromSession: state.syncFromSession,
    signInWithPassword: state.signInWithPassword,
    signOut: state.signOut,
    setBridgeLegacySession: state.setBridgeLegacySession
  }));
}
