export type AlertType =
  | "panic"
  | "checkin_reminder"
  | "checkin_missed"
  | "ruta_desviada"
  | "reporte_forzado";

export type AlertRecord = {
  type: AlertType;
  servicioId: string;
  message: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export const ALERT_PRIORITY: Record<AlertType, number> = {
  panic: 100,
  reporte_forzado: 90,
  ruta_desviada: 80,
  checkin_missed: 70,
  checkin_reminder: 50
};

export function orderAlerts(records: AlertRecord[]): AlertRecord[] {
  return [...records].sort((a, b) => {
    const p = ALERT_PRIORITY[b.type] - ALERT_PRIORITY[a.type];
    if (p !== 0) return p;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}
