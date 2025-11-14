// === BEGIN HU:HU-RUTA-DESVIO-BACKEND ===
import { createClient } from "@supabase/supabase-js";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  RUTA_DESVIO_LOOKBACK_MIN = "20",
  RUTA_DESVIO_REQUIRED_PINGS = "3",
  RUTA_DESVIO_POINT_LIMIT = "6",
  RUTA_DESVIO_EVENT_COOLDOWN_MIN = "10",
  RUTA_DESVIO_MAX_SERVICIOS = "100",
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

const EARTH_RADIUS_M = 6_371_000;
const DEG2RAD = Math.PI / 180;
const DEFAULT_TOLERANCIA = 120;

export async function handler(event) {
  if (!supabase) {
    return json(500, { error: "Supabase client not configured" });
  }

  const lookbackMinutes = toPositiveInt(RUTA_DESVIO_LOOKBACK_MIN, 20);
  const requiredPings = Math.max(1, toPositiveInt(RUTA_DESVIO_REQUIRED_PINGS, 3));
  const pointLimit = Math.max(requiredPings, toPositiveInt(RUTA_DESVIO_POINT_LIMIT, 6));
  const cooldownMs = toPositiveInt(RUTA_DESVIO_EVENT_COOLDOWN_MIN, 10) * 60 * 1000;
  const maxServicios = toPositiveInt(RUTA_DESVIO_MAX_SERVICIOS, 100);

  const sinceIso = new Date(Date.now() - lookbackMinutes * 60 * 1000).toISOString();

  const { data: servicios, error: svcError } = await supabase
    .from("servicio")
    .select(
      `
        id,
        empresa,
        tipo,
        placa_upper,
        estado,
        cliente_id,
        cliente:cliente_id(nombre)
      `
    )
    .eq("estado", "ACTIVO")
    .order("created_at", { ascending: false })
    .limit(maxServicios);

  if (svcError) {
    console.error("[ruta-desvio] servicios error", svcError);
    return json(500, { error: "No se pudieron leer los servicios." });
  }

  const routeCache = new Map();
  const summary = {
    checked: servicios?.length || 0,
    withRoute: 0,
    withoutPing: 0,
    alertsTriggered: 0,
    alertsResolved: 0,
    skippedActive: 0,
    messages: [],
  };

  for (const servicio of servicios || []) {
    const clienteId = servicio.cliente_id;
    if (!clienteId) continue;

    const route = await fetchActiveRoute(clienteId, routeCache);
    if (!route?.coords?.length) {
      continue;
    }
    summary.withRoute++;

    const ubicaciones = await fetchRecentUbicaciones(
      servicio.id,
      sinceIso,
      pointLimit
    );
    if (ubicaciones.length < requiredPings) {
      summary.withoutPing++;
      continue;
    }

    const analysis = analyseDeviation(
      ubicaciones,
      route,
      requiredPings
    );
    if (!analysis) continue;

    const lastEvent = await fetchLastDesvioEvent(servicio.id);
    const lastActive =
      lastEvent && ensureObject(lastEvent.metadata).status !== "closed";

    if (analysis.shouldTrigger) {
      const tooSoon =
        lastEvent &&
        Date.now() - new Date(lastEvent.created_at).getTime() < cooldownMs;
      if (lastActive || tooSoon) {
        summary.skippedActive++;
      } else {
        await insertDesvioEvent(servicio, route, analysis);
        summary.alertsTriggered++;
        summary.messages.push(
          `Desvío detectado en servicio ${servicio.id} (cliente ${clienteId}).`
        );
      }
      continue;
    }

    if (analysis.shouldResolve && lastActive && lastEvent) {
      await resolveDesvioEvent(lastEvent.id, analysis);
      summary.alertsResolved++;
      summary.messages.push(
        `Servicio ${servicio.id} volvió a ruta tras ${analysis.insideRun} pings.`
      );
    }
  }

  return json(200, summary);
}

async function fetchActiveRoute(clienteId, cache) {
  if (cache.has(clienteId)) return cache.get(clienteId);
  let route = null;
  try {
    const { data, error } = await supabase
      .from("ruta_cliente")
      .select("id, nombre, descripcion, tolerancia_metros, geojson")
      .eq("cliente_id", clienteId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error && error.code !== "PGRST116") throw error;
    if (data) {
      route = {
        id: data.id,
        nombre: data.nombre,
        descripcion: data.descripcion || null,
        tolerancia:
          typeof data.tolerancia_metros === "number"
            ? data.tolerancia_metros
            : DEFAULT_TOLERANCIA,
        coords: parseRouteCoords(data.geojson),
      };
    }
  } catch (err) {
    console.error("[ruta-desvio] ruta error", { clienteId, err });
  }
  cache.set(clienteId, route);
  return route;
}

async function fetchRecentUbicaciones(servicioId, sinceIso, limit) {
  try {
    const { data, error } = await supabase
      .from("ubicacion")
      .select("id, lat, lng, captured_at")
      .eq("servicio_id", servicioId)
      .gte("captured_at", sinceIso)
      .order("captured_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || [])
      .map((row) => ({
        id: row.id,
        lat: typeof row.lat === "number" ? row.lat : Number(row.lat),
        lng: typeof row.lng === "number" ? row.lng : Number(row.lng),
        captured_at: row.captured_at,
      }))
      .filter(
        (row) =>
          Number.isFinite(row.lat) &&
          Number.isFinite(row.lng) &&
          row.captured_at
      );
  } catch (err) {
    console.error("[ruta-desvio] ubicaciones error", { servicioId, err });
    return [];
  }
}

async function fetchLastDesvioEvent(servicioId) {
  try {
    const { data, error } = await supabase
      .from("alarm_event")
      .select("id, created_at, metadata")
      .eq("servicio_id", servicioId)
      .eq("type", "ruta_desviada")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error && error.code !== "PGRST116") throw error;
    return data || null;
  } catch (err) {
    console.error("[ruta-desvio] last event error", { servicioId, err });
    return null;
  }
}

async function insertDesvioEvent(servicio, route, analysis) {
  const latest = analysis.latest;
  const metadata = {
    channel: "ruta",
    reason: "desvio",
    distancia_m: round(latest.distance, 2),
    tolerancia_m: analysis.tolerancia,
    cliente_id: servicio.cliente_id,
    ruta_cliente_id: route.id,
    servicio_id: servicio.id,
    pings_fuera: analysis.outsideRun,
    consecutivos_requeridos: analysis.requiredPings,
    ultimo_ping: latest.captured_at,
    status: "open",
    ruta_nombre: route.nombre,
  };

  const payload = {
    type: "ruta_desviada",
    servicio_id: servicio.id,
    empresa: servicio.empresa,
    cliente: servicio.cliente?.nombre || "CLIENTE SIN NOMBRE",
    placa: servicio.placa_upper || "SIN_PLACA",
    tipo: servicio.tipo,
    lat: latest.lat,
    lng: latest.lng,
    metadata,
  };

  const { error } = await supabase.from("alarm_event").insert(payload);
  if (error) {
    console.error("[ruta-desvio] insert error", {
      servicio: servicio.id,
      error,
    });
  }
}

async function resolveDesvioEvent(eventId, analysis) {
  if (!eventId) return;
  const { data, error } = await supabase
    .from("alarm_event")
    .select("metadata")
    .eq("id", eventId)
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    console.error("[ruta-desvio] resolve fetch error", { eventId, error });
    return;
  }
  const metadata = ensureObject(data?.metadata);
  metadata.status = "closed";
  metadata.closed_at = new Date().toISOString();
  metadata.pings_en_ruta = analysis.insideRun;
  metadata.consecutivos_requeridos = analysis.requiredPings;

  const updateRes = await supabase
    .from("alarm_event")
    .update({ metadata })
    .eq("id", eventId);
  if (updateRes.error) {
    console.error("[ruta-desvio] resolve error", {
      eventId,
      error: updateRes.error,
    });
  }
}

function analyseDeviation(points, route, requiredPings) {
  if (!route?.coords?.length) return null;
  const tolerancia = route.tolerancia || DEFAULT_TOLERANCIA;

  const enriched = points
    .map((point) => ({
      ...point,
      distance: distancePointToRoute(point, route.coords),
    }))
    .filter((p) => Number.isFinite(p.distance))
    .sort(
      (a, b) =>
        new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
    );

  if (!enriched.length) return null;

  const outsideRun = countConsecutive(enriched, (p) => p.distance > tolerancia);
  const insideRun = countConsecutive(enriched, (p) => p.distance <= tolerancia);

  return {
    latest: enriched[0],
    outsideRun,
    insideRun,
    shouldTrigger: outsideRun >= requiredPings,
    shouldResolve: insideRun >= requiredPings,
    requiredPings,
    tolerancia,
  };
}

function distancePointToRoute(point, coords) {
  if (!coords || coords.length < 2) return Infinity;
  const refLatRad = point.lat * DEG2RAD;
  const cosRef = Math.cos(refLatRad);

  const toXY = ({ lat, lng }) => ({
    x: (lng - point.lng) * DEG2RAD * EARTH_RADIUS_M * cosRef,
    y: (lat - point.lat) * DEG2RAD * EARTH_RADIUS_M,
  });

  const target = { x: 0, y: 0 };
  let prev = toXY(coords[0]);
  let minDist = Infinity;

  for (let i = 1; i < coords.length; i++) {
    const curr = toXY(coords[i]);
    const dist = distancePointToSegment(target, prev, curr);
    if (dist < minDist) minDist = dist;
    prev = curr;
  }

  return minDist;
}

function distancePointToSegment(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const abLenSq = abx * abx + aby * aby;

  if (abLenSq === 0) {
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    return Math.hypot(dx, dy);
  }

  let t = (apx * abx + apy * aby) / abLenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * abx;
  const projY = a.y + t * aby;
  const dx = p.x - projX;
  const dy = p.y - projY;
  return Math.hypot(dx, dy);
}

function parseRouteCoords(rawGeojson) {
  if (!rawGeojson) return null;
  let geojson = rawGeojson;
  if (typeof rawGeojson === "string") {
    try {
      geojson = JSON.parse(rawGeojson);
    } catch (err) {
      console.warn("[ruta-desvio] geojson inválido");
      return null;
    }
  }
  if (geojson?.type !== "LineString" || !Array.isArray(geojson.coordinates)) {
    return null;
  }
  const coords = geojson.coordinates
    .map((pair) => ({
      lng: Number(pair?.[0]),
      lat: Number(pair?.[1]),
    }))
    .filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng));
  return coords.length >= 2 ? coords : null;
}

function countConsecutive(list, predicate) {
  let total = 0;
  for (const item of list) {
    if (predicate(item)) total++;
    else break;
  }
  return total;
}

function ensureObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...value };
  }
  return {};
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
// === END HU:HU-RUTA-DESVIO-BACKEND ===
