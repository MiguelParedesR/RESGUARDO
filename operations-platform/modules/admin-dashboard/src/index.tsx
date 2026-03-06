import { OpsMap } from "@ops/maps";
import { OpsBadge } from "@ops/ui";

export function AdminDashboardModule() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-operation border border-panel-line bg-slate-950/25 p-4 md:grid-cols-3">
        <div className="rounded-md bg-slate-900/60 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Custodias activas</p>
          <p className="mt-1 text-2xl font-bold">12</p>
        </div>
        <div className="rounded-md bg-slate-900/60 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Alertas abiertas</p>
          <p className="mt-1 text-2xl font-bold">3</p>
        </div>
        <div className="rounded-md bg-slate-900/60 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Sin reporte</p>
          <p className="mt-1 text-2xl font-bold">1</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <OpsBadge tone="danger" label="PANICO" />
        <OpsBadge tone="warning" label="CHECK-IN PENDIENTE" />
        <OpsBadge tone="info" label="DESVIO RUTA" />
      </div>

      <OpsMap
        current={[-12.0464, -77.0428]}
        destination={[-12.0632, -77.035]}
        route={[
          [-12.0464, -77.0428],
          [-12.0535, -77.039],
          [-12.0598, -77.0372],
          [-12.0632, -77.035]
        ]}
      />
    </div>
  );
}
