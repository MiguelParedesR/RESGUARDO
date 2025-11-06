import { createClient } from "@supabase/supabase-js";
import { handler as sendHandler } from "./push-send.js";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  CHECKIN_THRESHOLD_MIN = "15",
  CHECKIN_REMINDER_MIN_INTERVAL = "5",
  CHECKIN_REMINDER_MAX = "3",
} = process.env;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

const json = (statusCode, payload) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

export async function handler(event) {
  if (!supabase) {
    return json(500, { error: "Supabase client not configured" });
  }

  const thresholdMinutes = Number.parseInt(CHECKIN_THRESHOLD_MIN, 10) || 15;
  const resendDelayMinutes =
    Number.parseInt(CHECKIN_REMINDER_MIN_INTERVAL, 10) || 5;
  const maxReminders = Number.parseInt(CHECKIN_REMINDER_MAX, 10) || 3;

  const now = new Date();

  const { data: services, error: svcError } = await supabase
    .from("servicio")
    .select(
      "id, empresa, placa, tipo, estado, last_checkin_at, cliente:cliente_id(nombre)"
    )
    .eq("estado", "ACTIVO");

  if (svcError) {
    return json(500, { error: svcError.message });
  }

  const affected = [];
  const failures = [];

  for (const svc of services || []) {
    try {
      const lastCheckIn = svc.last_checkin_at
        ? new Date(svc.last_checkin_at)
        : null;
      const diff = lastCheckIn
        ? minutesDiff(now, lastCheckIn)
        : thresholdMinutes + 1;
      if (diff < thresholdMinutes) continue;

      const { data: reminders, error: remErr } = await supabase
        .from("alarm_event")
        .select("id, created_at")
        .eq("servicio_id", svc.id)
        .eq("type", "checkin_reminder")
        .order("created_at", { ascending: false })
        .limit(maxReminders);

      if (remErr) throw remErr;

      const sentCount = reminders?.length || 0;
      if (sentCount >= maxReminders) continue;

      const lastReminderAt = reminders?.[0]?.created_at
        ? new Date(reminders[0].created_at)
        : null;
      if (
        lastReminderAt &&
        minutesDiff(now, lastReminderAt) < resendDelayMinutes
      ) {
        continue;
      }

      const payload = {
        title: "Confirma tu estado",
        body: `Servicio ${svc.placa || ""} - ${
          svc.cliente?.nombre || "Cliente"
        }`,
        vibrate: [200, 120, 200, 120, 240],
        data: {
          servicio_id: svc.id,
          empresa: svc.empresa,
          cliente: svc.cliente?.nombre || null,
          diff_minutes: diff,
          tipo: svc.tipo || null,
        },
        url: "/html/dashboard/mapa-resguardo.html",
      };

      const result = await sendHandler({
        httpMethod: "POST",
        body: JSON.stringify({
          filter: { role: "custodia", empresa: svc.empresa },
          type: "checkin_reminder",
          payload,
        }),
      });

      if (result.statusCode && result.statusCode >= 400) {
        throw new Error(
          `push-send responded ${result.statusCode}: ${result.body}`
        );
      }

      await supabase.from("alarm_event").insert({
        type: "checkin_reminder",
        servicio_id: svc.id,
        empresa: svc.empresa,
        cliente: svc.cliente?.nombre || null,
        placa: (svc.placa || "").toUpperCase(),
        tipo: svc.tipo || null,
        metadata: {
          reminder_index: sentCount + 1,
          diff_minutes: diff,
        },
      });
    } catch (err) {
      console.error("[push-cron-checkin] error", err);
      failures.push({ servicio_id: svc.id, error: err.message });
    }
  }

  return json(200, {
    checked: services?.length || 0,
    reminders: affected,
    failures,
  });
}

function minutesDiff(a, b) {
  return Math.round((a.getTime() - b.getTime()) / 60000);
}
