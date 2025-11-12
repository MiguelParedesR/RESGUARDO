// dashboard-custodia.js - Registro por custodio (bloques) + Autocomplete + Mapa + Selfie por bloque

document.addEventListener("DOMContentLoaded", () => {
  const snackbar = document.getElementById("app-snackbar");
  const showMsg = (message, timeout = 2500) => {
    try {
      if (snackbar?.MaterialSnackbar)
        snackbar.MaterialSnackbar.showSnackbar({ message, timeout });
      else alert(message);
    } catch {
      alert(message);
    }
  };

  const empresa = (sessionStorage.getItem("auth_empresa") || "").toUpperCase();
  if (!empresa) {
    location.replace("/html/login/login.html");
    return;
  }
  if (!window.sb) {
    showMsg("Supabase no inicializado");
    return;
  }

  // UI refs
  const form = document.getElementById("form-custodia");
  const tipoEl = document.getElementById("tipo");
  const clienteEl = document.getElementById("cliente");
  const placaEl = document.getElementById("placa");
  const destinoEl = document.getElementById("destino");
  const sugList = document.getElementById("destino-suggestions");
  const btnAbrirMapa = document.getElementById("btn-abrir-mapa");
  const btnAlarmaPush = document.getElementById("btn-alarma-push-custodia");
  const direccionEstado = document.getElementById("direccion-estado");
  const custContainer = document.getElementById("custodios-container");
  // Modal servicio activo
  const modalAct = document.getElementById("modal-servicio-activo");
  const mactCliente = document.getElementById("mact-cliente");
  const mactDestino = document.getElementById("mact-destino");
  const mactList = document.getElementById("mact-custodios");
  const mBtnJoin = document.getElementById("mact-join");
  const mBtnVer = document.getElementById("mact-ver");
  const mBtnNuevo = document.getElementById("mact-nuevo");
  const mBtnCancel = document.getElementById("mact-cancel");

  // Modal mapa
  const modalMapa = document.getElementById("modal-mapa");
  const mapSearchInput = document.getElementById("map-search-input");
  const mapSearchBtn = document.getElementById("map-search-btn");
  const mapAceptar = document.getElementById("map-aceptar");
  const mapCerrar = document.getElementById("map-cerrar");
  const mapContainerId = "map-container";

  const hasAlarma = typeof window.Alarma === "object";
  const hasPushKey = Boolean(window.APP_CONFIG?.WEB_PUSH_PUBLIC_KEY);
  let pushRegisteredAuto = false;
  if (hasAlarma) {
    try {
      window.Alarma.initCustodia();
    } catch (err) {
      console.warn("[alarma] initCustodia error", err);
    }
    try {
      window.Alarma.subscribe((evt) => {
        if (evt?.type === "emit" && evt.status === "queued") {
          showMsg("Evento de alarma en cola. Se enviara al reconectar.");
        }
      });
    } catch (err) {
      console.warn("[alarma] subscribe error", err);
    }
  }
  if (btnAlarmaPush) {
    btnAlarmaPush.disabled = true;
    btnAlarmaPush.style.display = "none";
  }
  // Estado global
  let destinoCoords = null; // {lat,lng}
  let map = null,
    mapMarker = null,
    mapReady = false;
  let acIndex = -1,
    lastQuery = "";
  let userLat = null,
    userLng = null; // proximidad
  let currentTipo = "Simple";
  let custodiosUI = []; // [{ kind, root, nameInput, video, canvas, img, btnStart, btnShot, btnReset, status, stream, selfieDataUrl }]
  let activeSvc = null; // servicio activo detectado por placa
  let activeCustodios = []; // custodios del servicio activo
  let forceNew = false; // si el usuario elige "Nuevo"

  // === BEGIN HU:HU-PLACEHOLDER-CONSISTENCIA (NO TOCAR FUERA) ===
  const placeholderWatcher = (event) => {
    const target = event.target;
    if (!target?.classList?.contains("mdl-textfield__input")) return;
    togglePlaceholderState(target);
  };
  document.addEventListener("input", placeholderWatcher, true);
  document.addEventListener("change", placeholderWatcher, true);
  function togglePlaceholderState(inputEl) {
    if (!inputEl) return;
    const hasValue = Boolean(String(inputEl.value || "").trim());
    inputEl.classList.toggle("has-value", hasValue);
    const wrapper = inputEl.closest(".mdl-textfield");
    if (!wrapper) return;
    wrapper.classList.toggle("is-dirty", hasValue);
  }
  function primePlaceholderState() {
    document
      .querySelectorAll(".mdl-textfield__input")
      .forEach((el) => togglePlaceholderState(el));
  }
  primePlaceholderState();
  console.log("[task][HU-PLACEHOLDER-CONSISTENCIA] done", {
    scope: "dashboard-custodia",
  });
  // === END HU:HU-PLACEHOLDER-CONSISTENCIA ===

  // === BEGIN HU:HU-SEGUIR-REDIRECT sesiones (NO TOCAR FUERA) ===
  function primeCustodiaSession(payload, source = "registro") {
    console.assert(
      payload?.servicio_id && payload?.servicio_custodio_id,
      "[task][HU-SEGUIR-REDIRECT] payload inválido",
      { source, payload }
    );
    if (
      !payload ||
      !payload.servicio_id ||
      !payload.servicio_custodio_id ||
      !window.localStorage
    ) {
      console.warn("[session] payload inválido", { source, payload });
      return null;
    }
    try {
      if (window.CustodiaSession?.save) {
        const saved = window.CustodiaSession.save(payload);
        console.log("[session] ready", {
          source,
          servicio: saved?.servicio_id,
          custodio: saved?.servicio_custodio_id,
        });
        return saved;
      }
    } catch (err) {
      console.warn("[session] save error", err);
    }
    try {
      const ttl = window.CustodiaSession?.TTL_MS || 4 * 60 * 60 * 1000; /* 4h */
      const fallback = { ...payload, exp_ts: Date.now() + ttl };
      const key = window.CustodiaSession?.KEY || "custodia_session";
      window.localStorage.setItem(key, JSON.stringify(fallback));
      console.log("[session] fallback ready", {
        source,
        servicio: payload.servicio_id,
      });
      return fallback;
    } catch (err) {
      console.warn("[session] fallback error", err);
      return null;
    }
  }
  function redirectMapa(servicioId, source = "registro") {
    try {
      sessionStorage.setItem("servicio_id_actual", servicioId);
    } catch {}
    console.log("[task][HU-SEGUIR-REDIRECT] done", { source, servicioId });
    setTimeout(() => {
      location.href = "/html/dashboard/mapa-resguardo.html";
    }, 200);
  }
  // === END HU:HU-SEGUIR-REDIRECT ===

  // === BEGIN HU:HU-CUSTODIA-UPDATE-FIX (NO TOCAR FUERA) ===
  async function updateCustodia({ scId, nombre, tipo }) {
    try {
      if (!window.sb) throw new Error("Supabase no inicializado");
      if (!scId) throw new Error("scId requerido");
      const payload = {};
      if (typeof nombre === "string" && nombre.trim()) {
        payload.nombre_custodio = nombre.trim();
      }
      if (typeof tipo === "string" && tipo.trim()) {
        payload.tipo_custodia = tipo.trim();
      }
      if (!Object.keys(payload).length) {
        console.log("[custodia-update] skip", { sc_id: scId });
        return { ok: true, data: null };
      }
      console.log("[custodia-update] start", { sc_id: scId, payload });
      const { data, error, status } = await window.sb
        .from("servicio_custodio")
        .update(payload, { returning: "representation" })
        .eq("id", scId)
        .select("id, servicio_id, nombre_custodio, tipo_custodia")
        .maybeSingle();
      if (error) {
        console.warn("[custodia-update] FAIL", { sc_id: scId, status, error });
        throw error;
      }
      let row = data;
      if (!row) {
        const { data: fallback, error: fetchError } = await window.sb
          .from("servicio_custodio")
          .select("id, servicio_id, nombre_custodio, tipo_custodia")
          .eq("id", scId)
          .maybeSingle();
        if (fetchError) throw fetchError;
        if (!fallback) throw new Error("Custodio no encontrado");
        row = fallback;
      }
      console.log("[custodia-update] OK", {
        sc_id: scId,
        servicio_id: row?.servicio_id || null,
      });
      return { ok: true, data: row };
    } catch (err) {
      console.warn("[error]", {
        scope: "dashboard-custodia/update",
        message: err?.message || "unknown",
        scId,
      });
      return { ok: false, error: err };
    }
  }
  // === END HU:HU-CUSTODIA-UPDATE-FIX ===

  // === BEGIN HU:HU-CAMERA-COMPACT-UI (NO TOCAR FUERA) ===
  async function saveSelfie(scId, blob) {
    try {
      if (!window.sb) throw new Error("Supabase no inicializado");
      if (!scId || !blob) throw new Error("Parametros invalidos para selfie");
      const mime = blob.type || "image/jpeg";
      const hexBytes = await blobToHex(blob);
      const { data, error, status } = await window.sb
        .from("selfie")
        .insert(
          {
            servicio_custodio_id: scId,
            mime_type: mime,
            bytes: hexBytes,
          },
          { returning: "representation" }
        )
        .select("id, servicio_custodio_id, created_at")
        .single();
      if (error) {
        console.warn("[selfie] FAIL", { sc_id: scId, status, error });
        throw error;
      }
      console.log("[selfie] OK", { sc_id: scId, selfie_id: data?.id });
      return { ok: true, data };
    } catch (err) {
      console.warn("[selfie] FAIL", {
        sc_id: scId,
        message: err?.message || "unknown",
      });
      return { ok: false, error: err };
    }
  }

  async function dataUrlToBlob(dataUrl) {
    if (!dataUrl?.startsWith("data:")) {
      throw new Error("Selfie invalida");
    }
    const res = await fetch(dataUrl);
    return await res.blob();
  }

  async function blobToHex(blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let hex = "";
    bytes.forEach((b) => {
      hex += b.toString(16).padStart(2, "0");
    });
    return "\\x" + hex;
  }

  function applySelfiePreview(targetImg, blob) {
    if (!targetImg || !blob) return;
    const objectUrl = URL.createObjectURL(blob);
    targetImg.src = objectUrl;
    targetImg.style.display = "block";
    console.log("[camera-ui] preview updated", { sc_id: targetImg.dataset?.id });
    setTimeout(() => {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch (_) {}
    }, 30000);
  }
  // === END HU:HU-CAMERA-COMPACT-UI ===

  // Geo temprana
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;
        try {
          if (hasAlarma && window.Alarma?.setLocation)
            window.Alarma.setLocation(userLat, userLng, {
              accuracy: pos.coords.accuracy,
            });
        } catch (err) {
          console.warn("[alarma] setLocation", err);
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 10000 }
    );
  }

  // Normalizacion placa
  placaEl.addEventListener("input", () => {
    placaEl.value = placaEl.value.toUpperCase().replace(/\s+/g, "");
    togglePlaceholderState(placaEl);
  });
  placaEl.addEventListener("blur", async () => {
    try {
      const up = (placaEl.value || "").toUpperCase().replace(/\s+/g, "");
      if (!up) return;
      await detectServicioActivo(up, true);
    } catch {
      showMsg("Error al consultar placa");
    }
  });

  // Render dinamico de bloques
  function kindsForTipo(t) {
    if (t === "Tipo B") return ["cabina", "vehiculo"];
    if (t === "Tipo A") return ["vehiculo"];
    return ["cabina"];
  }
  function labelForKind(k) {
    return k === "vehiculo" ? "Custodia en VehIculo" : "Custodia en Cabina";
  }
  function tipoForKind(k) {
    return k === "vehiculo" ? "Tipo A" : "Simple";
  }
  function stopStream(ui) {
    try {
      ui.stream?.getTracks().forEach((t) => t.stop());
    } catch {}
    ui.stream = null;
    if (ui?.triggerBtn) {
      ui.triggerBtn.disabled = false;
    }
    if (ui?.video) {
      ui.video.srcObject = null;
      ui.video.style.display = "none";
    }
    if (ui?.cameraArea) {
      ui.cameraArea.classList.remove("active");
      ui.cameraArea.style.display = "none";
    }
  }

  function renderCustodios() {
    // detener camaras anteriores
    try {
      custodiosUI.forEach(stopStream);
    } catch {}
    custodiosUI = [];
    custContainer.innerHTML = "";
    const kinds = kindsForTipo(currentTipo);
    for (const kind of kinds) {
      const sec = document.createElement("section");
      sec.className = "custodio-block";
      sec.dataset.kind = kind;
      sec.innerHTML = `
        <h3>${labelForKind(kind)}</h3>
        <div class="mdl-textfield mdl-js-textfield mdl-textfield--floating-label">
          <input class="mdl-textfield__input" type="text" placeholder="Nombre del custodio">
          <label class="mdl-textfield__label">Nombre del custodio</label>
        </div>
        <div class="selfie-compact">
          <button type="button" class="selfie-trigger" aria-label="Tomar selfie">
            <span class="material-icons" aria-hidden="true">photo_camera</span>
          </button>
          <img alt="Selfie" class="selfie-thumb" hidden />
          <p class="selfie-hint">Captura la selfie requerida para este puesto.</p>
        </div>
        <div class="camera-area">
          <video playsinline autoplay muted></video>
          <canvas style="display:none"></canvas>
          <div class="camera-actions">
            <button type="button" class="btn-tomar mdl-button mdl-js-button" disabled>Tomar selfie</button>
            <button type="button" class="btn-repetir mdl-button mdl-js-button" disabled>Repetir</button>
          </div>
          <div class="cam-estado"></div>
        </div>`;
      const nameInput = sec.querySelector('input[type="text"]');
      const video = sec.querySelector("video");
      const thumb = sec.querySelector(".selfie-thumb");
      const canvas = sec.querySelector("canvas");
      const triggerBtn = sec.querySelector(".selfie-trigger");
      const btnShot = sec.querySelector(".btn-tomar");
      const btnReset = sec.querySelector(".btn-repetir");
      const status = sec.querySelector(".cam-estado");
      const cameraArea = sec.querySelector(".camera-area");
      cameraArea.style.display = "none";
      const closeCameraArea = (message) => {
        stopStream(ui);
        cameraArea.style.display = "none";
        cameraArea.classList.remove("active");
        if (message) status.textContent = message;
        btnShot.disabled = true;
        btnReset.disabled = true;
        triggerBtn.disabled = false;
      };
      const ui = {
        kind,
        root: sec,
        nameInput,
        video,
        img: thumb,
        canvas,
        triggerBtn,
        btnShot,
        btnReset,
        cameraArea,
        status,
        stream: null,
        selfieDataUrl: null,
      };

      triggerBtn.addEventListener("click", async () => {
        try {
          triggerBtn.disabled = true;
          status.textContent = "Iniciando camara...";
          ui.stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user" },
            audio: false,
          });
          video.srcObject = ui.stream;
          video.style.display = "block";
          cameraArea.classList.add("active");
          cameraArea.style.display = "grid";
          btnShot.disabled = false;
          btnReset.disabled = true;
          status.textContent = "Camara lista";
        } catch (e) {
          status.textContent = "No se pudo acceder a la camara";
          triggerBtn.disabled = false;
        }
      });
      btnShot.addEventListener("click", () => {
        if (!ui.stream) {
          showMsg("Inicia la camara primero");
          return;
        }
        const w = video.videoWidth || 640,
          h = video.videoHeight || 480;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, w, h);
        ui.selfieDataUrl = canvas.toDataURL("image/jpeg", 0.85);
        thumb.src = ui.selfieDataUrl;
        thumb.classList.add("show");
        thumb.removeAttribute("hidden");
        video.style.display = "none";
        btnShot.disabled = true;
        btnReset.disabled = true;
        status.textContent = "Selfie capturada";
        closeCameraArea("Selfie capturada");
      });
      btnReset.addEventListener("click", () => {
        ui.selfieDataUrl = null;
        thumb.classList.remove("show");
        thumb.setAttribute("hidden", "hidden");
        closeCameraArea("Listo para otra selfie");
      });

      custodiosUI.push(ui);
      custContainer.appendChild(sec);
    }
  }

  async function emitirInicioServicio(servicioId, detalle) {
    if (!hasAlarma || !window.Alarma?.emit) return;
    try {
      await window.Alarma.emit("start", {
        servicio_id: servicioId,
        empresa,
        cliente: detalle?.cliente || null,
        placa: detalle?.placa || null,
        tipo: detalle?.tipo || null,
        lat: userLat,
        lng: userLng,
        timestamp: new Date().toISOString(),
        metadata: {
          destino: detalle?.destino || null,
          origen: "dashboard-custodia",
        },
      });
      if (
        !pushRegisteredAuto &&
        hasPushKey &&
        typeof window.Alarma?.registerPush === "function"
      ) {
        try {
          await window.Alarma.registerPush("custodia", empresa, {
            origen: "dashboard-custodia",
            modo: "auto",
            servicio_id: servicioId,
          });
          pushRegisteredAuto = true;
          showMsg("Alertas activadas para este servicio.");
        } catch (err) {
          console.warn("[alarma] registerPush auto", err);
        }
      }
    } catch (err) {
      console.warn("[alarma] emit start", err);
    }
  }

  tipoEl.addEventListener("change", () => {
    currentTipo = tipoEl.value;
    renderCustodios();
  });
  currentTipo = tipoEl.value;
  renderCustodios();

  // ===== Autocomplete (LocationIQ) PERU + proximidad =====
  const locKey =
    (window.APP_CONFIG && window.APP_CONFIG.LOCATIONIQ_KEY) || null;
  const debounce = (fn, ms = 250) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };
  const PERU_VIEWBOX = "-81.33,-18.35,-68.65,-0.03";
  const COMMON_PARAMS = `countrycodes=pe&viewbox=${encodeURIComponent(
    PERU_VIEWBOX
  )}&bounded=1&accept-language=es&normalizeaddress=1`;
  function buildAutocompleteUrl(q) {
    const prox =
      userLat != null && userLng != null
        ? `&lat=${encodeURIComponent(userLat)}&lon=${encodeURIComponent(
            userLng
          )}`
        : "";
    return `https://us1.locationiq.com/v1/autocomplete?key=${encodeURIComponent(
      locKey
    )}&q=${encodeURIComponent(q)}&limit=6&${COMMON_PARAMS}${prox}`;
  }
  async function fetchAutocomplete(query) {
    if (!locKey) {
      direccionEstado.textContent = "Configura LOCATIONIQ_KEY en config.js";
      direccionEstado.style.color = "#ff6f00";
      return [];
    }
    try {
      const res = await fetch(buildAutocompleteUrl(query));
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (e) {
      console.error(e);
      return [];
    }
  }
  function renderSuggestions(items) {
    sugList.innerHTML = "";
    acIndex = -1;
    if (!items || !items.length) {
      sugList.classList.remove("visible");
      return;
    }
    for (const it of items) {
      const li = document.createElement("li");
      li.textContent = it.display_name || it.address_name || it.name;
      li.dataset.lat = it.lat;
      li.dataset.lng = it.lon;
      li.addEventListener("click", () => selectSuggestion(li));
      sugList.appendChild(li);
    }
    sugList.classList.add("visible");
  }
  function clearSuggestions() {
    sugList.innerHTML = "";
    sugList.classList.remove("visible");
    acIndex = -1;
  }
  function selectSuggestion(li) {
    destinoEl.value = li.textContent;
    togglePlaceholderState(destinoEl);
    destinoCoords = {
      lat: parseFloat(li.dataset.lat),
      lng: parseFloat(li.dataset.lng),
    };
    direccionEstado.textContent = "Direccion establecida por autocompletar.";
    direccionEstado.style.color = "#2e7d32";
    clearSuggestions();
  }
  const onDestinoInput = debounce(async () => {
    const q = destinoEl.value.trim();
    if (!q || q === lastQuery) {
      if (!q) clearSuggestions();
      return;
    }
    lastQuery = q;
    const items = await fetchAutocomplete(q);
    renderSuggestions(items);
  }, 250);
  destinoEl.addEventListener("input", onDestinoInput);
  destinoEl.addEventListener("focus", () => {
    if (sugList.children.length) sugList.classList.add("visible");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".destino-wrapper")) clearSuggestions();
  });
  destinoEl.addEventListener("keydown", (e) => {
    const items = Array.from(sugList.querySelectorAll("li"));
    if (!items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      acIndex = (acIndex + 1) % items.length;
      items.forEach((li, i) => li.classList.toggle("active", i === acIndex));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      acIndex = (acIndex - 1 + items.length) % items.length;
      items.forEach((li, i) => li.classList.toggle("active", i === acIndex));
    } else if (e.key === "Enter") {
      if (acIndex >= 0) {
        e.preventDefault();
        selectSuggestion(items[acIndex]);
      }
    } else if (e.key === "Escape") {
      clearSuggestions();
    }
  });

  // ===== Modal MAPA (Leaflet + reverse) =====
  function openModal() {
    modalMapa.classList.add("open");
    if (navigator.geolocation && (userLat == null || userLng == null)) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          userLat = pos.coords.latitude;
          userLng = pos.coords.longitude;
          try {
            if (hasAlarma && window.Alarma?.setLocation)
              window.Alarma.setLocation(userLat, userLng, {
                accuracy: pos.coords.accuracy,
              });
          } catch (err) {
            console.warn("[alarma] setLocation", err);
          }
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 60000, timeout: 10000 }
      );
    }
    setTimeout(() => {
      initMapIfNeeded();
      try {
        map.invalidateSize();
      } catch {}
      mapSearchInput.focus();
    }, 150);
  }
  function closeModal() {
    modalMapa.classList.remove("open");
  }
  btnAbrirMapa.addEventListener("click", openModal);
  mapCerrar.addEventListener("click", closeModal);
  mapAceptar.addEventListener("click", () => {
    if (!destinoCoords) {
      showMsg("Selecciona un punto en el mapa o busca una direccion.");
      return;
    }
    closeModal();
  });
  function initMapIfNeeded() {
    if (mapReady) {
      setTimeout(() => map.invalidateSize(), 50);
      return;
    }
    map = L.map(mapContainerId);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    const setDefault = () => map.setView([-12.0464, -77.0428], 12);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = [pos.coords.latitude, pos.coords.longitude];
          map.setView(coords, 14);
          userLat = coords[0];
          userLng = coords[1];
          try {
            if (hasAlarma && window.Alarma?.setLocation)
              window.Alarma.setLocation(userLat, userLng, {
                accuracy: pos.coords.accuracy,
              });
          } catch (err) {
            console.warn("[alarma] setLocation", err);
          }
        },
        () => setDefault()
      );
    } else {
      setDefault();
    }
    map.on("click", async (e) => {
      setMarker(e.latlng);
      await reverseGeocode(e.latlng.lat, e.latlng.lng);
    });
    mapReady = true;
    setTimeout(() => map.invalidateSize(), 150);
  }
  function setMarker(latlng) {
    destinoCoords = { lat: latlng.lat, lng: latlng.lng };
    if (!mapMarker) {
      mapMarker = L.marker(latlng, { draggable: true }).addTo(map);
      mapMarker.on("dragend", async () => {
        const p = mapMarker.getLatLng();
        destinoCoords = { lat: p.lat, lng: p.lng };
        await reverseGeocode(p.lat, p.lng);
      });
    } else {
      mapMarker.setLatLng(latlng);
    }
  }
  async function reverseGeocode(lat, lng) {
    if (!locKey) {
      direccionEstado.textContent = "Configura LOCATIONIQ_KEY en config.js";
      direccionEstado.style.color = "#ff6f00";
      return;
    }
    try {
      const url = `https://us1.locationiq.com/v1/reverse?key=${encodeURIComponent(
        locKey
      )}&lat=${lat}&lon=${lng}&format=json&accept-language=es`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const label = data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      destinoEl.value = label;
      togglePlaceholderState(destinoEl);
      direccionEstado.textContent = "Direccion establecida desde el mapa.";
      direccionEstado.style.color = "#2e7d32";
    } catch (e) {
      console.error(e);
      destinoEl.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      togglePlaceholderState(destinoEl);
      direccionEstado.textContent =
        "No se pudo obtener direccion, se usara coordenada.";
      direccionEstado.style.color = "#ff6f00";
    }
  }
  mapSearchBtn.addEventListener("click", async () => {
    const q = mapSearchInput.value.trim();
    if (!q) return;
    const items = await fetchAutocomplete(q);
    if (items && items[0]) {
      const lat = parseFloat(items[0].lat),
        lng = parseFloat(items[0].lon);
      map.setView([lat, lng], 16);
      setMarker({ lat, lng });
      destinoEl.value = items[0].display_name || q;
      togglePlaceholderState(destinoEl);
      destinoCoords = { lat, lng };
      direccionEstado.textContent =
        "Direccion establecida desde bUsqueda en mapa.";
      direccionEstado.style.color = "#2e7d32";
    } else {
      showMsg("Sin resultados en PerU para esa bUsqueda.");
    }
  });

  // ===== EnvIo: crear/unirse por placa + empresa =====
  function isPlacaOk(p) {
    return /^[A-Z0-9-]{5,10}$/.test(p);
  }
  function bloquesCompletos() {
    return custodiosUI.filter(
      (b) => (b.nameInput.value || "").trim() && b.selfieDataUrl
    );
  }
  function mapKindToTipo(k) {
    return tipoForKind(k);
  }
  async function findActiveService(empresa, placaUpper) {
    // intenta por placa_upper, si falla, usa placa
    let q = window.sb
      .from("servicio")
      .select(
        "id, empresa, placa, tipo, estado, destino_texto, cliente:cliente_id(nombre)"
      )
      .eq("empresa", empresa)
      .eq("placa_upper", placaUpper)
      .eq("estado", "ACTIVO")
      .order("created_at", { ascending: false })
      .limit(1);
    let { data, error } = await q;
    if (error) {
      // fallback
      const r = await window.sb
        .from("servicio")
        .select(
          "id, empresa, placa, tipo, estado, destino_texto, cliente:cliente_id(nombre)"
        )
        .eq("empresa", empresa)
        .eq("placa", placaUpper)
        .eq("estado", "ACTIVO")
        .order("created_at", { ascending: false })
        .limit(1);
      data = r.data;
      error = r.error;
    }
    if (error) throw error;
    return (data && data[0]) || null;
  }
  async function getCustodios(servicioId) {
    const { data, error } = await window.sb
      .from("servicio_custodio")
      .select("id, nombre_custodio, tipo_custodia, selfie(id)")
      .eq("servicio_id", servicioId);
    // === BEGIN HU:HU-CUSTODIA-UPDATE-FIX (NO TOCAR FUERA) ===
    if (error) {
      console.warn("[error]", {
        scope: "dashboard-custodia/read",
        servicio_id: servicioId,
        status: error?.code || error?.message || "unknown",
      });
      throw error;
    }
    console.log("[custodia-read]", {
      scope: "dashboard-custodia",
      servicio_id: servicioId,
      custodios: Array.isArray(data) ? data.length : 0,
    });
    // === END HU:HU-CUSTODIA-UPDATE-FIX ===
    return data || [];
  }
  function isCompleto(c) {
    const nombreOk = Boolean((c?.nombre_custodio || "").trim());
    const tieneSelfie = Array.isArray(c?.selfie) ? c.selfie.length > 0 : false;
    return nombreOk && tieneSelfie;
  }
  function kindFromTipoCustodia(t) {
    return t === "Tipo A" ? "vehiculo" : "cabina";
  }

  async function detectServicioActivo(placaUpper, showModal) {
    activeSvc = await findActiveService(empresa, placaUpper);
    if (!activeSvc) {
      modalAct?.classList.remove("show");
      return null;
    }
    activeCustodios = await getCustodios(activeSvc.id);
    if (!showModal) return activeSvc;
    // Poblar modal
    mactCliente.textContent = activeSvc.cliente?.nombre || "-";
    mactDestino.textContent = activeSvc.destino_texto || "-";
    mactList.innerHTML = "";
    (activeCustodios || []).forEach((c) => {
      const row = document.createElement("div");
      row.className = "mini-item";
      const nm = document.createElement("span");
      nm.textContent = c.nombre_custodio || "(Sin nombre)";
      const right = document.createElement("span");
      const chipKind = document.createElement("span");
      chipKind.className = "chip kind";
      chipKind.textContent =
        c.tipo_custodia === "Tipo A" ? "VehIculo" : "Cabina";
      const chipState = document.createElement("span");
      chipState.className = "chip " + (isCompleto(c) ? "ok" : "pend");
      chipState.textContent = isCompleto(c) ? "Completo" : "Pendiente";
      right.appendChild(chipKind);
      right.appendChild(document.createTextNode(" "));
      right.appendChild(chipState);
      row.appendChild(nm);
      row.appendChild(right);
      mactList.appendChild(row);
    });
    modalAct.classList.add("show");
    return activeSvc;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const cliente = (clienteEl.value || "").toUpperCase().trim();
      const placa = (placaEl.value || "").toUpperCase().replace(/\s+/g, "");
      const destinoTexto = (destinoEl.value || "").trim();
      const bloques = bloquesCompletos();
      const primaryBloque = bloques[0] || null;
      const primaryKind = primaryBloque?.kind || null;
      const primaryNombre = (primaryBloque?.nameInput.value || "").trim();
      if (!cliente) return showMsg("Ingresa el cliente");
      if (!placa || !isPlacaOk(placa))
        return showMsg("Ingresa la placa (A-Z, 0-9, -)");
      if (!destinoTexto) return showMsg("Ingresa la direccion destino");
      if (!bloques.length)
        return showMsg("Completa al menos un custodio (nombre + selfie)");

      const tGlobal = tipoEl.value;
      const expectedKinds = kindsForTipo(tGlobal);
      const existing = await findActiveService(empresa, placa);
      if (existing && !forceNew) {
        // mostrar modal y detener envIo hasta que elija
        await detectServicioActivo(placa, true);
        return;
      }
      if (existing) {
        const custs = await getCustodios(existing.id);
        const completeKinds = new Set(
          custs
            .filter(isCompleto)
            .map((c) => kindFromTipoCustodia(c.tipo_custodia))
        );
        const incompleteMap = new Map();
        for (const c of custs) {
          const k = kindFromTipoCustodia(c.tipo_custodia);
          if (!isCompleto(c)) incompleteMap.set(k, c);
        }

        const actions = [];
        for (const b of bloques) {
          const k = b.kind;
          if (!expectedKinds.includes(k)) continue;
          const inc = incompleteMap.get(k);
          if (inc) {
            actions.push({
              mode: "update",
              id: inc.id,
              nombre: b.nameInput.value.trim(),
              selfie: b.selfieDataUrl,
              kind: k,
              tipo_custodia: inc.tipo_custodia || mapKindToTipo(k),
              img: b.img || null,
            });
          } else if (!completeKinds.has(k)) {
            const tipo_custodia = mapKindToTipo(k);
            actions.push({
              mode: "create",
              k,
              nombre: b.nameInput.value.trim(),
              selfie: b.selfieDataUrl,
              kind: k,
              tipo_custodia,
              img: b.img || null,
            });
          }
        }
        if (!actions.length) {
          const ok = confirm(
            `La placa ya esta registrada para este servicio: ${
              existing.cliente?.nombre || ""
            } - ${existing.destino_texto || ""}. Ir al mapa ahora?`
          );
          if (ok) {
            sessionStorage.setItem("servicio_id_actual", existing.id);
            location.href = "/html/dashboard/mapa-resguardo.html";
          }
          return;
        }
        let followSessionPayload = null;
        for (const a of actions) {
          if (a.mode === "update") {
            const tipoCustodia = a.tipo_custodia || mapKindToTipo(a.kind);
            const updResult = await updateCustodia({
              scId: a.id,
              nombre: a.nombre,
              tipo: tipoCustodia,
            });
            if (!updResult.ok) throw updResult.error;
            if (a.selfie) {
              const selfieBlob = await dataUrlToBlob(a.selfie);
              const selfieRes = await saveSelfie(a.id, selfieBlob);
              if (!selfieRes.ok) throw selfieRes.error;
              if (a.img) applySelfiePreview(a.img, selfieBlob);
            }
            if (
              !followSessionPayload &&
              (!primaryKind ||
                a.kind === primaryKind ||
                (primaryNombre && a.nombre === primaryNombre))
            ) {
              followSessionPayload = {
                servicio_id: existing.id,
                servicio_custodio_id: a.id,
                nombre_custodio: a.nombre,
                tipo_custodia: a.tipo_custodia || mapKindToTipo(a.kind),
              };
            }
          } else {
            const tipo_custodia = a.tipo_custodia || mapKindToTipo(a.kind);
            const { data: cId, error: e3 } = await window.sb.rpc(
              "agregar_custodio",
              {
                p_servicio_id: existing.id,
                p_nombre: a.nombre,
                p_tipo_custodia: tipo_custodia,
              }
            );
            if (e3) throw e3;
            if (a.selfie) {
              const selfieBlob = await dataUrlToBlob(a.selfie);
              const selfieRes = await saveSelfie(cId, selfieBlob);
              if (!selfieRes.ok) throw selfieRes.error;
              if (a.img) applySelfiePreview(a.img, selfieBlob);
            }
            if (
              !followSessionPayload &&
              (!primaryKind ||
                a.kind === primaryKind ||
                (primaryNombre && a.nombre === primaryNombre))
            ) {
              followSessionPayload = {
                servicio_id: existing.id,
                servicio_custodio_id: cId,
                nombre_custodio: a.nombre,
                tipo_custodia,
              };
            }
          }
        }
        showMsg("Registro de custodio completado ?");
        if (followSessionPayload) {
          primeCustodiaSession(followSessionPayload, "registro-merge");
        }
        redirectMapa(existing.id, "registro-merge");
        return;
      }

      // Crear servicio nuevo
      const { data: servicio_id, error: errSvc } = await window.sb.rpc(
        "crear_servicio",
        {
          p_empresa: empresa,
          p_cliente_nombre: cliente,
          p_tipo: tGlobal,
          p_placa: placa,
          p_destino_texto: destinoTexto,
          p_destino_lat: destinoCoords?.lat ?? null,
          p_destino_lng: destinoCoords?.lng ?? null,
        }
      );
      if (errSvc) {
        console.error(errSvc);
        return showMsg("Error al crear servicio");
      }
      if (!servicio_id) return showMsg("No se recibio ID de servicio");
      let followSessionPayload = null;
      for (const b of bloques) {
        const tipo_custodia = tipoForKind(b.kind);
        const { data: cId, error: errC } = await window.sb.rpc(
          "agregar_custodio",
          {
            p_servicio_id: servicio_id,
            p_nombre: b.nameInput.value.trim(),
            p_tipo_custodia: tipo_custodia,
          }
        );
        if (errC) {
          console.error(errC);
          return showMsg("Error al agregar custodio");
        }
        if (b.selfieDataUrl) {
          try {
            const selfieBlob = await dataUrlToBlob(b.selfieDataUrl);
            const selfieRes = await saveSelfie(cId, selfieBlob);
            if (!selfieRes.ok) throw selfieRes.error;
            if (b.img) applySelfiePreview(b.img, selfieBlob);
          } catch (errSelfie) {
            console.error(errSelfie);
            return showMsg("Error al guardar selfie");
          }
        }
        if (!followSessionPayload && (!primaryBloque || b === primaryBloque)) {
          followSessionPayload = {
            servicio_id,
            servicio_custodio_id: cId,
            nombre_custodio: b.nameInput.value.trim(),
            tipo_custodia,
          };
        }
      }
      await emitirInicioServicio(servicio_id, {
        cliente,
        placa,
        tipo: tGlobal,
        destino: destinoTexto,
      });
      showMsg("Servicio registrado en Supabase ?");
      if (followSessionPayload) {
        primeCustodiaSession(followSessionPayload, "registro-nuevo");
      }
      redirectMapa(servicio_id, "registro-nuevo");
    } catch (err) {
      console.error(err);
      showMsg("Error en el registro");
    }
  });

  // Limpiar
  document.getElementById("btn-limpiar")?.addEventListener("click", () => {
    try {
      custodiosUI.forEach((ui) => {
        stopStream(ui);
        ui.nameInput.value = "";
        ui.selfieDataUrl = null;
        ui.img.style.display = "none";
        ui.video.style.display = "none";
        ui.btnStart.disabled = false;
        ui.btnShot.disabled = true;
        ui.btnReset.disabled = true;
        ui.status.textContent = "";
      });
    } catch {}
    form.reset();
    currentTipo = tipoEl.value;
    renderCustodios();
    clearSuggestions();
    destinoCoords = null;
    direccionEstado.textContent = "Formulario limpio.";
    direccionEstado.style.color = "";
  });

  // Acciones del modal
  mBtnCancel?.addEventListener("click", () => {
    modalAct.classList.remove("show");
    forceNew = false;
  });
  mBtnVer?.addEventListener("click", () => {
    if (!activeSvc) return;
    sessionStorage.setItem("servicio_id_actual", activeSvc.id);
    location.href = "/html/dashboard/mapa-resguardo.html";
  });
  mBtnNuevo?.addEventListener("click", () => {
    forceNew = true;
    modalAct.classList.remove("show");
    showMsg("Registrar nuevo servicio");
  });
  mBtnJoin?.addEventListener("click", async () => {
    try {
      if (!activeSvc) return;
      modalAct.classList.remove("show");
      const custs = activeCustodios || (await getCustodios(activeSvc.id));
      const tGlobal = tipoEl.value;
      const expectedKinds = kindsForTipo(tGlobal);
      const completeKinds = new Set(
        custs
          .filter(isCompleto)
          .map((c) => kindFromTipoCustodia(c.tipo_custodia))
      );
      const incompleteMap = new Map();
      for (const c of custs) {
        const k = kindFromTipoCustodia(c.tipo_custodia);
        if (!isCompleto(c)) incompleteMap.set(k, c);
      }
      const bloques = bloquesCompletos();
      const primaryBloque = bloques[0] || null;
      const primaryKind = primaryBloque?.kind || null;
      const primaryNombre = (primaryBloque?.nameInput.value || "").trim();
      const actions = [];
      for (const b of bloques) {
        const k = b.kind;
        if (!expectedKinds.includes(k)) continue;
        const inc = incompleteMap.get(k);
        if (inc)
          actions.push({
            mode: "update",
            id: inc.id,
            nombre: b.nameInput.value.trim(),
            selfie: b.selfieDataUrl,
            kind: k,
            tipo_custodia: inc.tipo_custodia || tipoForKind(k),
            img: b.img || null,
          });
        else if (!completeKinds.has(k))
          actions.push({
            mode: "create",
            k,
            nombre: b.nameInput.value.trim(),
            selfie: b.selfieDataUrl,
            kind: k,
            tipo_custodia: tipoForKind(k),
            img: b.img || null,
          });
      }
      let followSessionPayload = null;
      for (const a of actions) {
        if (a.mode === "update") {
          const tipo_custodia = a.tipo_custodia || tipoForKind(a.kind);
          const updResult = await updateCustodia({
            scId: a.id,
            nombre: a.nombre,
            tipo: tipo_custodia,
          });
          if (!updResult.ok) throw updResult.error;
          if (a.selfie) {
            const selfieBlob = await dataUrlToBlob(a.selfie);
            const selfieRes = await saveSelfie(a.id, selfieBlob);
            if (!selfieRes.ok) throw selfieRes.error;
            if (a.img) applySelfiePreview(a.img, selfieBlob);
          }
          if (
            !followSessionPayload &&
            (!primaryKind ||
              a.kind === primaryKind ||
              (primaryNombre && a.nombre === primaryNombre))
          ) {
            followSessionPayload = {
              servicio_id: activeSvc.id,
              servicio_custodio_id: a.id,
              nombre_custodio: a.nombre,
              tipo_custodia: a.tipo_custodia,
            };
          }
        } else {
          const tipo_custodia = a.tipo_custodia || tipoForKind(a.kind);
          const { data: cId, error: e3 } = await window.sb.rpc(
            "agregar_custodio",
            {
              p_servicio_id: activeSvc.id,
              p_nombre: a.nombre,
              p_tipo_custodia: tipo_custodia,
            }
          );
          if (e3) throw e3;
          if (a.selfie) {
            const selfieBlob = await dataUrlToBlob(a.selfie);
            const selfieRes = await saveSelfie(cId, selfieBlob);
            if (!selfieRes.ok) throw selfieRes.error;
            if (a.img) applySelfiePreview(a.img, selfieBlob);
          }
          if (
            !followSessionPayload &&
            (!primaryKind ||
              a.kind === primaryKind ||
              (primaryNombre && a.nombre === primaryNombre))
          ) {
            followSessionPayload = {
              servicio_id: activeSvc.id,
              servicio_custodio_id: cId,
              nombre_custodio: a.nombre,
              tipo_custodia,
            };
          }
        }
      }
      showMsg("Registro completado ?");
      if (followSessionPayload) {
        primeCustodiaSession(followSessionPayload, "registro-modal");
      }
      redirectMapa(activeSvc.id, "registro-modal");
    } catch (e) {
      console.error(e);
      showMsg("Error al completar");
    }
  });
});
