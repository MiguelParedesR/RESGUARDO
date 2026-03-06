import type { AuthRole } from "@ops/auth";
import { orderAlerts } from "@ops/alerts";

type Props = {
  role: AuthRole;
};

export function AlarmSystemModule({ role }: Props) {
  const alerts = orderAlerts([
    {
      type: "panic",
      servicioId: "SVC-1001",
      message: "Boton de panico activado",
      createdAt: new Date().toISOString()
    },
    {
      type: "checkin_reminder",
      servicioId: "SVC-1002",
      message: "Pendiente de check-in",
      createdAt: new Date(Date.now() - 10 * 60_000).toISOString()
    }
  ]);

  return (
    <div className="grid gap-4">
      <div className="rounded-operation border border-panel-line bg-slate-950/25 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Centro de Alarmas</p>
        <p className="mt-2 text-sm">Visor para rol {role}</p>
      </div>

      <ul className="grid gap-3">
        {alerts.map((item) => (
          <li
            key={`${item.servicioId}-${item.type}`}
            className="rounded-operation border border-panel-line bg-slate-900/45 p-3"
          >
            <p className="text-xs uppercase tracking-[0.17em] text-rose-300">{item.type}</p>
            <p className="mt-1 text-sm">{item.message}</p>
            <p className="text-xs text-slate-300">Servicio: {item.servicioId}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
