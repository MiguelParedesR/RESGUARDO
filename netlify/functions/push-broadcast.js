// @hu HU-NO400-ALARM_EVENT
// @author Codex
// @date 2025-02-15
// @rationale Validar payloads y respuestas del broadcast.

// === BEGIN HU:HU-NO400-ALARM_EVENT broadcast (no tocar fuera) ===
import { handler as sendHandler } from "./push-send.js";

const ALLOWED_TYPES = new Set([
  "start",
  "panic",
  "checkin",
  "heartbeat",
  "ruta_desviada",
]);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (statusCode, payload, extraHeaders = {}) => ({
  statusCode,
  headers: {
    ...corsHeaders,
    ...extraHeaders,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

const ensureObject = (value, fallback = {}) => {
  if (value == null) return { ...fallback };
  return typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : { ...fallback };
};

function normaliseAudience(audience, fallbackEmpresa) {
  const raw = ensureObject(audience);
  const rolesRaw = raw.roles ?? raw.role;
  let roles = Array.isArray(rolesRaw) ? rolesRaw : rolesRaw ? [rolesRaw] : [];
  roles = roles.filter(Boolean).map((r) => String(r).toUpperCase());
  if (!roles.length) roles = ["ADMIN"];
  const hasEmpresa = Object.prototype.hasOwnProperty.call(raw, "empresa");
  const empresa = hasEmpresa ? raw.empresa ?? null : fallbackEmpresa || null;
  return { roles, empresa };
}

const buildDefaultPayload = (type, event) => {
  if (type === "ruta_desviada") {
    const clienteLabel = event?.cliente || "este cliente";
    const title = `DESVÍO DE RUTA – ${clienteLabel}`;
    const base = {
      title,
      body: `La custodia se ha desviado de la ruta establecida para ${clienteLabel}.`,
      icon: "/assets/icon-192.svg",
      badge: "/assets/icon-192.svg",
      tag: `ruta-desviada-${event?.servicio_id || "servicio"}`,
      vibrate: [300, 150, 300, 150, 500],
      requireInteraction: true,
      renotify: true,
      data: {
        servicio_id: event?.servicio_id || null,
        url_admin: "/html/dashboard/dashboard-admin.html",
        url_custodia: "/html/dashboard/mapa-resguardo.html",
      },
    };
    if (event?.metadata) {
      base.data.metadata = event.metadata;
    }
    if (event?.empresa) base.data.empresa = event.empresa;
    if (event?.cliente) base.data.cliente = event.cliente;
    return base;
  }

  const prefix =
    type === "panic"
      ? "ALERTA DE PANICO"
      : type === "start"
      ? "Inicio de servicio"
      : type === "checkin"
      ? "Check-in requerido"
      : "Movimiento en servicio";
  const title = `${prefix}${event?.cliente ? ` - ${event.cliente}` : ""}`;
  const base = {
    title,
    body: event?.placa
      ? `Placa ${event.placa} (${event?.tipo || "Servicio"})`
      : "Revisa el panel para detalles.",
    data: {
      servicio_id: event?.servicio_id || null,
    },
    requireInteraction: true,
  };
  if (event?.metadata) {
    base.data.metadata = event.metadata;
  }
  if (event?.empresa) base.data.empresa = event.empresa;
  if (event?.cliente) base.data.cliente = event.cliente;
  return base;
};

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method Not Allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (err) {
    return json(400, { error: "Invalid JSON body" });
  }

  const {
    type,
    servicio_id: servicioId,
    empresa,
    cliente,
    placa,
    tipo,
    lat,
    lng,
    direccion,
    metadata,
    audience,
    payload,
    options,
  } = body || {};

  const normalizedType = typeof type === "string" ? type.toLowerCase() : "";
  if (!ALLOWED_TYPES.has(normalizedType)) {
    return json(400, {
      error: `Invalid type. Expected one of ${Array.from(ALLOWED_TYPES).join(
        ", "
      )}`,
    });
  }

  if (!servicioId || !empresa || !cliente || !placa || !tipo) {
    return json(400, {
      error:
        "Missing required fields (servicio_id, empresa, cliente, placa, tipo).",
    });
  }

  if (
    metadata != null &&
    (typeof metadata !== "object" || Array.isArray(metadata))
  ) {
    return json(400, { error: "metadata must be an object if provided." });
  }

  const eventPayload = {
    type: normalizedType,
    servicio_id: String(servicioId),
    empresa: String(empresa),
    cliente: String(cliente),
    placa: String(placa),
    tipo: String(tipo),
    lat: typeof lat === "number" ? lat : null,
    lng: typeof lng === "number" ? lng : null,
    direccion: direccion != null ? String(direccion) : null,
    metadata: ensureObject(metadata),
    timestamp: new Date().toISOString(),
  };

  const audiencePayload = normaliseAudience(audience, eventPayload.empresa);
  const defaultPayload = buildDefaultPayload(normalizedType, eventPayload);
  const composedPayload = {
    ...defaultPayload,
    ...(payload && typeof payload === "object" ? payload : {}),
    data: {
      ...defaultPayload.data,
      ...ensureObject(payload?.data),
      type: normalizedType,
      event: eventPayload,
    },
  };

  const baseRequest = {
    type: normalizedType,
    event: eventPayload,
    payload: composedPayload,
    options: options && typeof options === "object" ? options : undefined,
  };

  const targetAudiences = buildAudiencesForType(
    normalizedType,
    audiencePayload,
    eventPayload
  );

  const deliveries = [];
  let totalSent = 0;
  let totalFailed = 0;
  let totalDeactivated = 0;
  const errors = [];
  let worstStatus = 200;

  for (const aud of targetAudiences) {
    const requestPayload = { ...baseRequest, audience: aud };
    let response;
    try {
      response = await sendHandler({
        httpMethod: "POST",
        body: JSON.stringify(requestPayload),
      });
    } catch (err) {
      console.error("[push] sendHandler failure", err);
      errors.push({ audience: aud, error: err?.message || String(err) });
      deliveries.push({
        audience: aud,
        statusCode: 502,
        body: { error: "push-send internal failure" },
      });
      worstStatus = Math.max(worstStatus, 502);
      continue;
    }

    let body = {};
    try {
      body = JSON.parse(response.body || "{}");
    } catch (_) {
      body = { raw: response.body };
    }

    const statusCode = response.statusCode || 500;
    worstStatus = Math.max(worstStatus, statusCode);
    deliveries.push({ audience: aud, statusCode, body });
    totalSent += Number(body.sent) || 0;
    totalFailed += Number(body.failed) || 0;
    totalDeactivated += Number(body.deactivated) || 0;
    if (statusCode >= 400) {
      errors.push({
        audience: aud,
        error: body.error || "push-send error",
      });
    }
  }

  const finalStatus =
    errors.length && worstStatus >= 400 ? worstStatus : 200;

  const responseBody = {
    ok: errors.length === 0,
    sent: totalSent,
    failed: totalFailed,
    deactivated: totalDeactivated,
    deliveries,
    errors,
    event: eventPayload,
  };
  return json(finalStatus, responseBody);
}

function buildAudiencesForType(type, baseAudience, eventPayload) {
  if (type !== "ruta_desviada") return [baseAudience];
  const extras = [
    baseAudience,
    {
      roles: ["ADMIN"],
      empresa: eventPayload?.empresa || null,
    },
    eventPayload?.servicio_id
      ? {
          roles: ["CUSTODIA"],
          servicio_id: eventPayload.servicio_id,
        }
      : null,
  ];
  return dedupeAudiences(extras);
}

function dedupeAudiences(list) {
  const seen = new Set();
  const result = [];
  for (const aud of list) {
    if (!aud) continue;
    const normalized = normalizeAudienceShape(aud);
    const key = JSON.stringify(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function normalizeAudienceShape(audience) {
  const roles = Array.isArray(audience.roles)
    ? audience.roles.map((r) => String(r).toUpperCase())
    : audience.role
    ? [String(audience.role).toUpperCase()]
    : ["ADMIN"];
  const normalized = { roles: Array.from(new Set(roles)) };
  if (Object.prototype.hasOwnProperty.call(audience, "empresa")) {
    normalized.empresa = audience.empresa ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(audience, "servicio_id")) {
    normalized.servicio_id = audience.servicio_id ?? null;
  }
  return normalized;
}
// === END HU:HU-NO400-ALARM_EVENT ===
