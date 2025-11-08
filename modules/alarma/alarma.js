(function (global) {
  "use strict";

  const STORAGE_QUEUE = "alarma.queue.v1";
  const STORAGE_FLAGS = "alarma.flags.v1";
  const STORAGE_PUSH = "alarma.push.metadata";
  const CHANNEL_NAME = "alarma-events";
  const PUSH_ENDPOINT = "/.netlify/functions/push-broadcast";
  const CHECKIN_ENDPOINT = "/.netlify/functions/push-send";
  const MAX_STRING = 180;
  const TOAST_TIMEOUT = 4200;
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
    checkin: {
      panel: null,
      busy: false,
      rePromptTimers: new Map(),
    },
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

  function sanitizePayload(type, raw) {
    const payload = raw || {};
    const placaSource = payload.placa != null ? String(payload.placa) : null;
    const empresaSource =
      payload.empresa != null ? String(payload.empresa) : null;
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
    const safe = {
      type: clip(type, 32),
      servicio_id: payload.servicio_id ?? null,
      empresa: clip(empresaSource ? empresaSource.toUpperCase() : null, 60),
      cliente: clip(payload.cliente, 80),
      placa: clip(
        placaSource ? placaSource.toUpperCase().replace(/\s+/g, "") : null,
        16
      ),
      tipo: clip(payload.tipo, 32),
      lat:
        typeof payload.lat === "number" ? Number(payload.lat.toFixed(6)) : null,
      lng:
        typeof payload.lng === "number" ? Number(payload.lng.toFixed(6)) : null,
      direccion: clip(payload.direccion, MAX_STRING),
      timestamp: payload.timestamp || new Date().toISOString(),
      metadata,
    };
    if (!safe.metadata || !Object.keys(safe.metadata).length)
      delete safe.metadata;
    return safe;
  }

  function buildMetadataFromSanitized(sanitized) {
    const metadata = {};
    if (sanitized.lat != null) metadata.lat = sanitized.lat;
    if (sanitized.lng != null) metadata.lng = sanitized.lng;
    if (sanitized.direccion) metadata.direccion = sanitized.direccion;
    if (sanitized.metadata && typeof sanitized.metadata === "object") {
      Object.assign(metadata, sanitized.metadata);
    }
    return Object.keys(metadata).length ? metadata : null;
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
      } else if (state.mode === "custodia") {
        if (data.event === "checkin-reminder") {
          openCheckinPrompt(data.payload || {});
        }
      }
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
      const dbRecord = { ...record };
      const { data, error: err } = await client
        .from("alarm_event")
        .insert(dbRecord)
        .select("*")
        .single();
      if (err) throw err;
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
      error("No se pudo insertar alarm_event", err);
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
      console.log("[alertas] broadcast respuesta", {
        endpoint,
        status: res.status,
        body: responseBody,
      });
      if (!res.ok) throw new Error(`Push ${endpoint} -> ${res.status}`);
    } catch (err) {
      warn("Fetch push fallo", err);
    }
  }

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
    return { roles: ["ADMIN"], empresa: null };
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
    } else if (type === "checkin_reminder" && state.mode === "custodia") {
      openCheckinPrompt(record);
    }
  }

  function highlightService(record, metadata) {
    const key = startKey(record);
    if (state.admin.handled.has(key)) return;
    state.admin.handled.add(key);
    persistFlags();
    notify({ type: "highlight", record, metadata });
    if (document.hidden && navigator.vibrate) {
      try {
        navigator.vibrate([120, 60, 120]);
      } catch (_) {}
    }
  }

  function activatePanic(record) {
    const key = panicKey(record);
    if (state.admin.handled.has(key)) return;
    state.admin.currentPanicKey = key;
    state.admin.lastPanic = record;
    sirenaOn({ loop: true });
    const frase =
      record && record.cliente
        ? `ALERTA DE ROBO - ${record.cliente}`
        : "ALERTA DE ROBO";
    notify({ type: "panic", record });
  }

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

  function sirenaOn(options) {
    const opts = options || {};
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
      user_agent: userAgentSource
        ? clip(String(userAgentSource), 360)
        : null,
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
        console.error("[alertas] No se pudo registrar push", upsertError);
        console.error("[alertas] Payload keys", Object.keys(payload || {}));
        showToast(
          "[alertas] No se pudo registrar notificaciones. Revisa consola."
        );
        throw upsertError;
      }
      try {
        const { data: verifyRows, error: verifyErr } = await client
          .from("push_subscription")
          .select("id,is_active,last_seen_at")
          .eq("endpoint", payload.endpoint);
        if (verifyErr) {
          warn("[alertas] Conteo de suscriptores fallo", verifyErr);
        } else {
          const activeCount = (verifyRows || []).filter(
            (row) => row?.is_active !== false
          ).length;
          console.log("[alertas] push registrado OK", {
            endpoint: clip(payload.endpoint, 200),
            activos: activeCount,
            registros: verifyRows?.length || 0,
          });
        }
      } catch (verifyErr) {
        warn("[alertas] No se pudo verificar el registro push", verifyErr);
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

  function openCheckinPrompt(payload) {
    if (state.mode !== "custodia") return;
    const panel = ensureCheckinPanel();
    populateCheckinPanel(panel, payload);
    panel.classList.add("is-open");
    try {
      navigator.vibrate?.([160, 60, 160]);
    } catch (_) {}
  }

  function ensureCheckinPanel() {
    if (state.checkin.panel) return state.checkin.panel;
    const panel = document.createElement("div");
    panel.className = "alarma-checkin";
    panel.innerHTML = `
      <div class="alarma-checkin__title" aria-live="assertive">Confirma tu estado</div>
      <div class="alarma-checkin__desc">Responde por voz o texto para confirmar tu ubicacion actual.</div>
      <div class="alarma-checkin__options">
        <button type="button" class="alarma-btn alarma-btn--primary js-checkin-voice">Responder por voz</button>
        <div class="alarma-checkin__field">
          <label for="alarma-checkin-input">Donde te encuentras?</label>
          <input id="alarma-checkin-input" class="alarma-checkin__input" type="text" placeholder="Ej. Antes de entrar al puerto">
        </div>
      </div>
      <div class="alarma-checkin__actions">
        <button type="button" class="alarma-btn alarma-btn--primary js-checkin-confirm">Confirmar</button>
        <button type="button" class="alarma-btn alarma-btn--ghost alarma-checkin__close js-checkin-close">Cerrar</button>
      </div>
    `;
    document.body.appendChild(panel);
    panel
      .querySelector(".js-checkin-close")
      ?.addEventListener("click", () => panel.classList.remove("is-open"));
    panel
      .querySelector(".js-checkin-confirm")
      ?.addEventListener("click", () => confirmCheckin(panel));
    panel
      .querySelector(".js-checkin-voice")
      ?.addEventListener("click", () => captureCheckinVoice(panel));
    state.checkin.panel = panel;
    return panel;
  }

  function populateCheckinPanel(panel, payload) {
    const desc = panel.querySelector(".alarma-checkin__desc");
    const title = panel.querySelector(".alarma-checkin__title");
    if (title)
      title.textContent = `Confirma tu estado - Servicio ${
        payload?.servicio_id || ""
      }`;
    if (desc)
      desc.textContent = `Cliente: ${
        payload?.cliente || "N/D"
      } - Ultimo check-in hace ${payload?.diff_minutes || "?"} min.`;
    panel.dataset.servicioId = payload?.servicio_id || "";
    panel.dataset.empresa = payload?.empresa || "";
    panel.dataset.cliente = payload?.cliente || "";
    const input = panel.querySelector("#alarma-checkin-input");
    if (input) input.value = "";
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
    state.checkin.busy = true;
    try {
      await emit("checkin_ok", {
        servicio_id: panel.dataset.servicioId,
        empresa: panel.dataset.empresa,
        cliente: panel.dataset.cliente,
        lat: last?.lat || null,
        lng: last?.lng || null,
        metadata: { respuesta: texto },
      });
      panel.classList.remove("is-open");
      showToast("Check-in confirmado. Gracias.");
    } catch (err) {
      warn("Error al registrar check-in", err);
      showToast("No se pudo registrar. Se guardara offline.");
    } finally {
      state.checkin.busy = false;
    }
  }

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
  };

  Object.defineProperty(api, "queueLength", {
    get() {
      return state.queue.length;
    },
  });

  global.Alarma = api;
})(window);
