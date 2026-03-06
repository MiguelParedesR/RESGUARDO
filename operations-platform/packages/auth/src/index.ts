export type Role = "ADMIN" | "CUSTODIA";

export type SessionSnapshot = {
  role: Role;
  empresa: string | null;
  servicioId: string | null;
};

export function parseLegacySession(storage: Storage): SessionSnapshot {
  const roleRaw = (storage.getItem("auth_role") || "").toUpperCase();
  const role: Role = roleRaw === "CUSTODIA" ? "CUSTODIA" : "ADMIN";
  return {
    role,
    empresa: storage.getItem("auth_empresa"),
    servicioId: storage.getItem("servicio_id_actual")
  };
}
