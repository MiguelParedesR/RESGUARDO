// @hu HU-NO400-ALARM_EVENT
// @author Codex
// @date 2025-02-15
// @rationale Gestionar envios push con trazas consistentes.

// === BEGIN HU:HU-NO400-ALARM_EVENT push send (no tocar fuera) ===
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WEB_PUSH_CONTACT } =
  process.env;

const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY || process.env.WEB_PUSH_PUBLIC_KEY;
const VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY || process.env.WEB_PUSH_PRIVATE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("[push] Missing Supabase credentials");
}

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    WEB_PUSH_CONTACT || "mailto:soporte@tpp.com",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
} else {
  console.warn(
    "[push] VAPID keys are not configured. Notifications will fail."
  );
}

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

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

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method Not Allowed" });
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return json(500, { error: "VAPID keys not configured" });
  }

  if (!supabase) {
    return json(500, { error: "Supabase client not configured" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (_err) {
    return json(400, { error: "Invalid JSON body" });
  }

  const {
    audience,
    filter,
    subscriptionIds,
    endpoints,
    payload,
    type,
    event: eventData,
    options,
  } = body || {};

  const queryBuild = await buildSubscriptionQuery({
    audience,
    filter,
    subscriptionIds,
    endpoints,
  });
  if (queryBuild.error) {
    return json(queryBuild.error.status, { error: queryBuild.error.message });
  }

  const { data: subscriptions, error: queryError } = await queryBuild.builder;
  if (queryError) {
    return json(500, { error: queryError.message });
  }

  if (!subscriptions || !subscriptions.length) {
    return json(200, {
      ok: true,
      sent: 0,
      failed: 0,
      deactivated: 0,
      results: [],
    });
  }

  const pushPayload = buildPushPayload(type, payload, eventData);
  const sendOptions = buildSendOptions(options);
  const nowIso = new Date().toISOString();

  const deliveryResults = await Promise.allSettled(
    subscriptions.map((row) =>
      webpush.sendNotification(
        toPushSubscription(row),
        JSON.stringify(pushPayload),
        sendOptions
      )
    )
  );

  const details = [];
  const succeededIds = [];
  const failedIds = [];
  let failed = 0;
  let deactivated = 0;

  for (let index = 0; index < deliveryResults.length; index++) {
    const outcome = deliveryResults[index];
    const row = subscriptions[index];
    if (outcome.status === "fulfilled") {
      succeededIds.push(row.id);
      details.push({
        id: row.id,
        endpoint: row.endpoint,
        status: "sent",
      });
    } else {
      failed += 1;
      const statusCode =
        outcome.reason?.statusCode || outcome.reason?.status || null;
      const shouldDeactivate = statusCode === 404 || statusCode === 410;
      if (shouldDeactivate) {
        deactivated += 1;
        failedIds.push(row.id);
      }

      details.push({
        id: row.id,
        endpoint: row.endpoint,
        status: "failed",
        error:
          outcome.reason?.body || outcome.reason?.message || "Unknown error",
        statusCode,
      });
    }
  }

  if (succeededIds.length) {
    await supabase
      .from("push_subscription")
      .update({ last_seen_at: nowIso, is_active: true })
      .in("id", succeededIds);
  }

  if (failedIds.length) {
    await supabase
      .from("push_subscription")
      .update({ is_active: false, last_seen_at: nowIso })
      .in("id", failedIds);
  }

  return json(200, {
    ok: true,
    sent: subscriptions.length - failed,
    failed,
    deactivated,
    results: details,
  });
}

async function buildSubscriptionQuery({
  audience,
  filter,
  subscriptionIds,
  endpoints,
}) {
  let builder = supabase
    .from("push_subscription")
    .select("*")
    .eq("is_active", true);

  if (Array.isArray(subscriptionIds) && subscriptionIds.length) {
    builder = builder.in("id", subscriptionIds);
    return { builder };
  }

  if (Array.isArray(endpoints) && endpoints.length) {
    builder = builder.in("endpoint", endpoints);
    return { builder };
  }

  const effective = audience || filter;
  if (!effective || typeof effective !== "object") {
    return {
      error: {
        status: 400,
        message: "Audience, filter, subscriptionIds or endpoints required.",
      },
    };
  }

  const rolesRaw = effective.roles ?? effective.role;
  if (Array.isArray(rolesRaw) && rolesRaw.length) {
    builder = builder.in(
      "role",
      rolesRaw.map((r) => String(r).toUpperCase())
    );
  } else if (rolesRaw) {
    builder = builder.eq("role", String(rolesRaw).toUpperCase());
  }

  if (effective.empresa) {
    builder = builder.eq("empresa", effective.empresa);
  }

  if (effective.servicio_id) {
    builder = builder.eq("servicio_id", effective.servicio_id);
  }

  return { builder };
}

function buildPushPayload(type, payload = {}, eventData = null) {
  const kind = typeof type === "string" ? type : "alerta";
  const defaultTitle = (() => {
    if (kind === "panic") return "Alertas de panico";
    if (kind === "start") return "Inicio de servicio";
    if (kind === "checkin") return "Recordatorio de check-in";
    if (kind === "heartbeat") return "Actualizacion de servicio";
    return "Notificacion de resguardo";
  })();
  const defaultBody = (() => {
    if (kind === "panic")
      return "Se detecto boton de panico. Revisa el panel de monitoreo.";
    if (kind === "start") return "Un servicio acaba de iniciar.";
    if (kind === "checkin") return "Han pasado varios minutos sin check-in.";
    if (kind === "heartbeat") return "Nuevo evento en el servicio.";
    return "Tienes una nueva alerta de custodia.";
  })();

  const dataPayload = {
    ...ensureObject(payload.data),
    type: kind,
    event: eventData || null,
  };

  return {
    title: payload.title || defaultTitle,
    body: payload.body || defaultBody,
    icon: payload.icon || "/assets/icon-192.svg",
    badge: payload.badge || "/assets/icon-192.svg",
    requireInteraction: payload.requireInteraction ?? true,
    renotify: payload.renotify ?? true,
    vibrate: payload.vibrate || [220, 120, 220],
    tag: payload.tag || `alarma-${kind}`,
    data: dataPayload,
    url: payload.url || "/html/dashboard/dashboard-admin.html",
    actions:
      Array.isArray(payload.actions) && payload.actions.length
        ? payload.actions
        : defaultActions(kind),
  };
}

function buildSendOptions(options = {}) {
  const base = {};
  if (options && typeof options === "object") {
    if (options.ttl) base.TTL = options.ttl;
    if (options.urgency) base.urgency = options.urgency;
  }
  return base;
}

function defaultActions(type) {
  const actions = [{ action: "open", title: "Abrir" }];
  if (type === "panic") {
    actions.push({ action: "silence", title: "Silenciar" });
  }
  return actions;
}

function toPushSubscription(row) {
  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth,
    },
  };
}

function ensureObject(value) {
  if (value == null) return {};
  if (typeof value === "object" && !Array.isArray(value)) return { ...value };
  return {};
}

// === END HU:HU-NO400-ALARM_EVENT ===
