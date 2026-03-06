import type { AuthRole, AuthStatus } from "./useAuth";

export type SessionGuardSnapshot = {
  status: AuthStatus;
  role: AuthRole;
  hasSession: boolean;
};

export type SessionGuardOptions = {
  requiredRoles?: AuthRole[];
  requiresServicioActivo?: boolean;
  loginPath?: string;
};

export type SessionGuardResult = {
  allowed: boolean;
  reason?: string;
  redirectTo?: string;
};

const DEFAULT_LOGIN = "/html/login/login.html";

export function pathForRole(role: AuthRole): string {
  if (role === "ADMIN") return "/html/dashboard/dashboard-admin.html";
  if (role === "CUSTODIA") return "/html/dashboard/custodia-registros.html";
  if (role === "CONSULTA") return "/html/dashboard/dashboard-consulta.html";
  return DEFAULT_LOGIN;
}

export function sessionGuard(
  snapshot: SessionGuardSnapshot,
  options: SessionGuardOptions = {}
): SessionGuardResult {
  const loginPath = options.loginPath || DEFAULT_LOGIN;
  const requiredRoles = options.requiredRoles || [];
  const role = snapshot.role;

  if (snapshot.status === "loading" || snapshot.status === "idle") {
    return { allowed: false, reason: "auth_loading" };
  }

  if (!snapshot.hasSession && role === "UNKNOWN") {
    return {
      allowed: false,
      reason: "missing_session",
      redirectTo: loginPath
    };
  }

  if (requiredRoles.length && !requiredRoles.includes(role)) {
    return {
      allowed: false,
      reason: "insufficient_role",
      redirectTo: pathForRole(role)
    };
  }

  if (options.requiresServicioActivo) {
    const servicioId =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("servicio_id_actual")
        : null;
    if (!servicioId) {
      return {
        allowed: false,
        reason: "missing_servicio",
        redirectTo: loginPath
      };
    }
  }

  return { allowed: true };
}
