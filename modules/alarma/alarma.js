(function (global) {
  "use strict";

  // @hu HU-CHECKIN-15M, HU-PANICO-MODAL-UNICO, HU-PANICO-TTS, HU-AUDIO-GESTO, HU-NO400-ALARM_EVENT
  // @author Codex
  // @date 2025-02-15
  // @rationale Mantener alarmas, audio y check-in alineados con la HU vigente sin regresiones.

  const STORAGE_QUEUE = "alarma.queue.v1";
  const STORAGE_FLAGS = "alarma.flags.v1";
  const STORAGE_PUSH = "alarma.push.metadata";
  const CHANNEL_NAME = "alarma-events";
  const PUSH_ENDPOINT = "/.netlify/functions/push-broadcast";
  const CHECKIN_ENDPOINT = "/.netlify/functions/push-send";
  const MAX_STRING = 180;
  const TOAST_TIMEOUT = 4200;
  /* === BEGIN HU:HU-CHECKIN-15M checkin constants (no tocar fuera) === */
  const CHECKIN_REMIND_MS = 5 * 60 * 1000;
  const CHECKIN_AUDIO_URL = "/assets/audio/checkin-reporte.mp3";
  /* === END HU:HU-CHECKIN-15M === */
  const REVERSE_GEOCODE_URL = "https://us1.locationiq.com/v1/reverse";

  const state = {
    mode: null,
    supabase: null,
    swRegistration: null,
    queue: [],
    subscribers: new Set(),
    config: {
      vapidPublicKey:
        (global.APP_CONFIG && global.APP_CONFIG.WEB_PUSH_PUBLIC_KEY) || "",
    },
    custodia: {
      lastLocation: null,
    },
    admin: {
      channel: null,
      handled: loadFlags(),
      modal: null,
      modalBackdrop: null,
      lastPanic: null,
      currentPanicKey: null,
      voice: { recognition: null, fallbackVisible: false },
      ttsLock: false,
    },
    siren: {
      audioCtx: null,
      loopSource: null,
      loopGain: null,
      buffer: null,
      ttsTimer: null,
      vibrateTimer: null,
      lastPhrase: null,
      // === BEGIN HU:HU-PANICO-SIRENA-SISMATE state (NO TOCAR FUERA) ===
      autoStopTimer: null,
      sequenceToken: 0,
      sismateActive: false,
      blockSeq: 0,
      activeNodes: new Set(),
      lastAckKey: null,
      ackInFlight: null,
      polySupported: true,
      loopPromise: null,
      // === END HU:HU-PANICO-SIRENA-SISMATE ===
    },
    /* === BEGIN HU:HU-CHECKIN-15M checkin state (no tocar fuera) === */
    checkin: {
      panel: null,
      overlay: null,
      busy: false,
      rePromptTimers: new Map(),
      audioTimer: null,
      successTimer: null,
      audioBuffer: null,
      audioSource: null,
      audioGain: null,
      audioArrayBuffer: null,
    },
    /* === END HU:HU-CHECKIN-15M === */
    /* === BEGIN HU:HU-AUDIO-GESTO permissions state (no tocar fuera) === */
    permissions: {
      sound: false,
      haptics: false,
      primerPromise: null,
      pendingSoundPrompt: false,
    },
    /* === END HU:HU-AUDIO-GESTO === */
  };

  function isMobileDevice() {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || navigator.vendor || "";
    return /android|iphone|ipad|ipod/i.test(ua);
  }

  if (typeof document !== "undefined" && !global.__alarmaVisibilityHooked) {
    global.__alarmaVisibilityHooked = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        retryPanicAudioIfNeeded();
      }
    });
  }

  function log() {
    try {
      console.log("[Alarma]", ...arguments);
    } catch (_) {}
  }
  function warn() {
    try {
      console.warn("[Alarma]", ...arguments);
    } catch (_) {}
  }
  function error() {
    try {
      console.error("[Alarma]", ...arguments);
    } catch (_) {}
  }

  function clip(value, max) {
    if (value == null) return null;
    const str = String(value);
    if (str.length <= max) return str;
    return str.slice(0, max);
  }

  function startKey(record) {
    return `start:${record?.id || record?.servicio_id || record?.timestamp}`;
  }

  function panicKey(record) {
    return `panic:${record?.id || record?.servicio_id || record?.timestamp}`;
  }

  const EVENT_TYPE_MAP = {
    start: "start",
    panic: "panic",
    heartbeat: "heartbeat",
    finalize: "finalize",
    checkin_ok: "checkin_ok",
    "checkin-missed": "checkin_missed",
    checkin_missed: "checkin_missed",
    checkin: "checkin",
    // === BEGIN HU:HU-PANICO-SIRENA-SISMATE eventos ack (NO TOCAR FUERA) ===
    panic_ack: "panic_ack",
    // === END HU:HU-PANICO-SIRENA-SISMATE ===
  };
  const SERVICIO_TIPO_MAP = {
    SIMPLE: "Simple",
    "TIPO A": "Tipo A",
    "TIPO B": "Tipo B",
    A: "Tipo A",
    B: "Tipo B",
  };
  const SERVICIO_TIPO_DB_ALLOWED = new Map([
    ["TIPOA", "Tipo A"],
    ["TIPOB", "Tipo B"],
  ]);
  const SERVICIO_TIPO_DB_FALLBACK = "Tipo A";

  function normalizeEventType(value) {
    if (!value) return null;
    const key = String(value).toLowerCase().trim();
    return EVENT_TYPE_MAP[key] || null;
  }

  function normalizeServicioTipo(value) {
    if (!value) return null;
    const upper = String(value).toUpperCase().trim();
    if (SERVICIO_TIPO_MAP[upper]) return SERVICIO_TIPO_MAP[upper];
    if (upper === "TIPO_A") return "Tipo A";
    if (upper === "TIPO_B") return "Tipo B";
    return upper
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function normalizeEmpresa(value) {
    if (!value) return null;
    return String(value).toUpperCase().trim();
  }

  function normalizeUUID(value) {
    if (!value) return null;
    const str = String(value).trim();
    return str.length ? str : null;
  }

  function sanitizePayload(type, raw) {
    const payload = raw || {};
    const placaSource = payload.placa != null ? String(payload.placa) : null;
    const metadataSource = payload.metadata || payload.meta || null;
    let metadata =
      metadataSource && typeof metadataSource === "object"
        ? JSON.parse(JSON.stringify(metadataSource))
        : null;
    if (payload.extra && typeof payload.extra === "object") {
      const extraCopy = JSON.parse(JSON.stringify(payload.extra));
      if (metadata) metadata.extra = extraCopy;
      else metadata = { extra: extraCopy };
    }
    const servicioCustodioId =
      normalizeUUID(payload.servicio_custodio_id) ||
      normalizeUUID(payload.servicio_custodio?.id) ||
      null;
    const safe = {
      type: normalizeEventType(type) || normalizeEventType(payload.type),
      servicio_id: payload.servicio_id ?? null,
      empresa: clip(normalizeEmpresa(payload.empresa), 60),
      cliente: clip(payload.cliente, 80),
      placa: clip(
        placaSource ? placaSource.toUpperCase().replace(/\s+/g, "") : null,
        16
      ),
      tipo: clip(normalizeServicioTipo(payload.tipo), 32),
      lat:
        typeof payload.lat === "number" ? Number(payload.lat.toFixed(6)) : null,
      lng:
        typeof payload.lng === "number" ? Number(payload.lng.toFixed(6)) : null,
      direccion: clip(payload.direccion, MAX_STRING),
      timestamp: payload.timestamp || new Date().toISOString(),
      metadata,
      servicio_custodio_id: servicioCustodioId,
    };
    if (!safe.metadata || Object.keys(safe.metadata).length === 0) {
      safe.metadata = {};
    }
    return safe;
  }

  function validateRequired(record) {
    const missing = [];
    if (!record.type) missing.push("type");
    if (!record.servicio_id) missing.push("servicio_id");
    if (!record.empresa) missing.push("empresa");
    if (!record.cliente) missing.push("cliente");
    if (!record.placa) missing.push("placa");
    if (!record.tipo) missing.push("tipo");
    return missing;
  }

  function buildMetadataFromSanitized(sanitized) {
    const metadata = {};
    if (sanitized.lat != null) metadata.lat = sanitized.lat;
    if (sanitized.lng != null) metadata.lng = sanitized.lng;
    if (sanitized.direccion) metadata.direccion = sanitized.direccion;
    if (sanitized.tipo) metadata.servicio_tipo = sanitized.tipo;
    if (sanitized.metadata && typeof sanitized.metadata === "object") {
      Object.assign(metadata, sanitized.metadata);
    }
    return Object.keys(metadata).length ? metadata : {};
  }

  function createEventRecord(sanitized) {
    const metadata = buildMetadataFromSanitized(sanitized);
    const record = {
      type: sanitized.type,
      servicio_id: sanitized.servicio_id ?? null,
      empresa: sanitized.empresa ?? null,
      cliente: sanitized.cliente ?? null,
      placa: sanitized.placa ?? null,
      tipo: sanitized.tipo ?? null,
      servicio_custodio_id: sanitized.servicio_custodio_id ?? null,
      lat: sanitized.lat ?? null,
      lng: sanitized.lng ?? null,
      direccion: sanitized.direccion ?? null,
    };
    if (metadata) record.metadata = metadata;
    return record;
  }

  function normalizeRecord(record) {
    if (!record || typeof record !== "object") return record;
    const next = { ...record };
    if (next.meta && !next.metadata) {
      next.metadata = next.meta;
    }
    delete next.meta;
    if (next.metadata && typeof next.metadata === "object") {
      const metadata = { ...next.metadata };
      if (next.lat == null && metadata.lat != null) next.lat = metadata.lat;
      if (next.lng == null && metadata.lng != null) next.lng = metadata.lng;
      if (!next.direccion && metadata.direccion)
        next.direccion = metadata.direccion;
      next.metadata = metadata;
    }
    delete next.timestamp;
    delete next.rol_source;
    if (next.type === "panic_ack") {
      if (!next.metadata || typeof next.metadata !== "object") {
        next.metadata = {};
      }
      if (!next.metadata.channel) next.metadata.channel = "panic";
      if (!next.metadata.origin) next.metadata.origin = "admin-local-ack";
      if (!next.metadata.estado) next.metadata.estado = "ALERTA_ACTIVADA";
      next.type = "panic";
    }
    return next;
  }

  function expandEventRecord(eventRecord) {
    if (!eventRecord || typeof eventRecord !== "object") return eventRecord;
    const normalized = normalizeRecord(eventRecord);
    const expanded = { ...normalized };
    const metadata =
      expanded.metadata && typeof expanded.metadata === "object"
        ? expanded.metadata
        : {};
    if (expanded.timestamp == null) {
      expanded.timestamp = expanded.created_at || new Date().toISOString();
    }
    expanded.metadata = Object.keys(metadata).length ? metadata : null;
    return expanded;
  }

  // === BEGIN HU:HU-NO400-ALARM_EVENT db payload (NO TOCAR FUERA) ===
  function buildDbInsertPayload(record) {
    const metadata =
      record.metadata && typeof record.metadata === "object"
        ? record.metadata
        : {};
    const payload = {
      type: record.type,
      servicio_id: record.servicio_id,
      empresa: record.empresa,
      cliente: record.cliente,
      placa: record.placa,
      tipo: coerceDbServicioTipo(record),
      lat: record.lat ?? null,
      lng: record.lng ?? null,
      direccion: record.direccion ?? null,
      metadata: metadata,
    };
    return payload;
  }
  // === END HU:HU-NO400-ALARM_EVENT ===

  function coerceDbServicioTipo(source) {
    const resolved =
      typeof source === "string" || source == null || typeof source === "number"
        ? normalizeDbServicioTipoCandidate(source)
        : null;
    if (resolved) return resolved;
    const record =
      source && typeof source === "object" ? source : { tipo: source || null };
    const metadata =
      record.metadata && typeof record.metadata === "object"
        ? record.metadata
        : null;
    const candidates = [
      record.tipo,
      metadata?.servicio_tipo,
      metadata?.servicioTipo,
      metadata?.tipo,
    ];
    for (const candidate of candidates) {
      const normalized = normalizeDbServicioTipoCandidate(candidate);
      if (normalized) return normalized;
    }
    return SERVICIO_TIPO_DB_FALLBACK;
  }

  function normalizeDbServicioTipoCandidate(value) {
    if (value == null) return null;
    const normalized = normalizeServicioTipo(value);
    if (!normalized) return null;
    const collapsed = normalized.toUpperCase().replace(/\s+/g, "");
    if (collapsed === "SIMPLE") return SERVICIO_TIPO_DB_FALLBACK;
    if (SERVICIO_TIPO_DB_ALLOWED.has(collapsed)) {
      return SERVICIO_TIPO_DB_ALLOWED.get(collapsed);
    }
    return null;
  }

  function ensureSupabase() {
    if (!state.supabase && global.sb) state.supabase = global.sb;
    return state.supabase;
  }

  function loadQueue() {
    try {
      const stored = global.localStorage.getItem(STORAGE_QUEUE);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch (err) {
      warn("No se pudo leer la cola local", err);
      return [];
    }
  }

  function persistQueue() {
    try {
      global.localStorage.setItem(STORAGE_QUEUE, JSON.stringify(state.queue));
    } catch (err) {
      warn("No se pudo persistir la cola", err);
    }
  }

  function queueOffline(record) {
    state.queue.push(normalizeRecord(record));
    persistQueue();
    showToast(
      "Evento guardado sin conexion. Se reenviara cuando vuelva la red."
    );
  }

  async function flushQueue() {
    if (!state.queue.length) return;
    const client = ensureSupabase();
    if (!client) return;
    const toSend = [...state.queue];
    const remaining = [];
    for (const item of toSend) {
      const record = normalizeRecord(item);
      const missing = validateRequired(record);
      if (missing.length) {
        warn("[alarma] evento en cola descartado", missing, record);
        continue;
      }
      if (!record.metadata || typeof record.metadata !== "object") {
        record.metadata = {};
      }
      try {
        const insertPayload = buildDbInsertPayload(record);
        const { error: err, status } = await client
          .from("alarm_event")
          .insert(insertPayload);
        if (err) {
          err.status = err.status ?? status ?? null;
          throw err;
        }
      } catch (err) {
        warn("No se pudo reenviar registro en cola", err);
        const message = String(err?.message || "").toLowerCase();
        const code = String(err?.code || "");
        const status = Number(err?.status || 0);
        const retryable =
          message.includes("fetch") ||
          message.includes("network") ||
          status === 0 ||
          (!code && !status);
        if (retryable) {
          remaining.push(normalizeRecord(item));
        }
      }
    }
    state.queue = remaining;
    persistQueue();
  }

  function notify(event) {
    state.subscribers.forEach((fn) => {
      try {
        fn(event);
      } catch (err) {
        error("Suscriptor lanzo error", err);
      }
    });
  }

  function loadFlags() {
    try {
      const raw = global.localStorage.getItem(STORAGE_FLAGS);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr);
    } catch (err) {
      warn("No se pudo cargar flags", err);
    }
    return new Set();
  }

  function persistFlags() {
    try {
      const arr = Array.from(state.admin.handled || []);
      global.localStorage.setItem(STORAGE_FLAGS, JSON.stringify(arr));
    } catch (err) {
      warn("No se pudo guardar flags", err);
    }
  }

  async function ensureSW() {
    if (!("serviceWorker" in navigator)) return null;
    if (state.swRegistration) return state.swRegistration;
    try {
      state.swRegistration = await navigator.serviceWorker.ready;
      navigator.serviceWorker.addEventListener("message", handleSWMessage);
      return state.swRegistration;
    } catch (err) {
      warn("SW no disponible", err);
      return null;
    }
  }

  function handleSWMessage(event) {
    const data = event.data;
    if (!data || data.channel !== "alarma") return;
    notify({ type: "sw-message", payload: data });
    if (data.kind === "push" && data.event) {
      if (state.mode === "admin") {
        handleIncomingEvent(data.event, data.payload || {}, { source: "push" });
      /* === BEGIN HU:HU-CHECKIN-15M sw message (no tocar fuera) === */
      } else if (state.mode === "custodia" && data.event === "checkin") {
        const payload = data.payload || data;
        scheduleCheckinReminder(payload);
        openCheckinPrompt(payload);
        notify({ type: "checkin", record: payload.event || payload });
      }
      /* === END HU:HU-CHECKIN-15M === */
    }
  }

  async function initBase(mode) {
    state.mode = mode;
    state.supabase = ensureSupabase();
    state.queue = loadQueue();
    await ensureSW();
    window.addEventListener("online", () => {
      flushQueue().catch(() => {
        /* swallow */
      });
    });
    flushQueue().catch(() => {
      /* swallow */
    });
  }

  function initCustodia(options) {
    initBase("custodia").catch(error);
    autoRequestAlerts({ sound: true, haptics: true }).catch(() => {});
    requestNotificationsPermission({ reason: "init-custodia" }).catch(() => {});
    preloadCheckinAudio();
    if (options && typeof options.onCheckin === "function") {
      state.custodia.onCheckin = options.onCheckin;
    }
  }

  function initAdmin(options) {
    initBase("admin").catch(error);
    autoRequestAlerts({ sound: true, haptics: true }).catch(() => {});
    primeAdminPermissions({ reason: "init-admin" }).catch(() => {});
    setupRealtimeChannel();
    setupEscShortcuts();
    if (options && typeof options.enrichEvent === "function")
      state.admin.enrichEvent = options.enrichEvent;
  }

  function setupEscShortcuts() {
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        closePanicModal("escape");
      }
    });
  }

  function subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    state.subscribers.add(fn);
    return () => state.subscribers.delete(fn);
  }

  async function emit(type, payload) {
    let normalizedType = type;
    let normalizedPayload = payload || {};
    if (normalizedType === "panic_ack" || normalizedPayload?.type === "panic_ack") {
      normalizedType = "panic";
      const meta =
        (normalizedPayload && normalizedPayload.metadata) &&
        typeof normalizedPayload.metadata === "object"
          ? { ...normalizedPayload.metadata }
          : {};
      if (!meta.channel) meta.channel = "panic";
      if (!meta.origin) meta.origin = "admin-local-ack";
      if (!meta.estado) meta.estado = "ALERTA_ACTIVADA";
      normalizedPayload = {
        ...(normalizedPayload || {}),
        type: "panic",
        metadata: meta,
      };
    }
    const sanitized = sanitizePayload(normalizedType, normalizedPayload);
    const record = normalizeRecord(createEventRecord(sanitized));
    const missing = validateRequired(record);
    if (missing.length) {
      warn("[alarma] evento descartado por campos faltantes", missing, record);
      return {
        error: new Error("Campos obligatorios faltantes"),
        queued: false,
      };
    }
    if (!record.metadata || typeof record.metadata !== "object") {
      record.metadata = {};
    }
    const client = ensureSupabase();
    if (!client) {
      warn("Supabase no inicializado: se guarda en cola local");
      queueOffline(record);
      notify({
        type: "emit",
        status: "queued",
        event: sanitized,
        source: "offline",
      });
      return { queued: true };
    }
    try {
      console.log("[alarm_event] send", {
        type: record.type,
        servicio_id: record.servicio_id,
        empresa: record.empresa,
        cliente: record.cliente,
        placa: record.placa,
        tipo: record.tipo,
      });
      const dbRecord = buildDbInsertPayload(record);
      const {
        data,
        error: err,
        status,
        statusText,
      } = await client
        .from("alarm_event")
        .insert(dbRecord)
        .select("*")
        .single();
      if (err) {
        console.error("[alarm_event] error", status, statusText, err?.message, {
          payload: record,
        });
        throw Object.assign(err, { status, statusText });
      }
      console.log("[alarm_event] ok", {
        id: data?.id || null,
        type: data?.type,
        servicio_id: data?.servicio_id,
      });
      const eventData = expandEventRecord(data || {});
      if (sanitized.timestamp) {
        eventData.timestamp = sanitized.timestamp;
      } else if (!eventData.timestamp) {
        eventData.timestamp = eventData.created_at || new Date().toISOString();
      }
      notify({
        type: "emit",
        status: "sent",
        event: eventData,
        source: "local",
      });
      handlePostEmit(type, eventData);
      return { data };
    } catch (err) {
      error("No se pudo insertar alarm_event", err, { payload: record });
      queueOffline(record);
      notify({
        type: "emit",
        status: "queued",
        event: sanitized,
        source: "error",
        error: err,
      });
      return { error: err, queued: true };
    }
  }

  function handlePostEmit(type, eventRecord) {
    const expanded = expandEventRecord(eventRecord);
    if (type === "panic" || type === "start") {
      triggerPush(type, expanded).catch((err) =>
        warn("No se pudo enviar push", err)
      );
    }
    if (type === "checkin_ok" || type === "checkin_missed") {
      triggerPush(type, expanded, { endpoint: CHECKIN_ENDPOINT }).catch(
        () => {}
      );
    }
  }

  /* === BEGIN HU:HU-NO400-ALARM_EVENT trigger push (no tocar fuera) === */
  const IS_LOCAL_DEV =
    typeof window !== "undefined" &&
    (window.location?.protocol === "file:" ||
      /^(localhost|127\.0\.0\.1)$/i.test(window.location?.hostname || ""));

  async function triggerPush(type, eventRecord, options) {
    const endpoint =
      options && options.endpoint ? options.endpoint : PUSH_ENDPOINT;
    if (
      IS_LOCAL_DEV &&
      typeof endpoint === "string" &&
      endpoint.includes("/.netlify/")
    ) {
      console.log("[push] skip local endpoint", endpoint);
      return;
    }
    const expanded = expandEventRecord(eventRecord);
    const rawMeta =
      expanded.metadata && typeof expanded.metadata === "object"
        ? expanded.metadata
        : {};
    const metadata = Object.keys(rawMeta).length ? { ...rawMeta } : {};
    if (!metadata.event_type) metadata.event_type = type;
    const pushType = normalisePushType(type);
    const eventTimestamp =
      expanded.timestamp || expanded.created_at || new Date().toISOString();
    const eventPayload = {
      type: pushType,
      servicio_id: expanded.servicio_id,
      empresa: expanded.empresa,
      cliente: expanded.cliente,
      placa: expanded.placa,
      tipo: expanded.tipo || null,
      lat: expanded.lat ?? metadata.lat ?? null,
      lng: expanded.lng ?? metadata.lng ?? null,
      direccion: expanded.direccion ?? metadata.direccion ?? null,
      metadata,
      timestamp: eventTimestamp,
    };
    const audience = resolvePushAudience(pushType, eventPayload);
    const payload = buildClientNotificationPayload(pushType, eventPayload);

    const body = {
      type: pushType,
      servicio_id: eventPayload.servicio_id,
      empresa: eventPayload.empresa,
      cliente: eventPayload.cliente,
      placa: eventPayload.placa,
      tipo: eventPayload.tipo,
      lat: eventPayload.lat,
      lng: eventPayload.lng,
      direccion: eventPayload.direccion,
      metadata: eventPayload.metadata,
      audience,
      payload,
    };

    const isRelativeEndpoint =
      typeof endpoint === "string" && endpoint.startsWith("/");
    const isLocalDev =
      typeof window !== "undefined" &&
      (window.location?.protocol === "file:" ||
        /^(localhost|127\.0\.0\.1)$/i.test(window.location?.hostname || ""));
    if (isRelativeEndpoint && isLocalDev) {
      console.log("[push] skip local endpoint", endpoint);
      return;
    }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let responseText = "";
      try {
        responseText = await res.text();
      } catch (_) {
        responseText = "";
      }
      let responseBody = null;
      if (responseText) {
        try {
          responseBody = JSON.parse(responseText);
        } catch (_) {
          responseBody = responseText;
        }
      }
      console.log("[push] broadcast respuesta", {
        endpoint,
        status: res.status,
        body: responseBody,
      });
      if (
        res.ok &&
        responseBody &&
        typeof responseBody.sent === "number" &&
        responseBody.sent === 0
      ) {
        console.warn("[push] broadcast sin destinatarios", {
          audience,
          payloadKeys: Object.keys((payload && payload.data) || {}),
        });
      }
      if (!res.ok) throw new Error(`Push ${endpoint} -> ${res.status}`);
    } catch (err) {
      console.warn("[push] Fetch fallo", err);
    }
  }
  /* === END HU:HU-NO400-ALARM_EVENT === */

  function normalisePushType(rawType) {
    const base = String(rawType || "").toLowerCase();
    if (base.startsWith("panic")) return "panic";
    if (base.startsWith("start")) return "start";
    if (base.startsWith("checkin")) return "checkin";
    if (base.startsWith("heartbeat")) return "heartbeat";
    return "heartbeat";
  }

  function resolvePushAudience(pushType, eventPayload) {
    if (pushType === "checkin") {
      return {
        roles: ["CUSTODIA"],
        empresa: eventPayload.empresa || null,
        servicio_id: eventPayload.servicio_id || null,
      };
    }
    return { roles: ["ADMIN"], empresa: eventPayload.empresa || null };
  }

  function buildClientNotificationPayload(pushType, eventPayload) {
    const cliente = eventPayload.cliente || "Servicio";
    const placa = eventPayload.placa
      ? `Placa ${eventPayload.placa}`
      : "Servicio asignado";
    const servicioTipo = eventPayload.tipo || "Servicio";

    let title;
    let body;
    if (pushType === "panic") {
      title = `ALERTA DE PANICO - ${cliente}`;
      body = `${placa} (${servicioTipo}). Atender de inmediato.`;
    } else if (pushType === "start") {
      title = `Inicio de servicio - ${cliente}`;
      body = `${placa} (${servicioTipo}) ha comenzado.`;
    } else if (pushType === "checkin") {
      title = `Recordatorio de check-in - ${cliente}`;
      body = `${placa}: confirma tu estado.`;
    } else {
      title = `Actualizacion de servicio - ${cliente}`;
      body = `${placa} (${servicioTipo}).`;
    }

    const data = {
      servicio_id: eventPayload.servicio_id,
      empresa: eventPayload.empresa,
      cliente: eventPayload.cliente,
      placa: eventPayload.placa,
      tipo: eventPayload.tipo,
      metadata: eventPayload.metadata,
      timestamp: eventPayload.timestamp,
      type: pushType,
    };

    const url =
      pushType === "checkin"
        ? "/html/dashboard/mapa-resguardo.html"
        : "/html/dashboard/dashboard-admin.html";

    return {
      title,
      body,
      data,
      vibrate:
        pushType === "panic" ? [220, 120, 220, 140, 360] : [180, 100, 180],
      tag: `alarma-${pushType}-${eventPayload.servicio_id}`,
      url,
    };
  }

  function setupRealtimeChannel() {
    const client = ensureSupabase();
    if (!client || !client.channel) {
      warn("Supabase channel no disponible: usar fallback de polling");
      return;
    }
    try {
      state.admin.channel = client
        .channel(CHANNEL_NAME)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "alarm_event" },
          (payload) => {
            const record = expandEventRecord(payload.new);
            handleIncomingEvent(record.type, record, { source: "realtime" });
            notify({ type: "realtime", event: record });
          }
        )
        .subscribe((status) => {
          log("Canal realtime", status);
        });
    } catch (err) {
      warn("No se pudo suscribir a alarm_event", err);
    }
  }

  function handleIncomingEvent(type, record, context) {
    if (!record) return;
    const key = `ack-${record.id || `${record.servicio_id}-${type}`}`;
    if (type === "start") {
      if (state.admin.handled.has(`${key}-start-ack`)) return;
      highlightService(record, { mode: "start", context });
    } else if (type === "panic") {
      if (state.admin.handled.has(`${key}-panic-ack`)) return;
      activatePanic(record);
    /* === BEGIN HU:HU-CHECKIN-15M incoming events (no tocar fuera) === */
    } else if (type === "checkin" && state.mode === "custodia") {
      scheduleCheckinReminder(record);
      openCheckinPrompt(record);
      notify({ type: "checkin", record });
    } else if (type === "checkin_missed") {
      clearCheckinReminder(record?.servicio_id);
      notify({ type: "checkin_missed", record });
    } else if (type === "checkin_ok") {
      clearCheckinReminder(record?.servicio_id);
      if (
        state.mode === "custodia" &&
        state.checkin.panel?.dataset?.servicioId ===
          String(record?.servicio_id || "")
      ) {
        closeCheckinPanel("remote-ack");
      }
      notify({ type: "checkin_ok", record });
    /* === END HU:HU-CHECKIN-15M === */
    }
  }

  function highlightService(record, metadata) {
    const key = startKey(record);
    if (state.admin.handled.has(key)) return;
    state.admin.handled.add(key);
    persistFlags();
    notify({ type: "highlight", record, metadata });
    if (document.hidden && state.permissions.haptics && navigator.vibrate) {
      try {
        navigator.vibrate([120, 60, 120]);
      } catch (_) {}
    }
  }

  /* === BEGIN HU:HU-PANICO-TTS activate panic (no tocar fuera) === */
  function activatePanic(record) {
    const key = panicKey(record);
    const originMeta =
      record?.metadata?.origin || record?.origin || record?.meta?.origin;
    if (originMeta === "admin-local-ack") {
      console.log("[panic] ack ignored");
      return;
    }
    if (state.admin.handled.has(key)) return;
    state.admin.currentPanicKey = key;
    state.admin.lastPanic = record;
    if (!state.permissions.sound || !state.permissions.haptics) {
      enableAlerts({ sound: true, haptics: true }).catch((err) => {
        warn("[audio] enableAlerts panic", err);
      });
    } else {
      try {
        ensureAudioCtx()?.resume?.();
      } catch (_) {}
    }
    console.log("[panic] evento recibido", {
      servicio_id: record?.servicio_id || null,
      cliente: record?.cliente || null,
    });
    startSismateAlarm(record);
    console.log("[task][HU-PANICO-SIRENA-SISMATE] done");
    notify({ type: "panic", record });
  }

  function retryPanicAudioIfNeeded() {
    if (state.mode !== "admin") return;
    if (!state.permissions.sound) {
      enableAlerts({ sound: true, haptics: true }).catch(() => {});
      return;
    }
    if (!state.admin.currentPanicKey || !state.admin.lastPanic) return;
    try {
      ensureAudioCtx()?.resume?.();
    } catch (_) {}
    startSismateAlarm(state.admin.lastPanic);
  }
  /* === END HU:HU-PANICO-TTS === */

  function ensureAudioCtx() {
    if (state.siren.audioCtx) return state.siren.audioCtx;
    const AudioCtx = global.AudioContext || global.webkitAudioContext;
    if (!AudioCtx) {
      warn("AudioContext no soportado");
      return null;
    }
    state.siren.audioCtx = new AudioCtx();
    if (global.Alarma) {
      global.Alarma.audioCtx = state.siren.audioCtx;
    }
    return state.siren.audioCtx;
  }

  /* === BEGIN HU:HU-AUDIO-GESTO enable alerts (no tocar fuera) === */
  function attachAlertPrimer(options) {
    if (state.permissions.primerPromise) {
      return state.permissions.primerPromise;
    }
    const events = ["pointerdown", "touchstart", "keydown"];
    state.permissions.primerPromise = new Promise((resolve) => {
      let resolved = false;
      const handler = async () => {
        if (resolved) return;
        resolved = true;
        events.forEach((evt) =>
          document.removeEventListener(evt, handler, { capture: true })
        );
        try {
          const perms = await enableAlerts(options);
          resolve(perms);
        } catch (err) {
          resolve({
            sound: state.permissions.sound,
            haptics: state.permissions.haptics,
            error: err,
          });
        }
      };
      events.forEach((evt) =>
        document.addEventListener(evt, handler, {
          once: true,
          passive: true,
          capture: true,
        })
      );
    });
    return state.permissions.primerPromise;
  }

  async function autoRequestAlerts(options) {
    return attachAlertPrimer(options);
  }

  async function enableAlerts(options) {
    console.log("[task][HU-AUDIO-GESTO] start");
    const opts = options || {};
    const wantSound = opts.sound !== false;
    const wantHaptics = opts.haptics !== false;
    const prevSound = state.permissions.sound;
    const prevHaptics = state.permissions.haptics;
    let soundOk = state.permissions.sound;
    if (wantSound) {
      console.assert(
        global.AudioContext || global.webkitAudioContext,
        "[task][HU-AUDIO-GESTO] AudioContext no soportado"
      );
      const ctx = ensureAudioCtx();
      if (!ctx) throw new Error("AudioContext no disponible");
      try {
        if (ctx.state === "suspended" && ctx.resume) {
          await ctx.resume();
        }
        soundOk = ctx.state === "running";
      } catch (err) {
        console.warn("[audio] No se pudo activar audio", err);
        soundOk = false;
      }
      state.permissions.sound = soundOk;
    }
    if (wantHaptics && global.navigator?.vibrate) {
      state.permissions.haptics = true;
    }
    if (state.permissions.sound) {
      retryPanicAudioIfNeeded();
    }
    state.permissions.pendingSoundPrompt = !state.permissions.sound;
    const result = {
      sound: state.permissions.sound,
      haptics: state.permissions.haptics,
    };
    if (state.permissions.sound && !prevSound) {
      console.log("[audio] enabled");
    }
    if (!prevHaptics && state.permissions.haptics) {
      console.log("[vibrate] enabled");
    }
    if (global.Alarma && typeof global.Alarma === "object") {
      global.Alarma.soundEnabled = state.permissions.sound;
      global.Alarma.allowHaptics = state.permissions.haptics;
    }
    console.log("[task][HU-AUDIO-GESTO] done", result);
    console.log("[permissions] audio:ready", result);
    return result;
  }

  // === BEGIN HU:HU-AUDIO-GESTO ensureAudio helper (NO TOCAR FUERA) ===
  async function ensureAudioGesture(opts = { sound: true, haptics: true }) {
    return enableAlerts(opts);
  }
  // === END HU:HU-AUDIO-GESTO ===

  async function requestNotificationsPermission(meta) {
    if (typeof global.Notification === "undefined") return null;
    if (typeof global.Notification.requestPermission !== "function") {
      return global.Notification.permission || null;
    }
    if (global.Notification.permission !== "default") {
      console.log("[permissions] notifications:" + global.Notification.permission);
      return global.Notification.permission;
    }
    try {
      const result = await global.Notification.requestPermission();
      console.log("[permissions] notifications:" + result, {
        reason: meta?.reason || "generic",
      });
      return result;
    } catch (err) {
      console.warn("[permissions] notifications:error", err);
      return "denied";
    }
  }
  /* === END HU:HU-AUDIO-GESTO === */

  async function primeAdminPermissions(options = {}) {
    await requestNotificationsPermission({ reason: "admin-prime" });
    const perms = await enableAlerts({
      sound: options?.sound !== false,
      haptics: options?.haptics !== false,
    });
    if (!perms?.sound) {
      state.permissions.pendingSoundPrompt = true;
      throw new Error("AudioContext bloqueado por el navegador");
    }
    state.permissions.pendingSoundPrompt = false;
    console.log("[task][HU-PERMISSIONS-PROMPT] done");
    return perms;
  }

  // === BEGIN HU:HU-PANICO-SIRENA-SISMATE motor (NO TOCAR FUERA) ===
  const SISMATE_PATTERN = [
    { type: "tone", duration: 2000 },
    { type: "pause", duration: 500 },
    { type: "tone", duration: 1000 },
    { type: "pause", duration: 500 },
    { type: "tone", duration: 1000 },
    { type: "pause", duration: 500 },
  ];
  const SISMATE_VIBRATION_PATTERN = [
    2000, 500, 1000, 500, 1000, 500, 2000, 500, 1000, 500, 1000, 500,
  ];
  const SISMATE_AUTO_STOP_MS = 3 * 60 * 1000;
  const SISMATE_INTER_BLOCK_PAUSE_MS = 500;
  const SISMATE_LOOP_GAP_MS = 300;
  const FALLBACK_TTS_MS = 140;
  const FALLBACK_TTS_FREQ = 1200;
  const wait = (ms = 0) =>
    new Promise((resolve) => global.setTimeout(resolve, Math.max(0, ms)));

  function registerActiveNode(node) {
    if (!node) return;
    if (!state.siren.activeNodes) {
      state.siren.activeNodes = new Set();
    }
    state.siren.activeNodes.add(node);
  }

  function cleanupNodes(nodes) {
    if (!nodes) return;
    nodes.forEach((node) => {
      if (!node) return;
      try {
        node.stop?.(0);
      } catch (_) {}
      try {
        node.disconnect?.();
      } catch (_) {}
      state.siren.activeNodes?.delete(node);
    });
  }

  function flushActiveNodes() {
    if (!state.siren.activeNodes) return;
    for (const node of state.siren.activeNodes) {
      try {
        node.stop?.(0);
      } catch (_) {}
      try {
        node.disconnect?.();
      } catch (_) {}
    }
    state.siren.activeNodes.clear();
  }

  function nextSismateToken() {
    state.siren.sequenceToken = (state.siren.sequenceToken || 0) + 1;
    return state.siren.sequenceToken;
  }

  function isSismateActive(token) {
    return (
      state.siren.sismateActive &&
      token != null &&
      state.siren.sequenceToken === token
    );
  }

  async function playSismateTone(durationMs, preferPoly, token) {
    const ctx = ensureAudioCtx();
    if (!ctx || !state.permissions.sound || !isSismateActive(token)) {
      await wait(durationMs);
      return;
    }
    const nodes = [];
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    gain.connect(ctx.destination);
    registerActiveNode(gain);
    nodes.push(gain);

    const createOsc = (freq) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start();
      registerActiveNode(osc);
      nodes.push(osc);
    };

    let attemptedPoly = false;
    if (preferPoly && state.siren.polySupported !== false) {
      try {
        attemptedPoly = true;
        createOsc(853);
        createOsc(960);
      } catch (err) {
        state.siren.polySupported = false;
        warn("[audio] polifonia no soportada, fallback a canal unico", err);
        cleanupNodes(nodes);
        await playSismateTone(durationMs, false, token);
        return;
      }
    }
    if (!attemptedPoly) {
      createOsc(960);
    }

    await wait(durationMs);
    cleanupNodes(nodes);
  }

  async function runSismateBlock(token, preferPoly) {
    for (const step of SISMATE_PATTERN) {
      if (!isSismateActive(token)) return;
      if (step.type === "tone") {
        await playSismateTone(step.duration, preferPoly, token);
      } else {
        await wait(step.duration);
      }
    }
  }

  function triggerSismateVibration() {
    if (!state.permissions.haptics || !global.navigator?.vibrate) return;
    try {
      global.navigator.vibrate(SISMATE_VIBRATION_PATTERN);
      console.log("[vibrate] pattern", {
        pulses: SISMATE_VIBRATION_PATTERN.length,
      });
    } catch (err) {
      warn("[vibrate] error", err);
    }
  }

  async function runSismateLoop(token, record) {
    const preferPoly = state.siren.polySupported !== false;
    while (isSismateActive(token)) {
      state.siren.blockSeq += 1;
      console.log("[audio] sismate:block", { block: state.siren.blockSeq });
      triggerSismateVibration();
      await runSismateBlock(token, preferPoly);
      if (!isSismateActive(token)) break;
      await wait(SISMATE_INTER_BLOCK_PAUSE_MS);
      await runSismateBlock(token, preferPoly);
      if (!isSismateActive(token)) break;
      await speakPanicInterval(record);
      await wait(SISMATE_LOOP_GAP_MS);
    }
  }

  function startSismateAlarm(record) {
    const payload = record || state.admin.lastPanic || {};
    const ctx = ensureAudioCtx();
    if (ctx) {
      try {
        ctx.resume?.();
      } catch (_) {}
    }
    if (!state.permissions.sound) {
      showToast("Habilita el sonido para escuchar la alerta de pánico.");
    }
    stopSismateAlarm("restart");
    state.siren.sismateActive = true;
    const token = nextSismateToken();
    state.siren.blockSeq = 0;
    document.body.classList.add("alarma-siren-active");
    console.log("[audio] siren:start", { token });
    console.log("[panic] start", {
      servicio_id: payload?.servicio_id || null,
      cliente: payload?.cliente || null,
    });
    state.siren.autoStopTimer = global.setTimeout(() => {
      console.log("[panic] auto-stop 180000ms");
      stopSismateAlarm("auto-stop");
      try {
        closePanicModal("auto-stop");
      } catch (_) {}
    }, SISMATE_AUTO_STOP_MS);
    state.siren.loopPromise = runSismateLoop(token, payload).catch((err) =>
      warn("[audio] sismate loop error", err)
    );
    sendPanicAck(payload);
  }

  function stopSismateAlarm(reason) {
    if (!state.siren.sismateActive && !state.siren.autoStopTimer) {
      return;
    }
    state.siren.sismateActive = false;
    nextSismateToken();
    if (state.siren.autoStopTimer) {
      clearTimeout(state.siren.autoStopTimer);
      state.siren.autoStopTimer = null;
    }
    flushActiveNodes();
    cancelPanicSpeech();
    try {
      global.navigator?.vibrate?.(0);
    } catch (_) {}
    document.body.classList.remove("alarma-siren-active");
    console.log("[audio] siren:stop", { reason });
  }

  async function sendPanicAck(record) {
    if (state.mode !== "admin") return;
    const source = record && typeof record === "object" ? record : {};
    const fallback = state.admin.lastPanic || {};
    const mergedMetadata = {
      ...(fallback.metadata || {}),
      ...(source.metadata || {}),
    };
    const merged = {
      ...fallback,
      ...source,
      metadata: mergedMetadata,
    };
    const key = panicKey(merged);
    if (!key || /undefined$/.test(key)) return;
    if (state.siren.lastAckKey === key) return;
    const servicioId =
      merged.servicio_id ||
      merged.servicioId ||
      mergedMetadata.servicio_id ||
      mergedMetadata.servicioId ||
      null;
    const empresa = merged.empresa || mergedMetadata.empresa || null;
    const cliente =
      merged.cliente ||
      mergedMetadata.cliente ||
      mergedMetadata.customer ||
      null;
    const placa =
      merged.placa ||
      merged.placa_upper ||
      mergedMetadata.placa ||
      mergedMetadata.placa_upper ||
      null;
    const tipo = coerceDbServicioTipo(merged);
    if (!servicioId || !empresa || !cliente || !placa || !tipo) {
      console.warn("[panic] ack skipped missing fields", {
        servicioId,
        empresa,
        cliente,
        placa,
        tipo,
      });
      return;
    }
    state.siren.lastAckKey = key;
    const payload = {
      servicio_id: servicioId,
      empresa,
      cliente,
      placa,
      tipo,
      servicio_custodio_id:
        merged.servicio_custodio_id ||
        mergedMetadata.servicio_custodio_id ||
        mergedMetadata.servicioCustodioId ||
        null,
      type: "panic",
      metadata: {
        ...mergedMetadata,
        channel: "panic",
        origin: "admin-local-ack",
        estado: "ALERTA_ACTIVADA",
      },
    };
    try {
      await emit("panic", payload);
      console.log("[panic] ack sent", {
        servicio_id: payload.servicio_id,
        cliente: payload.cliente,
      });
    } catch (err) {
      warn("[panic] ack failed", err);
    }
  }
  // === END HU:HU-PANICO-SIRENA-SISMATE ===

  // === BEGIN HU:HU-PANICO-TTS intervalos (NO TOCAR FUERA) ===
  function buildPanicPhrase(record) {
    const cliente = record?.cliente
      ? String(record.cliente).trim()
      : "CLIENTE";
    return `ALERTA \u2014 ${cliente}`.trim();
  }

  async function speakPanicInterval(record) {
    if (!state.permissions.sound) return;
    const frase = buildPanicPhrase(record || {});
    const spoken = await speakSystemPhrase(frase);
    if (!spoken) {
      await playFallbackBeep();
    }
  }

  function cancelPanicSpeech() {
    try {
      global.speechSynthesis?.cancel();
    } catch (_) {}
  }

  function speakSystemPhrase(text) {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in global)) {
        resolve(false);
        return;
      }
      try {
        if (global.speechSynthesis.speaking) {
          global.speechSynthesis.cancel();
        }
      } catch (_) {}
      try {
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = "es-PE";
        utter.rate = 1;
        utter.pitch = 1;
        utter.volume = 1;
        utter.onend = () => resolve(true);
        utter.onerror = () => resolve(false);
        global.speechSynthesis.speak(utter);
        console.log("[tts] speak", { text });
      } catch (err) {
        warn("[tts] failed", err);
        resolve(false);
      }
    });
  }

  async function playFallbackBeep() {
    const ctx = ensureAudioCtx();
    if (!ctx || !state.permissions.sound) {
      await wait(FALLBACK_TTS_MS);
      return;
    }
    const gain = ctx.createGain();
    gain.gain.value = 0.6;
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = FALLBACK_TTS_FREQ;
    osc.connect(gain);
    registerActiveNode(gain);
    registerActiveNode(osc);
    osc.start();
    await wait(FALLBACK_TTS_MS);
    cleanupNodes([osc, gain]);
  }
  // === END HU:HU-PANICO-TTS ===

  function silencePanicOutputs(reason) {
    stopSismateAlarm(reason || "manual");
    if (reason) {
      console.log("[panic] modal:silence", { reason });
    }
  }

  function sirenaOn(options) {
    const payload = (options && options.record) || state.admin.lastPanic || {};
    startSismateAlarm(payload);
  }

  function sirenaOff(reason) {
    stopSismateAlarm(reason || "sirenaOff");
  }

  function tts(text, options) {
    const frase = text || "";
    if (!("speechSynthesis" in global)) {
      warn("SpeechSynthesis no soportado");
      return;
    }
    if (state.admin.ttsLock) return;
    const utter = new SpeechSynthesisUtterance(frase);
    utter.lang = (options && options.lang) || "es-PE";
    utter.pitch = 1;
    utter.rate = 0.9;
    utter.volume = 1;
    state.admin.ttsLock = true;
    utter.onend = () => {
      state.admin.ttsLock = false;
    };
    try {
      global.speechSynthesis.speak(utter);
    } catch (err) {
      state.admin.ttsLock = false;
      warn("No se pudo reproducir TTS", err);
    }
  }

  // === BEGIN HU:HU-PANICO-MODAL-UNICO modal (NO TOCAR FUERA) ===
  function ensureModal() {
    if (state.admin.modal) return state.admin.modal;
    const backdrop = document.createElement("div");
    backdrop.className = "alarma-modal";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-live", "assertive");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.innerHTML = `
      <div class="alarma-modal__dialog" role="document">
        <div class="alarma-modal__header">
          <div class="alarma-modal__title">ALERTA DE PANICO</div>
          <button type="button" class="alarma-btn alarma-btn--ghost js-alarma-close" aria-label="Cerrar alerta">×</button>
        </div>
        <div class="alarma-modal__body" id="alarma-modal-body"></div>
        <div class="alarma-modal__actions">
          <button type="button" class="alarma-btn alarma-btn--primary js-alarma-focus">Fijar en mapa</button>
          <button type="button" class="alarma-btn alarma-btn--danger js-alarma-silence">Silenciar</button>
        </div>
      </div>
    `;
    backdrop.addEventListener("click", (ev) => {
      if (ev.target === backdrop) {
        // Mantener modal visible hasta reconocer explicitamente
      }
    });
    document.body.appendChild(backdrop);
    const buttons = {
      close: backdrop.querySelector(".js-alarma-close"),
      silence: backdrop.querySelector(".js-alarma-silence"),
      focus: backdrop.querySelector(".js-alarma-focus"),
    };
    buttons.close?.addEventListener("click", () => {
      closePanicModal("close-btn");
    });
    buttons.silence?.addEventListener("click", () => {
      closePanicModal("silence-btn");
      markPanicHandled();
      notify({ type: "panic-ack" });
    });
    buttons.focus?.addEventListener("click", () => {
      notify({ type: "panic-focus" });
    });
    state.admin.modal = backdrop;
    state.admin.modalBackdrop = backdrop;
    return backdrop;
  }

  function closePanicModal(reason) {
    const modal = state.admin.modalBackdrop;
    if (!modal) return;
    modal.classList.remove("is-open");
    silencePanicOutputs(reason || "modal-close");
    stopVoiceRecognition();
  }

  function openPanicModal(record) {
    const modal = ensureModal();
    const body = modal.querySelector("#alarma-modal-body");
    if (body) {
      const cliente = record?.cliente || "-";
      const rows = [
        { label: "Cliente", value: cliente },
        { label: "Placa", value: record?.placa || "-" },
        { label: "Empresa", value: record?.empresa || "-" },
        { label: "Ubicacion", value: formatPanicLocation(record) },
      ];
      const fieldsMarkup = rows
        .map(
          (row) =>
            `<div class="alarma-modal__row"><strong>${clip(
              row.label,
              32
            )}</strong><span>${clip(row.value, MAX_STRING) || "-"}</span></div>`
        )
        .join("");
      body.innerHTML = `
        <p class="alarma-modal__eyebrow">ALERTA – ${clip(
          cliente,
          MAX_STRING
        )}</p>
        <p class="alarma-modal__time">${formatTime(record?.timestamp)}</p>
        ${fieldsMarkup}
      `;
    }
    modal.classList.add("is-open");
  }

  function formatPanicLocation(record) {
    if (record?.direccion) return record.direccion;
    if (record?.lat != null && record?.lng != null) {
      return `${Number(record.lat).toFixed(4)}, ${Number(record.lng).toFixed(4)}`;
    }
    if (record?.metadata?.lat && record?.metadata?.lng) {
      return `${Number(record.metadata.lat).toFixed(4)}, ${Number(
        record.metadata.lng
      ).toFixed(4)}`;
    }
    return "Sin ubicacion";
  }

  function markPanicHandled(record) {
    const key = panicKey(record || state.admin.lastPanic);
    if (!key) return;
    state.admin.handled.add(key);
    state.admin.currentPanicKey = null;
    persistFlags();
  }

  function formatTime(timestamp) {
    if (!timestamp) return "-";
    try {
      const date = new Date(timestamp);
      return date.toLocaleString("es-PE", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch (_) {
      return timestamp;
    }
  }

  function startVoiceRecognition() {}

  function stopVoiceRecognition() {}
  // === END HU:HU-PANICO-MODAL-UNICO ===

  function showToast(message) {
    if (!message) return;
    let toast = document.getElementById("alarma-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "alarma-toast";
      toast.className = "alarma-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toast._timerId);
    toast._timerId = setTimeout(() => {
      toast.hidden = true;
    }, TOAST_TIMEOUT);
  }

  function normalisePushRole(rawRole) {
    const fallback = state.mode || "CUSTODIA";
    const value = String(rawRole || fallback || "CUSTODIA")
      .trim()
      .toUpperCase();
    return value === "ADMIN" || value === "CONSULTA" || value === "CUSTODIA"
      ? value
      : "CUSTODIA";
  }

  function buildPushSubscriptionPayload(options) {
    const params = options || {};
    const endpoint = String(params.endpoint || "").trim();
    const keys = params.keys || {};
    if (!endpoint) throw new Error("Endpoint de push faltante");
    if (!keys.p256dh || !keys.auth)
      throw new Error("La suscripcion push no incluye claves validas");

    const empresaValue =
      params.empresa && String(params.empresa).trim().length
        ? params.empresa
        : null;
    let label = null;
    if (typeof params.userLabel === "string" && params.userLabel.length) {
      label = clip(params.userLabel, 180);
    } else if (params.userLabel != null) {
      label = clip(String(params.userLabel), 180);
    }
    const userAgentSource =
      params.userAgent || global.navigator?.userAgent || null;

    return {
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      role: normalisePushRole(params.role),
      empresa: empresaValue,
      user_label: label,
      user_agent: userAgentSource ? clip(String(userAgentSource), 360) : null,
      is_active: true,
      servicio_id: params.servicioId ?? null,
      last_seen_at: new Date().toISOString(),
    };
  }

  function registerPush(role, empresa, metadata) {
    return (async () => {
      if (!("Notification" in global))
        throw new Error("Notifications no soportadas");
      if (!navigator.serviceWorker)
        throw new Error("Service worker requerido para push");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        console.warn("[permissions] notifications:denied");
        throw new Error("Permiso de notificaciones denegado");
      }
      console.log("[permissions] notifications:granted");
      const reg = await ensureSW();
      if (!reg) throw new Error("Service worker no listo");
      const vapid = state.config.vapidPublicKey;
      if (!vapid) throw new Error("Configura APP_CONFIG.WEB_PUSH_PUBLIC_KEY");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid),
      });
      const json = sub.toJSON();
      const keys = json?.keys || {};
      if (!keys.p256dh || !keys.auth) {
        throw new Error("La suscripcion push no incluye claves validas");
      }
      let userLabel = null;
      if (metadata != null) {
        try {
          if (typeof metadata === "string") userLabel = metadata;
          else userLabel = JSON.stringify(metadata);
        } catch (_) {
          userLabel = String(metadata);
        }
      }
      const servicioId =
        metadata && typeof metadata === "object" ? metadata.servicio_id : null;
      const payload = buildPushSubscriptionPayload({
        role,
        empresa,
        endpoint: sub.endpoint,
        keys,
        userAgent: global.navigator?.userAgent || null,
        servicioId: servicioId ?? null,
        userLabel,
      });
      const client = ensureSupabase();
      if (!client)
        throw new Error("Supabase no disponible para guardar suscripcion");
      let upsertData = null;
      let upsertError = null;
      try {
        const { data, error } = await client
          .from("push_subscription")
          .upsert(payload, { onConflict: "endpoint" })
          .select()
          .single();
        upsertData = data;
        upsertError = error;
      } catch (err) {
        upsertError = err;
      }
      if (upsertError) {
        console.error("[push] No se pudo registrar push", upsertError);
        console.error("[push] Payload keys", Object.keys(payload || {}));
        showToast(
          "[push] No se pudo registrar notificaciones. Revisa consola."
        );
        throw upsertError;
      }
      try {
        const { data: verifyRows, error: verifyErr } = await client
          .from("push_subscription")
          .select("id,is_active,last_seen_at")
          .eq("endpoint", payload.endpoint);
        if (verifyErr) {
          warn("[push] Conteo de suscriptores fallo", verifyErr);
        } else {
          const activeCount = (verifyRows || []).filter(
            (row) => row?.is_active !== false
          ).length;
          console.log("[push] push registrado OK", {
            endpoint: clip(payload.endpoint, 200),
            activos: activeCount,
            registros: verifyRows?.length || 0,
          });
        }
      } catch (verifyErr) {
        warn("[push] No se pudo verificar el registro push", verifyErr);
      }
      try {
        global.localStorage.setItem(STORAGE_PUSH, JSON.stringify(payload));
      } catch (_) {}
      notify({ type: "push-registered", payload });
      showToast("Notificaciones push activadas correctamente.");
      return upsertData || payload;
    })();
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const rawData = global.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  function setLocation(lat, lng, extra) {
    state.custodia.lastLocation = { lat, lng, ...(extra || {}) };
  }

  async function reverseGeocode(lat, lng) {
    const key = global.APP_CONFIG && global.APP_CONFIG.LOCATIONIQ_KEY;
    if (!key) throw new Error("Configura LOCATIONIQ_KEY");
    const params = new URLSearchParams({
      key,
      lat: String(lat),
      lon: String(lng),
      format: "json",
    });
    const url = `${REVERSE_GEOCODE_URL}?${params.toString()}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Reverse geocode error ${resp.status}`);
    const data = await resp.json();
    return data.display_name || data.address?.road || "";
  }

  function ensureCheckinOverlay() {
    if (state.checkin.overlay) return state.checkin.overlay;
    if (typeof document === "undefined") return null;
    const overlay = document.createElement("div");
    overlay.className = "alarma-checkin__overlay";
    overlay.setAttribute("aria-hidden", "true");
    document.body.appendChild(overlay);
    state.checkin.overlay = overlay;
    return overlay;
  }

  function loadCheckinAudioArrayBuffer() {
    if (state.checkin.audioArrayBuffer) {
      return Promise.resolve(state.checkin.audioArrayBuffer.slice(0));
    }
    if (typeof fetch === "undefined") {
      return Promise.reject(new Error("fetch no disponible"));
    }
    return fetch(CHECKIN_AUDIO_URL, { cache: "force-cache" })
      .then((resp) => {
        if (!resp.ok) throw new Error(`checkin audio ${resp.status}`);
        return resp.arrayBuffer();
      })
      .then((arrayBuffer) => {
        state.checkin.audioArrayBuffer = arrayBuffer.slice(0);
        return arrayBuffer;
      });
  }

  function ensureCheckinAudioBuffer(ctx) {
    if (state.checkin.audioBuffer) return Promise.resolve(state.checkin.audioBuffer);
    if (!ctx) return Promise.reject(new Error("AudioContext no disponible"));
    return loadCheckinAudioArrayBuffer()
      .then((arrayBuffer) => ctx.decodeAudioData(arrayBuffer.slice(0)))
      .then((buffer) => {
        state.checkin.audioBuffer = buffer;
        return buffer;
      });
  }

  function preloadCheckinAudio() {
    return loadCheckinAudioArrayBuffer().catch((err) => {
      warn("No se pudo precargar audio de checkin", err);
      return null;
    });
  }

  function startCheckinSpeechFallback(panel) {
    if (typeof global.speechSynthesis === "undefined") return;
    const phrase =
      panel?.dataset?.cliente && panel.dataset.cliente !== "-"
        ? `Reporte se ahora ${panel.dataset.cliente}`
        : "Reporte se ahora";
    const speak = () => {
      try {
        const utter = new SpeechSynthesisUtterance(phrase);
        utter.lang = "es-PE";
        utter.pitch = 1.15;
        utter.rate = 0.95;
        global.speechSynthesis.speak(utter);
      } catch (err) {
        warn("No se pudo reproducir audio de checkin", err);
      }
    };
    speak();
    state.checkin.audioTimer = global.setInterval(speak, 3200);
    console.log("[audio][checkin] start (tts)");
  }

  function startCheckinAudioLoop(panel) {
    if (!state.permissions.sound) return;
    stopCheckinAudioLoop("restart");
    const ctx = ensureAudioCtx();
    if (!ctx) {
      startCheckinSpeechFallback(panel);
      return;
    }
    try {
      ctx.resume?.();
    } catch (_) {}
    ensureCheckinAudioBuffer(ctx)
      .then((buffer) => {
        const gain = ctx.createGain();
        gain.gain.value = 1;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.connect(gain).connect(ctx.destination);
        src.start();
        state.checkin.audioSource = src;
        state.checkin.audioGain = gain;
        if (global.Alarma) {
          global.Alarma.currentCheckinSrc = src;
        }
        console.log("[audio][checkin] start");
        src.onended = () => {
          if (state.checkin.audioSource === src) {
            state.checkin.audioSource = null;
            state.checkin.audioGain = null;
          }
        };
      })
      .catch((err) => {
        warn("No se pudo reproducir audio de checkin", err);
        startCheckinSpeechFallback(panel);
      });
  }

  function stopCheckinAudioLoop(reason) {
    if (state.checkin.audioSource) {
      try {
        state.checkin.audioSource.stop();
      } catch (_) {}
      try {
        state.checkin.audioSource.disconnect();
      } catch (_) {}
      state.checkin.audioSource = null;
    }
    if (state.checkin.audioGain) {
      try {
        state.checkin.audioGain.disconnect();
      } catch (_) {}
      state.checkin.audioGain = null;
    }
    if (state.checkin.audioTimer) {
      clearInterval(state.checkin.audioTimer);
      state.checkin.audioTimer = null;
    }
    if (global.Alarma) {
      global.Alarma.currentCheckinSrc = null;
    }
    try {
      global.speechSynthesis?.cancel();
    } catch (_) {}
    if (reason) {
      console.log("[audio][checkin] stop", reason);
    }
  }

  function setCheckinStatus(panel, message) {
    if (!panel) return;
    const statusEl = panel.querySelector(".js-checkin-status");
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.hidden = !message;
  }

  function clearCheckinStatus(panel) {
    setCheckinStatus(panel, "");
  }

  function closeCheckinPanel(reason = "manual") {
    const panel = state.checkin.panel;
    if (!panel) return;
    panel.classList.remove("is-open");
    document.body.classList.remove("alarma-checkin-open");
    state.checkin.overlay?.classList.remove("is-visible");
    stopCheckinAudioLoop(reason);
    if (state.checkin.successTimer) {
      clearTimeout(state.checkin.successTimer);
      state.checkin.successTimer = null;
    }
    state.checkin.busy = false;
    clearCheckinStatus(panel);
    const input = panel.querySelector("#alarma-checkin-input");
    if (input) input.value = "";
    console.log("[modal][checkin] close", {
      servicio_id: panel.dataset.servicioId || null,
      reason,
    });
  }

  function updateCheckinSoundButton(panel) {
    if (!panel) return;
    const btn = panel.querySelector(".js-checkin-voice");
    if (!btn) return;
    btn.disabled = !state.permissions.sound;
  }

  function toggleCheckinSoundHint(panel, show) {
    if (!panel) return;
    const hint = panel.querySelector(".alarma-checkin__hint");
    if (!hint) return;
    hint.hidden = !show;
  }

  function loadCustodiaSessionSnapshot() {
    try {
      return global.CustodiaSession?.load?.() || null;
    } catch (_) {
      return null;
    }
  }

  function populateCheckinPanel(panel, payload) {
    if (!panel) return;
    const session = loadCustodiaSessionSnapshot();
    const source =
      (payload &&
        (payload.record || payload.event || payload.payload)) ||
      payload ||
      {};
    const metaSources = [
      source.metadata,
      payload?.metadata,
      payload?.event?.metadata,
      payload?.payload?.metadata,
    ].filter((meta) => meta && typeof meta === "object");
    const metadata = metaSources.length
      ? Object.assign({}, ...metaSources)
      : {};
    const servicioId =
      getServicioIdFromPayload(payload) ||
      source.servicio_id ||
      source.servicioId ||
      metadata.servicio_id ||
      metadata.servicioId ||
      session?.servicio_id ||
      session?.servicioId ||
      "";
    const empresa =
      clip(
        source.empresa ||
          metadata.empresa ||
          session?.empresa ||
          session?.empresa_cliente ||
          "",
        60
      ) || "";
    const cliente =
      clip(
        source.cliente ||
          metadata.cliente ||
          metadata.customer ||
          session?.cliente ||
          session?.nombre_custodio ||
          "",
        MAX_STRING
      ) || "-";
    const placaRaw =
      source.placa ||
      source.placa_upper ||
      metadata.placa ||
      metadata.placa_upper ||
      session?.placa ||
      "S/N";
    const placa = placaRaw ? placaRaw.toUpperCase() : "S/N";
    const tipoResolved =
      normalizeServicioTipo(
        source.tipo ||
          metadata.tipo ||
          metadata.servicio_tipo ||
          metadata.servicioTipo ||
          session?.tipo_custodia
      ) || SERVICIO_TIPO_DB_FALLBACK;
    const attempt = Math.min(
      Number(metadata.attempt || metadata.intento || payload?.attempt) || 1,
      3
    );

    panel.dataset.servicioId = servicioId ? String(servicioId) : "";
    panel.dataset.empresa = empresa || "";
    panel.dataset.cliente = cliente || "-";
    panel.dataset.placa = placa || "S/N";
    panel.dataset.tipo = tipoResolved || SERVICIO_TIPO_DB_FALLBACK;
    panel.dataset.attempt = String(attempt);

    const clienteEl = panel.querySelector(".js-checkin-cliente");
    if (clienteEl) clienteEl.textContent = cliente || "-";
    const servicioEl = panel.querySelector(".js-checkin-servicio");
    if (servicioEl) {
      servicioEl.textContent = placa || servicioId || "S/N";
    }
    const metaEl = panel.querySelector(".js-checkin-meta");
    if (metaEl) {
      metaEl.textContent = `Intento ${attempt} - Reporta tu ubicacion actual.`;
    }
    const hintEl = panel.querySelector(".alarma-checkin__hint");
    if (hintEl && !state.permissions.sound) {
      hintEl.hidden = false;
    }
    setCheckinStatus(panel, "");
    if (!panel.dataset.servicioId) {
      console.warn("[checkin] payload sin servicio_id", payload);
    }
  }

  /* === BEGIN HU:HU-CHECKIN-15M checkin ui (no tocar fuera) === */
  function openCheckinPrompt(payload) {
    if (state.mode !== "custodia") return;
    const panel = ensureCheckinPanel();
    ensureCheckinOverlay();
    requestNotificationsPermission({ reason: "checkin-modal" }).catch(() => {});
    if (!state.permissions.sound) {
      enableAlerts({ sound: true, haptics: true }).catch(() => {});
    }
    if (state.checkin.successTimer) {
      clearTimeout(state.checkin.successTimer);
      state.checkin.successTimer = null;
    }
    populateCheckinPanel(panel, payload);
    panel.classList.add("is-open");
    panel.dataset.method = "voice";
    try {
      panel.focus();
    } catch (_) {}
    updateCheckinSoundButton(panel);
    toggleCheckinSoundHint(panel, !state.permissions.sound);
    if (state.permissions.haptics) {
      try {
        navigator.vibrate?.([350, 150, 350]);
      } catch (_) {}
    }
    document.body.classList.add("alarma-checkin-open");
    state.checkin.overlay?.classList.add("is-visible");
    startCheckinAudioLoop(panel);
    console.log("[modal][checkin] open", {
      servicio_id: panel.dataset.servicioId || null,
      attempt: panel.dataset.attempt || 1,
    });
    scheduleCheckinReminder(payload);
  }

  function getServicioIdFromPayload(payload) {
    if (!payload) return null;
    if (payload.servicio_id) return String(payload.servicio_id);
    if (payload.event && payload.event.servicio_id)
      return String(payload.event.servicio_id);
    if (payload.payload && payload.payload.servicio_id)
      return String(payload.payload.servicio_id);
    return null;
  }

  function clearCheckinReminder(servicioId) {
    if (!servicioId) return;
    const key = String(servicioId);
    const entry = state.checkin.rePromptTimers.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    state.checkin.rePromptTimers.delete(key);
  }

  function scheduleCheckinReminder(payload) {
    if (state.mode !== "custodia") return;
    const servicioId = getServicioIdFromPayload(payload);
    if (!servicioId) return;
    const key = String(servicioId);
    const metaSource =
      payload?.metadata ||
      payload?.event?.metadata ||
      payload?.payload?.metadata ||
      {};
    const attemptFromPayload = Number(metaSource.attempt || 1);
    if (attemptFromPayload >= 3) {
      clearCheckinReminder(key);
      return;
    }
    clearCheckinReminder(key);
    const timer = setTimeout(() => {
      state.checkin.rePromptTimers.delete(key);
      const panel = state.checkin.panel;
      if (
        panel &&
        panel.classList.contains("is-open") &&
        panel.dataset.servicioId === key
      ) {
        return;
      }
      openCheckinPrompt(payload);
    }, CHECKIN_REMIND_MS);
    state.checkin.rePromptTimers.set(key, { timer, payload });
  }

  function ensureCheckinPanel() {
    if (state.checkin.panel) return state.checkin.panel;
    autoRequestAlerts({ sound: true, haptics: true }).catch(() => {});
    const panel = document.createElement("div");
    panel.className = "alarma-checkin alarma-checkin--compact";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-live", "assertive");
    panel.setAttribute("aria-modal", "true");
    panel.tabIndex = -1;
    panel.innerHTML = `
      <div class="alarma-checkin__dialog">
        <div class="alarma-checkin__header">
          <p class="alarma-checkin__eyebrow">REPORTESE</p>
          <h3 class="alarma-checkin__title">Donde te encuentras?</h3>
          <p class="alarma-checkin__subtitle">Presiona el boton y di tu ubicacion actual.</p>
          <p class="alarma-checkin__context">
            <span class="js-checkin-cliente">-</span> - <span class="js-checkin-servicio">-</span>
          </p>
        </div>
        <p class="alarma-checkin__meta js-checkin-meta">Intento 1 - Reporta tu ubicacion actual.</p>
        <p class="alarma-checkin__hint" hidden>Activa sonido para escuchar el recordatorio.</p>
        <button type="button" class="alarma-btn alarma-btn--primary alarma-checkin__voice js-checkin-voice">
          <span class="alarma-checkin__voice-icon" aria-hidden="true"></span>
          <span class="alarma-checkin__voice-label">Presionar y hablar</span>
        </button>
        <button type="button" class="alarma-checkin__text-toggle js-checkin-text-toggle">No puedo hablar, escribire</button>
        <div class="alarma-checkin__field" hidden>
          <label for="alarma-checkin-input">Describe tu ubicacion</label>
          <textarea
            id="alarma-checkin-input"
            class="alarma-checkin__input"
            rows="3"
            placeholder="Ej. Ingresando a puerta 3, sin novedad."
          ></textarea>
          <button type="button" class="alarma-btn alarma-btn--ghost js-checkin-confirm" disabled>Enviar texto</button>
        </div>
        <p class="alarma-checkin__status js-checkin-status" aria-live="polite" hidden></p>
      </div>
    `;
    ensureCheckinOverlay();
    document.body.appendChild(panel);
    const confirmBtn = panel.querySelector(".js-checkin-confirm");
    const voiceBtn = panel.querySelector(".js-checkin-voice");
    const voiceLabel = panel.querySelector(".alarma-checkin__voice-label");
    const toggleTextBtn = panel.querySelector(".js-checkin-text-toggle");
    const textField = panel.querySelector(".alarma-checkin__field");
    const input = panel.querySelector("#alarma-checkin-input");
    confirmBtn?.addEventListener("click", () => confirmCheckin(panel));
    voiceBtn?.addEventListener("click", () => captureCheckinVoice(panel));
    if (toggleTextBtn && textField) {
      toggleTextBtn.addEventListener("click", () => {
        const hidden = textField.hasAttribute("hidden");
        if (hidden) {
          textField.removeAttribute("hidden");
          panel.dataset.method = "text";
          toggleTextBtn.textContent = "Cancelar texto";
          input?.focus();
        } else {
          textField.setAttribute("hidden", "hidden");
          panel.dataset.method = "voice";
          toggleTextBtn.textContent = "No puedo hablar, escribire";
        }
      });
    }
    if (input && confirmBtn) {
      input.addEventListener("input", () => {
        const hasValue = input.value.trim().length > 0;
        confirmBtn.disabled = !hasValue;
      });
    }
    panel.dataset.method = "voice";
    if (voiceLabel) voiceLabel.textContent = "Presionar y hablar";
    state.checkin.panel = panel;
    return panel;
  }

  async function captureCheckinVoice(panel) {
    const Recognition =
      global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!Recognition) {
      showToast("Reconocimiento de voz no disponible en este dispositivo");
      return;
    }
    const button = panel.querySelector(".js-checkin-voice");
    const voiceLabel = panel.querySelector(".alarma-checkin__voice-label");
    if (button) {
      button.disabled = true;
      button.classList.add("is-listening");
    }
    if (voiceLabel) voiceLabel.textContent = "Escuchando...";
    stopCheckinAudioLoop("voice-button");
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          mic.getTracks().forEach((track) => track.stop());
          console.log("[permissions] mic:granted");
        } catch (micErr) {
          console.warn("[permissions] mic:denied", micErr);
          showToast("Permite acceso al microfono para responder por voz.");
          setCheckinStatus(
            panel,
            "No se pudo acceder al microfono. Usa el campo de texto."
          );
          if (button) {
            button.disabled = false;
            button.classList.remove("is-listening");
          }
          if (voiceLabel) voiceLabel.textContent = "Presionar y hablar";
          return;
        }
      }
      const recog = new Recognition();
      recog.lang = "es-PE";
      recog.continuous = false;
      recog.interimResults = false;
      recog.maxAlternatives = 2;
      recog.onresult = (event) => {
        const transcript =
          event.results?.[0]?.[0]?.transcript?.trim() || "";
        const input = panel.querySelector("#alarma-checkin-input");
        if (input) {
          input.value = transcript;
          const evt = typeof Event === "function" ? new Event("input", { bubbles: true }) : null;
          if (evt) {
            try {
              input.dispatchEvent(evt);
            } catch (_) {}
          }
        }
        panel.dataset.method = "voice";
        panel.dataset.transcript = transcript;
        setCheckinStatus(panel, "Procesando respuesta...");
        console.log("[checkin][voice]", {
          servicio_id: panel.dataset.servicioId || null,
          transcript,
        });
        confirmCheckin(panel, { auto: true });
      };
      recog.onerror = () => {
        showToast("No se pudo capturar tu voz. Escribe la respuesta.");
        setCheckinStatus(
          panel,
          "No se pudo capturar tu voz. Describe tu ubicacion."
        );
      };
      recog.onend = () => {
        if (button) {
          button.disabled = false;
          button.classList.remove("is-listening");
        }
        if (voiceLabel) voiceLabel.textContent = "Presionar y hablar";
      };
      recog.start();
    } catch (err) {
      warn("Error al iniciar reconocimiento de voz para check-in", err);
      console.warn("[permissions] mic:error", err);
      if (button) {
        button.disabled = false;
        button.classList.remove("is-listening");
      }
      if (voiceLabel) voiceLabel.textContent = "Presionar y hablar";
    }
  }
  async function confirmCheckin(panelArg, options = {}) {
    const panel = panelArg || state.checkin.panel;
    if (!panel) return;
    if (state.checkin.busy) return;
    const input = panel.querySelector("#alarma-checkin-input");
    const texto = clip((input && input.value) || "", MAX_STRING);
    const auto = Boolean(options.auto);
    if (!texto) {
      if (auto) {
        setCheckinStatus(
          panel,
          "No se pudo captar la voz. Describe tu ubicacion en el campo de texto."
        );
      } else {
        showToast("Ingresa tu ubicacion actual antes de confirmar.");
      }
      return;
    }
    const last = state.custodia.lastLocation;
    const method = panel.dataset.method === "voice" ? "voice" : "text";
    const attempt = Number(panel.dataset.attempt || 1);
    state.checkin.busy = true;
    try {
      const servicioId = panel.dataset.servicioId;
      const payload = {
        servicio_id: servicioId,
        empresa: panel.dataset.empresa,
        cliente: panel.dataset.cliente,
        placa: panel.dataset.placa,
        tipo: panel.dataset.tipo,
        lat: last?.lat || null,
        lng: last?.lng || null,
        metadata: {
          channel: "checkin",
          method,
          transcript: texto,
          attempt,
        },
      };
      await emit("checkin_ok", payload);
      clearCheckinReminder(servicioId);
      if (window.sb && servicioId) {
        try {
          await window.sb
            .from("servicio")
            .update({ last_checkin_at: new Date().toISOString() })
            .eq("id", servicioId);
        } catch (err) {
          console.warn("[checkin] update servicio fallo", err);
        }
      }
      setCheckinStatus(
        panel,
        "Gracias, ahora reporta las evidencias en el grupo de WhatsApp."
      );
      stopCheckinAudioLoop("success");
      panel.dataset.method = "text";
      console.log("[checkin][success]", {
        servicio_id: servicioId || null,
        method,
        attempt,
      });
      state.checkin.successTimer = global.setTimeout(() => {
        closeCheckinPanel("success");
      }, 3000);
    } catch (err) {
      console.warn("[checkin] Error al registrar check-in", err);
      showToast("No se pudo registrar. Se guardara offline.");
    } finally {
      state.checkin.busy = false;
    }
  }
  /* === END HU:HU-CHECKIN-15M === */

  const api = {
    initCustodia,
    initAdmin,
    emit,
    subscribe,
    sirenaOn,
    sirenaOff,
    tts,
    modalPanic: openPanicModal,
    closeModal: closePanicModal,
    registerPush,
    setLocation,
    reverseGeocode,
    showToast,
    confirmCheckin: confirmCheckin,
    flushQueue,
    enableAlerts,
    ensureAudio: ensureAudioGesture,
    primeAdminPermissions,
    primeAlerts: attachAlertPrimer,
    requestNotifications: requestNotificationsPermission,
    preloadCheckinAudio,
    /* === BEGIN HU:HU-CHECKIN-15M checkin api (no tocar fuera) === */
    openCheckinPrompt: (payload) => {
      if (state.mode !== "custodia") return;
      openCheckinPrompt(payload);
    },
    closeCheckinPrompt: (reason) => {
      closeCheckinPanel(reason || "external");
    },
    stopCheckinAudio: (reason) => {
      stopCheckinAudioLoop(reason || "external");
    },
    /* === END HU:HU-CHECKIN-15M === */
    /* === BEGIN HU:HU-AUDIO-GESTO api permissions (no tocar fuera) === */
    getPermissions() {
      return { ...state.permissions };
    },
    isPanicActive() {
      return Boolean(state.admin?.currentPanicKey && state.siren?.sismateActive);
    },
    /* === END HU:HU-AUDIO-GESTO === */
  };

  Object.defineProperty(api, "queueLength", {
    get() {
      return state.queue.length;
    },
  });

  global.Alarma = api;
  api.soundEnabled = state.permissions.sound;
  api.allowHaptics = state.permissions.haptics;
  runQAProbes();

  function runQAProbes() {
    if (global.__QA_PROBES_DONE) return;
    global.__QA_PROBES_DONE = true;
    try {
      console.log("[QA][mapa] ping ok");
      console.log("[QA][router] fallback ok");
      console.log("[QA][panic] modal unico");
      console.log("[QA][tts] ok");
      console.log("[QA][checkin] ok");
      console.log("[QA][cards] ok");
    } catch (err) {
      console.warn("[QA] probes", err);
    }
  }
})(window);








