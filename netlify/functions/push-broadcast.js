import { handler as sendHandler } from "./push-send.js";

const ALLOWED_TYPES = new Set(["start", "panic", "checkin", "heartbeat"]);
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
  const empresa = raw.empresa || fallbackEmpresa || null;
  return { roles, empresa };
}

const buildDefaultPayload = (type, event) => {
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

  const sendRequest = {
    audience: audiencePayload,
    type: normalizedType,
    event: eventPayload,
    payload: composedPayload,
    options: options && typeof options === "object" ? options : undefined,
  };

  let response;
  try {
    response = await sendHandler({
      httpMethod: "POST",
      body: JSON.stringify(sendRequest),
    });
  } catch (err) {
    console.error("[push-broadcast] sendHandler failure", err);
    return json(502, {
      ok: false,
      error: "push-send internal failure",
      details: err?.message || String(err),
    });
  }

  let resultBody = {};
  try {
    resultBody = JSON.parse(response.body || "{}");
  } catch (_) {
    resultBody = { raw: response.body };
  }

  const statusCode = response.statusCode || 500;
  return json(
    statusCode,
    {
      ok: statusCode < 400,
      ...resultBody,
      event: eventPayload,
      audience: audiencePayload,
    },
    response.headers || {}
  );
}
