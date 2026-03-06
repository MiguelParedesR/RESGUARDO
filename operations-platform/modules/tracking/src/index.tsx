import type { AuthRole } from "@ops/auth";
import { haversineDistanceMeters, isLatePing } from "@ops/tracking";

type Props = {
  role: AuthRole;
};

export function TrackingModule({ role }: Props) {
  const p1 = { lat: -12.0464, lng: -77.0428, capturedAt: new Date().toISOString() };
  const p2 = { lat: -12.0598, lng: -77.0372, capturedAt: new Date().toISOString() };
  const meters = haversineDistanceMeters(p1, p2);
  const late = isLatePing(new Date(Date.now() - 22 * 60_000).toISOString(), 15);

  return (
    <div className="grid gap-4">
      <div className="rounded-operation border border-panel-line bg-slate-950/25 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Motor Tracking</p>
        <p className="mt-2 text-sm">Rol activo: {role}</p>
        <p className="text-sm">Distancia muestra: {meters} m</p>
        <p className="text-sm">Estado ultimo ping: {late ? "ATRASADO" : "AL DIA"}</p>
      </div>
    </div>
  );
}
