import { schedule } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  CHECKIN_FUNCTION_URL,
} = process.env;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

const FALLBACK_SITE = "https://resguardo.netlify.app";
const baseSite = (process.env.URL || FALLBACK_SITE).replace(/\/$/, "");
const explicitPush =
  CHECKIN_FUNCTION_URL && CHECKIN_FUNCTION_URL.trim().length
    ? CHECKIN_FUNCTION_URL.trim()
    : null;
const PUSH_URL = explicitPush || `${baseSite}/.netlify/functions/push-broadcast`;

const CHECKIN_INTERVAL_MIN = 15;
const RETRY_DELAY_MIN = 5;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = RETRY_DELAY_MIN * 60 * 1000;

function minutesAgo(min) {
  return new Date(Date.now() - min * 60 * 1000).toISOString();
}

const runCheckin = async (event) => {
  if (!supabase) {
    console.error("[checkin] Supabase no configurado");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Supabase client missing" }),
    };
  }

  const cutoff = minutesAgo(CHECKIN_INTERVAL_MIN);
  const { data: servicios, error } = await supabase
    .from("servicio")
    .select(
      "id, empresa, tipo, estado, placa, placa_upper, cliente:cliente_id(nombre), last_checkin_at, started_at"
    )
    .eq("estado", "ACTIVO")
    .not("started_at", "is", null)
    .or(`last_checkin_at.is.null,last_checkin_at.lte.${cutoff}`);

  if (error) {
    console.error("[checkin] error consultando servicios", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }

  const now = new Date();
  const candidates = (servicios || []).filter((svc) => {
    if (!svc.started_at) return false;
    if (!svc.last_checkin_at) return true;
    return new Date(svc.last_checkin_at) <= new Date(cutoff);
  });

  const attemptMap = await getLatestAttempts(candidates.map((svc) => svc.id));
  const results = [];

  for (const svc of candidates) {
    try {
      const attemptInfo = attemptMap.get(svc.id) || null;
      const attempts = Number(attemptInfo?.metadata?.attempt || 0);
      const lastAttemptAt = attemptInfo?.created_at
        ? new Date(attemptInfo.created_at)
        : null;

      if (attempts >= MAX_ATTEMPTS) {
        const alreadyMissed = await hasRecentMissed(
          svc.id,
          attemptInfo?.created_at || null
        );
        if (alreadyMissed) {
          results.push({ servicio_id: svc.id, status: "awaiting-missed" });
          continue;
        }
        await handleCheckinMissed(svc, attempts);
        results.push({ servicio_id: svc.id, status: "missed" });
        continue;
      }

      if (lastAttemptAt) {
        const diff = now.getTime() - lastAttemptAt.getTime();
        if (diff < RETRY_DELAY_MS) {
          results.push({ servicio_id: svc.id, status: "waiting" });
          continue;
        }
      }

      await sendReminder(svc, attempts + 1);
      results.push({
        servicio_id: svc.id,
        status: "sent",
        attempt: attempts + 1,
      });
    } catch (err) {
      console.error("[checkin] error servicio", svc.id, err);
      results.push({
        servicio_id: svc.id,
        status: "error",
        message: err.message,
      });
    }
  }

  const summary = results.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    },
    {}
  );
  console.log("[checkin] resumen", summary);

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, processed: results, summary }),
  };
};

async function getLatestAttempts(servicioIds) {
  const map = new Map();
  if (!servicioIds.length) return map;
  const { data, error } = await supabase
    .from("alarm_event")
    .select("servicio_id, metadata, created_at")
    .eq("type", "checkin")
    .in("servicio_id", servicioIds)
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[checkin] error leyendo intentos", error);
    return map;
  }
  for (const row of data || []) {
    if (map.has(row.servicio_id)) continue;
    map.set(row.servicio_id, row);
  }
  return map;
}

async function handleCheckinMissed(svc, attempts) {
  const metadata = {
    attempts,
    reason: "max_attempts",
  };
  const { error } = await supabase.from("alarm_event").insert({
    servicio_id: svc.id,
    type: "checkin_missed",
    empresa: svc.empresa,
    cliente: svc.cliente?.nombre || "",
    placa: svc.placa || svc.placa_upper || "",
    tipo: svc.tipo,
    metadata,
  });
  if (error) {
    console.error("[checkin] error insert checkin_missed", error);
  }
}

async function hasRecentMissed(servicioId, sinceIso) {
  let builder = supabase
    .from("alarm_event")
    .select("created_at")
    .eq("servicio_id", servicioId)
    .eq("type", "checkin_missed")
    .order("created_at", { ascending: false })
    .limit(1);
  if (sinceIso) {
    builder = builder.gte("created_at", sinceIso);
  }
  try {
    const { data, error } = await builder.maybeSingle();
    if (error && error.code !== "PGRST116") {
      console.warn("[checkin] error consultando checkin_missed", error);
    }
    return Boolean(data);
  } catch (err) {
    console.warn("[checkin] fallo lectura de checkin_missed", err);
    return false;
  }
}

async function sendReminder(svc, attempt) {
  const nextRetryAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
  const payload = {
    type: "checkin",
    servicio_id: svc.id,
    empresa: svc.empresa,
    cliente: svc.cliente?.nombre || "",
    placa: svc.placa || svc.placa_upper || "",
    tipo: svc.tipo,
    metadata: {
      attempt,
      reason: "scheduler",
    },
    audience: {
      roles: ["CUSTODIA"],
      servicio_id: svc.id,
    },
    payload: {
      title: "REPORTESE",
      body: `Servicio ${svc.placa || ""} - ${svc.cliente?.nombre || ""}`,
      requireInteraction: true,
      vibrate: [280, 140, 280, 140, 420],
      tag: `checkin-${svc.id}`,
      data: {
        url: "/html/dashboard/mapa-resguardo.html",
        metadata: {
          attempt,
          next_retry_at: nextRetryAt,
        },
      },
    },
  };

  const response = await fetch(PUSH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`push status ${response.status}: ${text}`);
  }
  await supabase.from("alarm_event").insert({
    servicio_id: svc.id,
    type: "checkin",
    empresa: svc.empresa,
    cliente: svc.cliente?.nombre || "",
    placa: svc.placa || svc.placa_upper || "",
    tipo: svc.tipo,
    metadata: { attempt, next_retry_at: nextRetryAt },
  });
}

export const handler = schedule("*/15 * * * *", runCheckin);
