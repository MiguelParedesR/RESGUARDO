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
      interval: null,
      voices: [],
      lastStart: 0,
    },
    /* === BEGIN HU:HU-CHECKIN-15M checkin state (no tocar fuera) === */
    checkin: {
      panel: null,
      busy: false,
      rePromptTimers: new Map(),
    },
    /* === END HU:HU-CHECKIN-15M === */
    /* === BEGIN HU:HU-AUDIO-GESTO permissions state (no tocar fuera) === */
    permissions: {
      sound: false,
      haptics: false,
    },
    /* === END HU:HU-AUDIO-GESTO === */
  };

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
  };
  const SERVICIO_TIPO_MAP = {
    SIMPLE: "SIMPLE",
    "TIPO A": "TIPO A",
    "TIPO B": "TIPO B",
    A: "TIPO A",
    B: "TIPO B",
  };

  function normalizeEventType(value) {
    if (!value) return null;
    const key = String(value).toLowerCase().trim();
    return EVENT_TYPE_MAP[key] || null;
  }

  function normalizeServicioTipo(value) {
    if (!value) return null;
    const upper = String(value).toUpperCase().trim();
    if (SERVICIO_TIPO_MAP[upper]) return SERVICIO_TIPO_MAP[upper];
    if (upper === "TIPO_A") return "TIPO A";
    if (upper === "TIPO_B") return "TIPO B";
    return upper;
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
        const { error: err } = await client.from("alarm_event").insert(record);
        if (err) throw err;
      } catch (err) {
        warn("No se pudo reenviar registro en cola", err);
        remaining.push(normalizeRecord(item));
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
    if (options && typeof options.onCheckin === "function") {
      state.custodia.onCheckin = options.onCheckin;
    }
  }

  function initAdmin(options) {
    initBase("admin").catch(error);
    setupRealtimeChannel();
    setupEscShortcuts();
    if (options && typeof options.enrichEvent === "function")
      state.admin.enrichEvent = options.enrichEvent;
  }

  function setupEscShortcuts() {
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        sirenaOff();
        closePanicModal();
      }
    });
  }

  function subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    state.subscribers.add(fn);
    return () => state.subscribers.delete(fn);
  }

  async function emit(type, payload) {
    const sanitized = sanitizePayload(type, payload);
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
      log("[alarma] insert alarm_event", {
        type: record.type,
        servicio_id: record.servicio_id,
        empresa: record.empresa,
        cliente: record.cliente,
        placa: record.placa,
        tipo: record.tipo,
      });
      const dbRecord = { ...record };
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
      if (err) throw Object.assign(err, { status, statusText });
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
  async function triggerPush(type, eventRecord, options) {
    const endpoint =
      options && options.endpoint ? options.endpoint : PUSH_ENDPOINT;
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
        state.checkin.panel.classList.remove("is-open");
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
    if (state.admin.handled.has(key)) return;
    state.admin.currentPanicKey = key;
    state.admin.lastPanic = record;
    sirenaOn({ loop: true });
    const frase =
      record && record.cliente
        ? `ALERTA - ${record.cliente}`
        : "ALERTA DE ROBO";
    console.log("[panic] evento recibido", {
      servicio_id: record?.servicio_id || null,
      cliente: record?.cliente || null,
    });
    if (state.permissions.sound) {
      try {
        tts(frase, { lang: "es-PE" });
      } catch (err) {
        warn("No se pudo reproducir TTS de panico", err);
      }
    }
    if (state.permissions.haptics) {
      try {
        navigator.vibrate?.([360, 160, 360, 160, 520]);
      } catch (_) {}
    }
    notify({ type: "panic", record });
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
    return state.siren.audioCtx;
  }

  /* === BEGIN HU:HU-AUDIO-GESTO enable alerts (no tocar fuera) === */
  async function enableAlerts(options) {
    const opts = options || {};
    const wantSound = opts.sound !== false;
    const wantHaptics = opts.haptics !== false;
    let soundOk = state.permissions.sound;
    if (wantSound) {
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
    if (wantHaptics) {
      state.permissions.haptics = true;
    }
    return {
      sound: state.permissions.sound,
      haptics: state.permissions.haptics,
    };
  }
  /* === END HU:HU-AUDIO-GESTO === */

  function sirenaOn(options) {
    const opts = options || {};
    if (!state.permissions.sound) {
      console.warn("[audio] Sirena bloqueada por falta de permiso");
      showToast(
        "Activa sonido desde el boton de alertas para escuchar la sirena."
      );
      return;
    }
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    if (state.siren.interval) return;
    document.body.classList.add("alarma-siren-active");
    const voices = state.siren.voices;
    function playCycle() {
      try {
        const now = ctx.currentTime + 0.01;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.linearRampToValueAtTime(880, now + 0.5);
        osc.frequency.linearRampToValueAtTime(440, now + 1.0);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.45, now + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.05);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 1.05);
        voices.push({ osc, gain });
        osc.onended = () => {
          const idx = voices.findIndex((v) => v.osc === osc);
          if (idx >= 0) voices.splice(idx, 1);
        };
      } catch (err) {
        warn("No se pudo generar sirena", err);
      }
    }
    playCycle();
    state.siren.interval = setInterval(playCycle, opts.intervalMs || 1100);
    state.siren.lastStart = Date.now();
  }

  function sirenaOff() {
    if (state.siren.interval) {
      clearInterval(state.siren.interval);
      state.siren.interval = null;
    }
    state.siren.voices.forEach(({ osc, gain }) => {
      try {
        if (gain)
          gain.gain.exponentialRampToValueAtTime(
            0.0001,
            (gain.context || osc.context).currentTime + 0.05
          );
      } catch (_) {}
      try {
        osc.stop();
      } catch (_) {}
    });
    state.siren.voices = [];
    document.body.classList.remove("alarma-siren-active");
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
          <div>
            <div class="alarma-modal__title">Alerta de panico</div>
            <div class="alarma-modal__badge" aria-live="polite">Prioridad maxima</div>
          </div>
          <button type="button" class="alarma-btn alarma-btn--ghost js-alarma-close">Cerrar</button>
        </div>
        <div class="alarma-modal__body" id="alarma-modal-body"></div>
        <div class="alarma-modal__voice" id="alarma-modal-voice" hidden>
          <div class="alarma-voice-status" id="alarma-voice-status">Escuchando "silenciar alarma"...</div>
          <div class="alarma-voice-manual" id="alarma-voice-manual" hidden>
            <label for="alarma-voice-input">Escribe "silenciar alarma" para detener la sirena</label>
            <input id="alarma-voice-input" class="alarma-modal__input" type="text" autocomplete="off" placeholder="silenciar alarma" />
            <button type="button" class="alarma-btn alarma-btn--primary" id="alarma-voice-confirm">Confirmar</button>
          </div>
        </div>
        <div class="alarma-modal__actions">
          <button type="button" class="alarma-btn alarma-btn--danger js-alarma-silence">Silenciar</button>
          <button type="button" class="alarma-btn alarma-btn--primary js-alarma-focus">Fijar foco en ruta</button>
          <button type="button" class="alarma-btn alarma-btn--ghost js-alarma-ack">Reconocer</button>
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
      ack: backdrop.querySelector(".js-alarma-ack"),
      voiceConfirm: backdrop.querySelector("#alarma-voice-confirm"),
    };
    buttons.close?.addEventListener("click", () => {
      closePanicModal();
    });
    buttons.silence?.addEventListener("click", () => {
      sirenaOff();
    });
    buttons.ack?.addEventListener("click", () => {
      sirenaOff();
      closePanicModal();
      markPanicHandled();
      notify({ type: "panic-ack" });
    });
    buttons.focus?.addEventListener("click", () => {
      notify({ type: "panic-focus" });
    });
    buttons.voiceConfirm?.addEventListener("click", () => {
      const input = backdrop.querySelector("#alarma-voice-input");
      if (!input) return;
      if (
        String(input.value || "")
          .toLowerCase()
          .includes("silenciar")
      ) {
        sirenaOff();
        closePanicModal();
        markPanicHandled();
        notify({ type: "panic-ack", via: "manual" });
      }
    });
    state.admin.modal = backdrop;
    state.admin.modalBackdrop = backdrop;
    return backdrop;
  }

  function closePanicModal() {
    const modal = state.admin.modalBackdrop;
    if (!modal) return;
    modal.classList.remove("is-open");
    stopVoiceRecognition();
  }

  function openPanicModal(record) {
    const modal = ensureModal();
    const body = modal.querySelector("#alarma-modal-body");
    if (body) {
      body.innerHTML = "";
      const rows = [
        { label: "Cliente", value: record?.cliente || "-" },
        { label: "Placa", value: record?.placa || "-" },
        { label: "Servicio", value: record?.servicio_id || "-" },
        { label: "Empresa", value: record?.empresa || "-" },
        { label: "Direccion", value: record?.direccion || "-" },
        { label: "Hora", value: formatTime(record?.timestamp) },
      ];
      rows.forEach((row) => {
        const div = document.createElement("div");
        div.className = "alarma-modal__row";
        div.innerHTML = `<strong>${clip(row.label, 32)}</strong><span>${
          clip(row.value, MAX_STRING) || "-"
        }</span>`;
        body.appendChild(div);
      });
    }
    modal.classList.add("is-open");
    startVoiceRecognition();
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

  function startVoiceRecognition() {
    const Recognition =
      global.SpeechRecognition || global.webkitSpeechRecognition;
    const panel = state.admin.modalBackdrop?.querySelector(
      "#alarma-modal-voice"
    );
    const status = panel?.querySelector("#alarma-voice-status");
    const fallback = state.admin.modalBackdrop?.querySelector(
      "#alarma-voice-manual"
    );
    if (panel) panel.hidden = false;
    if (!Recognition) {
      if (status)
        status.textContent =
          "Reconocimiento de voz no soportado. Usa el formulario.";
      if (fallback) fallback.hidden = false;
      state.admin.voice.fallbackVisible = true;
      return;
    }
    if (fallback) fallback.hidden = true;
    state.admin.voice.fallbackVisible = false;
    try {
      if (state.admin.voice.recognition) {
        state.admin.voice.recognition.stop();
      }
    } catch (_) {}
    try {
      const recog = new Recognition();
      recog.lang = "es-PE";
      recog.continuous = false;
      recog.interimResults = false;
      recog.maxAlternatives = 3;
      recog.onstart = () => {
        if (status) status.textContent = 'Escuchando "silenciar alarma"...';
      };
      recog.onerror = (event) => {
        warn("SpeechRecognition error", event.error);
        if (status)
          status.textContent = "No se pudo escuchar. Usa el formulario manual.";
        if (fallback) fallback.hidden = false;
      };
      recog.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map((res) => res[0]?.transcript)
          .join(" ")
          .toLowerCase();
        if (transcript.includes("silenciar") || transcript.includes("apagar")) {
          sirenaOff();
          closePanicModal();
          markPanicHandled();
          notify({ type: "panic-ack", via: "voice" });
        } else if (status) {
          status.textContent = `Escuchado: "${transcript}". Repite "Silenciar alarma".`;
        }
      };
      recog.onend = () => {
        if (state.admin.voice.fallbackVisible) return;
        // Reiniciar captura mientras la alarma este activa
        if (state.admin.modalBackdrop?.classList.contains("is-open")) {
          try {
            recog.start();
          } catch (err) {
            warn(err);
          }
        }
      };
      recog.start();
      state.admin.voice.recognition = recog;
    } catch (err) {
      warn("No se pudo iniciar reconocimiento de voz", err);
      if (status)
        status.textContent =
          "Error al iniciar reconocimiento. Usa el formulario.";
      if (fallback) fallback.hidden = false;
    }
  }

  function stopVoiceRecognition() {
    if (state.admin.voice.recognition) {
      try {
        state.admin.voice.recognition.onend = null;
        state.admin.voice.recognition.stop();
      } catch (_) {}
      state.admin.voice.recognition = null;
    }
  }

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
      if (perm !== "granted")
        throw new Error("Permiso de notificaciones denegado");
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

  /* === BEGIN HU:HU-CHECKIN-15M checkin ui (no tocar fuera) === */
  function openCheckinPrompt(payload) {
    if (state.mode !== "custodia") return;
    const panel = ensureCheckinPanel();
    populateCheckinPanel(panel, payload);
    panel.classList.add("is-open");
    panel.dataset.method = "text";
    try {
      panel.focus();
    } catch (_) {}
    updateCheckinSoundButton(panel);
    toggleCheckinSoundHint(panel, !state.permissions.sound);
    if (state.permissions.haptics) {
      try {
        navigator.vibrate?.([240, 120, 240]);
      } catch (_) {}
    }
    if (state.permissions.sound) {
      try {
        const frase = panel.dataset.cliente
          ? `Reportese ${panel.dataset.cliente}`
          : "Reportese ahora";
        tts(frase, { lang: "es-PE" });
      } catch (err) {
        warn("No se pudo reproducir TTS", err);
      }
    }
    console.log("[checkin] panel abierto", {
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
    const panel = document.createElement("div");
    panel.className = "alarma-checkin";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-live", "assertive");
    panel.tabIndex = -1;
    panel.innerHTML = `
      <div class="alarma-checkin__dialog">
        <div class="alarma-checkin__header">
          <div>
            <div class="alarma-checkin__eyebrow">REPORTESE</div>
            <h3 class="alarma-checkin__title">Servicio <span class="js-checkin-servicio">-</span></h3>
            <p class="alarma-checkin__subtitle">Confirma tu ubicacion actual y avisa por WhatsApp.</p>
            <p class="alarma-checkin__hint js-checkin-sound-hint" hidden>Activa sonido para escuchar la alerta.</p>
          </div>
          <button type="button" class="alarma-btn alarma-btn--ghost js-checkin-enable-sound">Habilitar sonido</button>
        </div>
        <div class="alarma-checkin__body">
          <div class="alarma-checkin__client"><strong>Cliente:</strong> <span class="js-checkin-cliente">-</span></div>
          <div class="alarma-checkin__placa"><strong>Placa:</strong> <span class="js-checkin-placa">-</span></div>
          <div class="alarma-checkin__meta js-checkin-meta">Intento 1 - Reporta tu ubicacion actual.</div>
          <div class="alarma-checkin__options">
            <button type="button" class="alarma-btn alarma-btn--primary js-checkin-voice">Grabar voz</button>
            <div class="alarma-checkin__field">
              <label for="alarma-checkin-input">Donde te encuentras?</label>
              <textarea id="alarma-checkin-input" class="alarma-checkin__input" rows="3" placeholder="Ej. Ingresando a puerta 3, sin novedad."></textarea>
            </div>
          </div>
        </div>
        <div class="alarma-checkin__actions">
          <button type="button" class="alarma-btn alarma-btn--danger js-checkin-confirm">Confirmar y silenciar</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    panel
      .querySelector(".js-checkin-confirm")
      ?.addEventListener("click", () => confirmCheckin(panel));
    panel
      .querySelector(".js-checkin-voice")
      ?.addEventListener("click", () => captureCheckinVoice(panel));
    panel
      .querySelector(".js-checkin-enable-sound")
      ?.addEventListener("click", async () => {
        try {
          await enableAlerts({ sound: true, haptics: true });
          updateCheckinSoundButton(panel);
          toggleCheckinSoundHint(panel, false);
        } catch (err) {
          showToast("No se pudo habilitar el sonido. Reintenta.");
        }
      });
    updateCheckinSoundButton(panel);
    toggleCheckinSoundHint(panel, !state.permissions.sound);
    state.checkin.panel = panel;
    return panel;
  }

  function populateCheckinPanel(panel, payload) {
    const data = payload?.event || payload || {};
    const servicioId = data.servicio_id || payload?.servicio_id || "";
    const cliente = data.cliente || payload?.cliente || "N/D";
    const placa = data.placa || data.placa_upper || "S/N";
    const attemptSource =
      Number(data.metadata?.attempt || payload?.metadata?.attempt) || 1;
    const attempt = attemptSource > 0 ? attemptSource : 1;
    const serviceSpan = panel.querySelector(".js-checkin-servicio");
    if (serviceSpan) serviceSpan.textContent = placa;
    const clienteSpan = panel.querySelector(".js-checkin-cliente");
    if (clienteSpan) clienteSpan.textContent = cliente;
    const placaSpan = panel.querySelector(".js-checkin-placa");
    if (placaSpan) placaSpan.textContent = placa;
    const meta = panel.querySelector(".js-checkin-meta");
    if (meta)
      meta.textContent = `Intento ${attempt} - Reporta tu ubicacion actual.`;
    panel.dataset.servicioId = servicioId ? String(servicioId) : "";
    panel.dataset.empresa = data.empresa || "";
    panel.dataset.cliente = cliente;
    panel.dataset.placa = placa;
    panel.dataset.tipo = data.tipo || "";
    panel.dataset.attempt = attempt;
    panel.dataset.method = "text";
    const input = panel.querySelector("#alarma-checkin-input");
    if (input) input.value = "";
  }

  function updateCheckinSoundButton(panel) {
    const btn = panel?.querySelector(".js-checkin-enable-sound");
    if (!btn) return;
    if (state.permissions.sound) {
      btn.textContent = "Sonido activo";
      btn.disabled = true;
    } else {
      btn.textContent = "Habilitar sonido";
      btn.disabled = false;
    }
  }

  function toggleCheckinSoundHint(panel, visible) {
    const hint = panel?.querySelector(".js-checkin-sound-hint");
    if (hint) hint.hidden = !visible;
  }

  function captureCheckinVoice(panel) {
    const Recognition =
      global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!Recognition) {
      showToast("Reconocimiento de voz no disponible en este dispositivo");
      return;
    }
    const button = panel.querySelector(".js-checkin-voice");
    if (button) {
      button.disabled = true;
      button.textContent = "Escuchando...";
    }
    try {
      const recog = new Recognition();
      recog.lang = "es-PE";
      recog.continuous = false;
      recog.interimResults = false;
      recog.maxAlternatives = 2;
      recog.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        const input = panel.querySelector("#alarma-checkin-input");
        if (input) input.value = transcript;
        panel.dataset.method = "voice";
        panel.dataset.transcript = transcript;
        showToast("Se registro tu voz. Revisa el texto antes de confirmar.");
      };
      recog.onerror = () => {
        showToast("No se pudo capturar tu voz. Escribe la respuesta.");
      };
      recog.onend = () => {
        if (button) {
          button.disabled = false;
          button.textContent = "Responder por voz";
        }
      };
      recog.start();
    } catch (err) {
      warn("Error al iniciar reconocimiento de voz para check-in", err);
      if (button) {
        button.disabled = false;
        button.textContent = "Responder por voz";
      }
    }
  }

  async function confirmCheckin(panelArg) {
    const panel = panelArg || state.checkin.panel;
    if (!panel) return;
    if (state.checkin.busy) return;
    const input = panel.querySelector("#alarma-checkin-input");
    const texto = clip((input && input.value) || "", MAX_STRING);
    if (!texto) {
      showToast("Ingresa tu ubicacion actual antes de confirmar.");
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
      panel.classList.remove("is-open");
      showToast(
        "Conforme. Ahora reportate en el grupal de WhatsApp con las evidencias."
      );
      panel.dataset.method = "text";
      console.log("[checkin] confirmado", {
        servicio_id: servicioId || null,
        method,
        attempt,
      });
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
    /* === BEGIN HU:HU-AUDIO-GESTO api permissions (no tocar fuera) === */
    getPermissions() {
      return { ...state.permissions };
    },
    /* === END HU:HU-AUDIO-GESTO === */
  };

  Object.defineProperty(api, "queueLength", {
    get() {
      return state.queue.length;
    },
  });

  global.Alarma = api;
})(window);





