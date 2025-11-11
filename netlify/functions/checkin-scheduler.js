// @hu HU-CHECKIN-15M
// Archivo recreado por HU-NO-REVERSIONES para alinear scheduler con especificación vigente 2025-02-15.

// === BEGIN HU:HU-CHECKIN-15M checkin scheduler (NO TOCAR FUERA) ===
import { schedule } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  CHECKIN_FUNCTION_URL,
  URL: SITE_URL,
} = process.env;

const FALLBACK_SITE = "https://resguardo.netlify.app";
const BASE_SITE = (SITE_URL || FALLBACK_SITE).replace(/\/$/, "");
const PUSH_URL =
  (CHECKIN_FUNCTION_URL && CHECKIN_FUNCTION_URL.trim()) ||
  `${BASE_SITE}/.netlify/functions/push-broadcast`;

const CHECKIN_INTERVAL_MIN = 15;
const RETRY_INTERVAL_MIN = 5;
const MAX_ATTEMPTS = 3;
const RETRY_INTERVAL_MS = RETRY_INTERVAL_MIN * 60 * 1000;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

const minutesAgoIso = (minutes) =>
  new Date(Date.now() - minutes * 60 * 1000).toISOString();

const stringify = (value) => (value == null ? "" : String(value));

async function fetchAttemptMap(servicioIds) {
  const map = new Map();
  if (!servicioIds.length) return map;
  const { data, error } = await supabase
    .from("alarm_event")
    .select("servicio_id, metadata, created_at")
    .eq("type", "checkin")
    .in("servicio_id", servicioIds)
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[checkin] intentos error", error);
    return map;
  }
  for (const row of data || []) {
    if (map.has(row.servicio_id)) continue;
    map.set(row.servicio_id, row);
  }
  return map;
}

async function hasRecentMissed(servicioId, sinceIso) {
  let query = supabase
    .from("alarm_event")
    .select("created_at")
    .eq("servicio_id", servicioId)
    .eq("type", "checkin_missed")
    .order("created_at", { ascending: false })
    .limit(1);
  if (sinceIso) query = query.gte("created_at", sinceIso);
  try {
    const { data, error } = await query.maybeSingle();
    if (error && error.code !== "PGRST116") {
      console.warn("[checkin] hasRecentMissed error", error);
    }
    return Boolean(data);
  } catch (err) {
    console.warn("[checkin] hasRecentMissed exception", err);
    return false;
  }
}

async function recordCheckinEvent(svc, attempt, metadataExtra = {}) {
  const metadata = {
    attempt,
    channel: "checkin",
    ...metadataExtra,
  };
  const payload = {
    servicio_id: svc.id,
    type: "checkin",
    empresa: svc.empresa,
    cliente: svc.cliente?.nombre || "",
    placa: svc.placa || svc.placa_upper || "",
    tipo: svc.tipo || "",
    metadata,
  };
  const { error } = await supabase.from("alarm_event").insert(payload);
  if (error) console.error("[checkin] insertar checkin fallo", error);
}

async function recordMissedEvent(svc, attempts) {
  const metadata = {
    attempts,
    channel: "checkin",
    reason: "max_attempts",
  };
  const payload = {
    servicio_id: svc.id,
    type: "checkin_missed",
    empresa: svc.empresa,
    cliente: svc.cliente?.nombre || "",
    placa: svc.placa || svc.placa_upper || "",
    tipo: svc.tipo || "",
    metadata,
  };
  const { error } = await supabase.from("alarm_event").insert(payload);
  if (error) console.error("[checkin] insertar missed fallo", error);
}

async function sendReminder(svc, attempt) {
  const metadata = {
    attempt,
    origin: "scheduler",
    next_retry_at: minutesAgoIso(-RETRY_INTERVAL_MIN),
  };
  const body = {
    type: "checkin",
    servicio_id: svc.id,
    empresa: svc.empresa,
    cliente: svc.cliente?.nombre || "",
    placa: svc.placa || svc.placa_upper || "",
    tipo: svc.tipo || "",
    metadata,
    audience: {
      roles: ["CUSTODIA"],
      servicio_id: svc.id,
    },
    payload: {
      title: "REPORTESE",
      body: `Servicio ${stringify(svc.placa)} – ${stringify(
        svc.cliente?.nombre || ""
      )}`,
      icon: "/assets/icon-192.svg",
      badge: "/assets/icon-192.svg",
      requireInteraction: true,
      vibrate: [220, 120, 220, 120, 350],
      tag: `checkin-${svc.id}`,
      actions: [
        { action: "open", title: "Abrir Check-in" },
        { action: "silence", title: "Silenciar" },
      ],
      data: {
        url: "/html/dashboard/mapa-resguardo.html",
      },
    },
  };
  const response = await fetch(PUSH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`push status ${response.status} ${text}`);
  }
  console.log(
    `[checkin][scheduler] push enviado servicio=${svc.id} intento=${attempt}`
  );
  await recordCheckinEvent(svc, attempt, metadata);
}

async function runScheduler() {
  console.log("[task][HU-CHECKIN-15M] start");
  if (!supabase) {
    console.error("[checkin] Supabase no configurado");
    return { statusCode: 500, body: JSON.stringify({ error: "no-client" }) };
  }

  const cutoffIso = minutesAgoIso(CHECKIN_INTERVAL_MIN);
  const { data: servicios, error } = await supabase
    .from("servicio")
    .select(
      "id, empresa, tipo, estado, placa, placa_upper, cliente:cliente_id(nombre), last_checkin_at, started_at"
    )
    .eq("estado", "ACTIVO")
    .not("started_at", "is", null)
    .or(`last_checkin_at.is.null,last_checkin_at.lte.${cutoffIso}`);

  if (error) {
    console.error("[checkin] consulta error", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }

  const candidates = (servicios || []).filter((svc) => {
    if (!svc.started_at) return false;
    if (!svc.last_checkin_at) return true;
    return new Date(svc.last_checkin_at) <= new Date(cutoffIso);
  });

  const attemptMap = await fetchAttemptMap(candidates.map((svc) => svc.id));
  const now = Date.now();
  const results = [];

  for (const svc of candidates) {
    const attemptInfo = attemptMap.get(svc.id) || null;
    const attempts = Number(attemptInfo?.metadata?.attempt || 0);
    const lastAttemptAt = attemptInfo?.created_at
      ? new Date(attemptInfo.created_at).getTime()
      : null;

    try {
      if (attempts >= MAX_ATTEMPTS) {
        const alreadyMissed = await hasRecentMissed(
          svc.id,
          attemptInfo?.created_at || null
        );
        if (!alreadyMissed) {
          await recordMissedEvent(svc, attempts);
          results.push({ servicio_id: svc.id, status: "missed" });
        } else {
          results.push({ servicio_id: svc.id, status: "awaiting-missed" });
        }
        continue;
      }

      if (lastAttemptAt && now - lastAttemptAt < RETRY_INTERVAL_MS) {
        results.push({ servicio_id: svc.id, status: "waiting" });
        continue;
      }

      await sendReminder(svc, attempts + 1);
      results.push({
        servicio_id: svc.id,
        status: "sent",
        attempt: attempts + 1,
      });
    } catch (err) {
      console.error("[checkin] servicio error", svc.id, err);
      results.push({
        servicio_id: svc.id,
        status: "error",
        message: err.message,
      });
    }
  }

  const summary = results.reduce((acc, curr) => {
    acc[curr.status] = (acc[curr.status] || 0) + 1;
    return acc;
  }, {});

  console.log("[checkin] resumen", summary);
  console.log("[task][HU-CHECKIN-15M] done", summary);
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, processed: results, summary }),
  };
}

export const handler = schedule("*/15 * * * *", runScheduler);
// === END HU:HU-CHECKIN-15M ===
