// === BEGIN HU:HU-DASHBOARD-CUSTODIA-FORM crear-servicio (NO TOCAR FUERA) ===
(function () {
  "use strict";

  const STORAGE_PROFILE_KEY = "custodia_profile";
  const SESSION_FALLBACK_KEY = "custodia_session";
  const LOG_SERVICIO = "[servicio]";
  const LOG_CAMERA = "[camera]";
  const LOG_API = "[api]";
  const PLACA_REGEX = /^[A-Z0-9]{6}$/;
  const MAP_DEFAULT = { lat: -12.0464, lng: -77.0428, zoom: 12 };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    const refs = cacheDom();
    if (!refs.form || !window.sb) {
      console.warn(`${LOG_SERVICIO} UI incompleta o Supabase ausente`);
      return;
    }
    const state = createInitialState(refs);
    const profile = loadProfile();
    if (!profile) {
      redirectToLogin();
      return;
    }
    state.profile = profile;
    renderProfile(state);
    attachPlaceholderWatcher(refs.form);
    bindEvents(refs, state);
    loadExistingSelfie(state);
    console.log(`${LOG_SERVICIO} dashboard listo`, {
      custodia_id: profile.id,
      empresa: profile.empresa || profile.empresa_otro || "-",
    });
  }

  function cacheDom() {
    return {
      form: document.getElementById("form-custodia"),
      tipo: document.getElementById("tipo"),
      cliente: document.getElementById("cliente"),
      placa: document.getElementById("placa"),
      destino: document.getElementById("destino"),
      destinoStatus: document.getElementById("direccion-estado"),
      suggestions: document.getElementById("destino-suggestions"),
      btnMapa: document.getElementById("btn-abrir-mapa"),
      modalMapa: document.getElementById("modal-mapa"),
      mapSearchInput: document.getElementById("map-search-input"),
      mapSearchBtn: document.getElementById("map-search-btn"),
      mapAceptar: document.getElementById("map-aceptar"),
      mapCerrar: document.getElementById("map-cerrar"),
      summaryNombre: document.getElementById("summary-nombre"),
      summaryEmpresa: document.getElementById("summary-empresa"),
      selfieBtn: document.getElementById("btn-selfie"),
      selfieThumb: document.getElementById("selfie-thumb"),
      selfieHint: document.getElementById("selfie-hint"),
      btnGuardar: document.getElementById("btn-guardar"),
      btnLimpiar: document.getElementById("btn-limpiar"),
      snackbar: document.getElementById("app-snackbar"),
    };
  }

  function createInitialState(refs) {
    return {
      profile: null,
      destinoCoords: null,
      map: null,
      mapMarker: null,
      mapReady: false,
      acIndex: -1,
      lastQuery: "",
      locationIqKey: window.APP_CONFIG?.LOCATIONIQ_KEY || "",
      selfieBlob: null,
      selfieRemote: false,
      selfieDataUrl: null,
      snackbar: refs.snackbar,
    };
  }

  function loadProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_PROFILE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.id || parsed.exp_ts < Date.now()) {
        localStorage.removeItem(STORAGE_PROFILE_KEY);
        return null;
      }
      return parsed;
    } catch (err) {
      console.warn(`${LOG_SERVICIO} perfil invalido`, err);
      return null;
    }
  }

  function renderProfile(state) {
    const { profile } = state;
    const nombre = profile.nombre || "-";
    const empresa =
      profile.empresa || profile.empresa_otro || "Empresa sin configurar";
    const nombreEl = document.getElementById("summary-nombre");
    const empresaEl = document.getElementById("summary-empresa");
    if (nombreEl) nombreEl.textContent = nombre;
    if (empresaEl) empresaEl.textContent = `Empresa: ${empresa}`;
  }

  async function primeGeoPermission(tag) {
    if (!window.PermHelper?.ensureGeoPermission) return;
    try {
      const status = await window.PermHelper.ensureGeoPermission({
        enableHighAccuracy: true,
        timeout: 8000,
      });
      if (status) {
        console.log("[perm] geo:" + status, { tag });
      }
    } catch (err) {
      console.warn("[perm] geo helper", err);
    }
  }

  function bindEvents(refs, state) {
    refs.form.addEventListener("submit", (evt) =>
      handleSubmit(evt, refs, state)
    );
    refs.btnLimpiar?.addEventListener("click", () =>
      resetForm(refs, state, false)
    );
    refs.destino.addEventListener(
      "input",
      debounce(() => handleDestinoInput(state, refs), 260)
    );
    refs.destino.addEventListener("focus", () => {
      if (refs.suggestions.children.length) {
        refs.suggestions.classList.add("visible");
      }
    });
    refs.destino.addEventListener("keydown", (evt) =>
      handleDestinoKeydown(evt, state, refs)
    );
    document.addEventListener("click", (evt) => {
      if (!evt.target.closest(".destino-wrapper")) {
        clearSuggestions(refs);
      }
    });
    refs.btnMapa?.addEventListener("click", () => openMapModal(refs, state));
    refs.mapCerrar?.addEventListener("click", () => closeMapModal(refs, state));
    refs.mapAceptar?.addEventListener("click", () => {
      if (!state.destinoCoords) {
        showMsg(state, "Selecciona un punto en el mapa primero.");
        return;
      }
      closeMapModal(refs, state);
    });
    refs.mapSearchBtn?.addEventListener("click", () =>
      handleMapSearch(refs, state)
    );
    refs.mapSearchInput?.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        handleMapSearch(refs, state);
      }
    });
    setupSelfieIcon(refs, state);
    refs.placa.addEventListener("input", () => {
      refs.placa.value = refs.placa.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });
  }

  async function loadExistingSelfie(state) {
    try {
      const { data, error } = await window.sb
        .from("selfie")
        .select("id,mime_type,bytes")
        .eq("custodia_id", state.profile.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (data?.bytes) {
        const blob = hexToBlob(data.bytes, data.mime_type || "image/jpeg");
        const dataUrl = await blobToDataUrl(blob);
        setSelfiePreview(state, dataUrl);
        state.selfieRemote = true;
        console.log(`${LOG_CAMERA} selfie remota detectada`, { selfie_id: data.id });
      } else {
        updateSelfieHint(state, false);
      }
    } catch (err) {
      console.warn(`${LOG_CAMERA} no se pudo leer selfie`, err);
      updateSelfieHint(state, false);
    }
  }

  function handleDestinoKeydown(evt, state, refs) {
    const items = Array.from(refs.suggestions.querySelectorAll("li"));
    if (!items.length) return;
    if (evt.key === "ArrowDown") {
      evt.preventDefault();
      state.acIndex = (state.acIndex + 1) % items.length;
      items.forEach((li, i) => li.classList.toggle("active", i === state.acIndex));
    } else if (evt.key === "ArrowUp") {
      evt.preventDefault();
      state.acIndex = (state.acIndex - 1 + items.length) % items.length;
      items.forEach((li, i) => li.classList.toggle("active", i === state.acIndex));
    } else if (evt.key === "Enter" && state.acIndex >= 0) {
      evt.preventDefault();
      selectSuggestion(items[state.acIndex], refs, state);
    } else if (evt.key === "Escape") {
      clearSuggestions(refs);
    }
  }

  async function handleDestinoInput(state, refs) {
    const query = refs.destino.value.trim();
    if (!query || query === state.lastQuery) {
      if (!query) clearSuggestions(refs);
      return;
    }
    state.lastQuery = query;
    try {
      const items = await fetchAutocomplete(query, state.locationIqKey);
      renderSuggestions(items, refs, state);
    } catch (err) {
      console.warn(`${LOG_API} autocomplete fallo`, err);
    }
  }

  function renderSuggestions(items, refs, state) {
    refs.suggestions.innerHTML = "";
    state.acIndex = -1;
    if (!items?.length) {
      refs.suggestions.classList.remove("visible");
      return;
    }
    items.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item.display_name;
      li.dataset.lat = item.lat;
      li.dataset.lng = item.lon;
      li.addEventListener("click", () => selectSuggestion(li, refs, state));
      refs.suggestions.appendChild(li);
    });
    refs.suggestions.classList.add("visible");
  }

  function selectSuggestion(li, refs, state) {
    refs.destino.value = li.textContent;
    refs.destino.classList.add("has-value");
    state.destinoCoords = {
      lat: parseFloat(li.dataset.lat),
      lng: parseFloat(li.dataset.lng),
    };
    if (refs.destinoStatus) {
      refs.destinoStatus.textContent = "Dirección establecida desde autocompletar.";
      refs.destinoStatus.style.color = "#2e7d32";
    }
    clearSuggestions(refs);
  }

  function clearSuggestions(refs) {
    refs.suggestions.innerHTML = "";
    refs.suggestions.classList.remove("visible");
  }

  function openMapModal(refs, state) {
    refs.modalMapa?.classList.add("open");
    setTimeout(() => {
      initMapIfNeeded(refs, state);
      refs.mapSearchInput?.focus();
    }, 150);
  }

  function closeMapModal(refs) {
    refs.modalMapa?.classList.remove("open");
  }

  function initMapIfNeeded(refs, state) {
    if (state.mapReady) {
      setTimeout(() => state.map.invalidateSize(), 50);
      return;
    }
    if (!window.L) {
      console.warn(`${LOG_SERVICIO} Leaflet no cargado`);
      return;
    }
    state.map = L.map("map-container");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(state.map);
    const setDefault = () => state.map.setView([MAP_DEFAULT.lat, MAP_DEFAULT.lng], MAP_DEFAULT.zoom);
    primeGeoPermission("dashboard-map");
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          state.map.setView([pos.coords.latitude, pos.coords.longitude], 14);
        },
        () => setDefault(),
        { maximumAge: 60000, timeout: 8000 }
      );
    } else {
      setDefault();
    }
    state.map.on("click", async (evt) => {
      setMarker(state, evt.latlng);
      await reverseGeocode(evt.latlng.lat, evt.latlng.lng, refs, state);
    });
    state.mapReady = true;
    setTimeout(() => state.map.invalidateSize(), 150);
  }

  function setMarker(state, latlng) {
    if (!state.map) return;
    if (state.mapMarker) {
      state.mapMarker.setLatLng(latlng);
    } else {
      state.mapMarker = L.marker(latlng).addTo(state.map);
    }
    state.destinoCoords = { lat: latlng.lat, lng: latlng.lng };
  }

  async function reverseGeocode(lat, lng, refs, state) {
    if (!state.locationIqKey) return;
    try {
      const params = new URLSearchParams({
        key: state.locationIqKey,
        lat,
        lon: lng,
        format: "json",
      });
      const res = await fetch(`https://us1.locationiq.com/v1/reverse?${params.toString()}`);
      if (!res.ok) throw new Error("reverse-fail");
      const data = await res.json();
      if (data?.display_name) {
        refs.destino.value = data.display_name;
        refs.destino.classList.add("has-value");
        if (refs.destinoStatus) {
          refs.destinoStatus.textContent = "Dirección establecida desde el mapa.";
          refs.destinoStatus.style.color = "#2e7d32";
        }
      }
    } catch (err) {
      console.warn(`${LOG_API} reverse`, err);
    }
  }

  async function handleMapSearch(refs, state) {
    const query = refs.mapSearchInput?.value?.trim();
    if (!query) return;
    try {
      const items = await fetchAutocomplete(query, state.locationIqKey);
      if (!items?.length) {
        showMsg(state, "No se encontraron direcciones.");
        return;
      }
      const best = items[0];
      const lat = parseFloat(best.lat);
      const lng = parseFloat(best.lon);
      state.map?.setView([lat, lng], 15);
      setMarker(state, { lat, lng });
      refs.destino.value = best.display_name;
      refs.destino.classList.add("has-value");
      if (refs.destinoStatus) {
        refs.destinoStatus.textContent = "Dirección establecida desde el mapa.";
        refs.destinoStatus.style.color = "#2e7d32";
      }
    } catch (err) {
      console.warn(`${LOG_API} search`, err);
      showMsg(state, "No se pudo buscar en el mapa.");
    }
  }

  function setupSelfieIcon(refs, state) {
    if (!refs.selfieBtn) return;
    if (!window.CustodiaSelfie?.attach) {
      refs.selfieBtn.addEventListener("click", () =>
        showMsg(state, "La cámara no está disponible en este dispositivo.")
      );
      return;
    }
    window.CustodiaSelfie.attach(refs.selfieBtn, {
      previewImg: refs.selfieThumb,
      hintEl: refs.selfieHint,
      hintIdle: "Sin selfie registrada. Captura una antes de crear un servicio.",
      hintReady: "Selfie lista. Puedes volver a capturar si deseas.",
      onCapture: ({ blob, dataUrl }) => {
        state.selfieBlob = blob;
        state.selfieRemote = false;
        state.selfieDataUrl = dataUrl || null;
        if (dataUrl) updateSelfieHint(state, true);
      },
      onError: (err) => {
        if (err?.message !== "camera-cancelled") {
          console.warn(`${LOG_CAMERA} error`, err);
          showMsg(state, "No se pudo capturar la selfie.");
        }
      },
    });
  }

  function setSelfiePreview(state, dataUrl) {
    state.selfieDataUrl = dataUrl;
    const img = document.getElementById("selfie-thumb");
    if (!img) return;
    img.hidden = false;
    img.src = dataUrl;
    updateSelfieHint(state, true);
  }

  function updateSelfieHint(state, hasSelfie) {
    const hint = document.getElementById("selfie-hint");
    if (!hint) return;
    hint.textContent = hasSelfie
      ? "Selfie lista. Puedes volver a capturar si deseas."
      : "Sin selfie registrada. Captura una antes de crear un servicio.";
  }

  async function handleSubmit(evt, refs, state) {
    evt.preventDefault();
    if (!state.profile) {
      showMsg(state, "Sesión no válida. Inicia nuevamente.");
      return;
    }
    const empresa = state.profile.empresa;
    if (!empresa) {
      showMsg(state, "Tu empresa no está configurada. Contacta al administrador.");
      return;
    }
    const clienteNombre = refs.cliente.value.trim();
    const placaRaw = refs.placa.value.trim().toUpperCase();
    const destinoTexto = refs.destino.value.trim();
    const tipo = refs.tipo.value || "Simple";
    if (!clienteNombre) return showMsg(state, "Ingresa el cliente.");
    if (!PLACA_REGEX.test(placaRaw))
      return showMsg(state, "La placa debe tener exactamente 6 caracteres alfanuméricos.");
    if (!destinoTexto) return showMsg(state, "Ingresa la dirección destino.");
    if (!state.selfieRemote && !state.selfieBlob) {
      return showMsg(state, "Captura o confirma tu selfie antes de continuar.");
    }
    setButtonLoading(refs.btnGuardar, true);
    try {
      const clienteId = await ensureCliente(clienteNombre);
      await ensurePlacaDisponible(empresa, placaRaw);
      const servicio = await createServicio({
        empresa,
        cliente_id: clienteId,
        tipo,
        placa: placaRaw,
        destino_texto: destinoTexto,
        destino_lat: state.destinoCoords?.lat || null,
        destino_lng: state.destinoCoords?.lng || null,
      });
      const sc = await createServicioCustodio({
        servicio_id: servicio.id,
        custodia_id: state.profile.id,
        nombre_custodio: state.profile.nombre,
        tipo_custodia: tipo,
      });
      if (!state.selfieRemote && state.selfieBlob) {
        await uploadSelfie(state.profile.id, sc.id, state.selfieBlob);
        state.selfieRemote = true;
        console.log(`${LOG_CAMERA} selfie subida para servicio`, { servicio_custodio_id: sc.id });
      }
      persistSession({
        servicio_id: servicio.id,
        servicio_custodio_id: sc.id,
        custodia_id: state.profile.id,
        nombre_custodio: state.profile.nombre,
        tipo_custodia: tipo,
      });
      showMsg(state, "Servicio registrado correctamente.");
      console.log(`${LOG_SERVICIO} creado`, {
        servicio_id: servicio.id,
        placa: placaRaw,
        cliente: clienteNombre,
      });
      redirectToMapa(servicio.id);
    } catch (err) {
      console.error(`${LOG_SERVICIO} error`, err);
      showMsg(state, err?.friendly || "No se pudo registrar el servicio.");
    } finally {
      setButtonLoading(refs.btnGuardar, false);
    }
  }

  async function ensureCliente(nombre) {
    const normalizado = normalizeCliente(nombre);
    const { data, error } = await window.sb
      .from("cliente")
      .select("id")
      .eq("nombre_upper", normalizado)
      .maybeSingle();
    if (error && error.code !== "PGRST116") throw error;
    if (data?.id) return data.id;
    const insercion = await window.sb
      .from("cliente")
      .insert({ nombre }, { returning: "representation" })
      .select("id")
      .single();
    if (insercion.error) throw insercion.error;
    return insercion.data.id;
  }

  async function ensurePlacaDisponible(empresa, placaUpper) {
    const { data, error } = await window.sb
      .from("servicio")
      .select("id, destino_texto, cliente:cliente_id(nombre)")
      .eq("empresa", empresa)
      .eq("placa_upper", placaUpper)
      .eq("estado", "ACTIVO")
      .maybeSingle();
    if (error && error.code !== "PGRST116") throw error;
    if (data?.id) {
      const clienteNombre = data.cliente?.nombre || "-";
      const msg = `La placa ya está en un servicio activo (${clienteNombre}). Ve a Custodia > Registros para unirte.`;
      const err = new Error("servicio-activo");
      err.friendly = msg;
      throw err;
    }
  }

  async function createServicio(payload) {
    console.log(`${LOG_API} insert servicio`, payload);
    const { data, error } = await window.sb
      .from("servicio")
      .insert(payload, { returning: "representation" })
      .select("id,placa,empresa")
      .single();
    if (error) throw error;
    return data;
  }

  async function createServicioCustodio(payload) {
    console.log(`${LOG_API} insert servicio_custodio`, payload);
    const { data, error } = await window.sb
      .from("servicio_custodio")
      .insert(payload, { returning: "representation" })
      .select("id")
      .single();
    if (error) throw error;
    return data;
  }

  async function uploadSelfie(custodiaId, servicioCustodioId, blob) {
    const mime = blob.type || "image/jpeg";
    const bytes = await blobToHex(blob);
    const { error } = await window.sb.from("selfie").insert(
      {
        custodia_id: custodiaId,
        servicio_custodio_id: servicioCustodioId,
        mime_type: mime,
        bytes,
      },
      { returning: "minimal" }
    );
    if (error) throw error;
  }

  function persistSession(payload) {
    try {
      if (window.CustodiaSession?.save) {
        window.CustodiaSession.save(payload);
        return;
      }
    } catch (err) {
      console.warn("[session] custom save error", err);
    }
    try {
      const ttl = 4 * 60 * 60 * 1000;
      const fallback = { ...payload, exp_ts: Date.now() + ttl };
      localStorage.setItem(SESSION_FALLBACK_KEY, JSON.stringify(fallback));
    } catch (err) {
      console.warn("[session] fallback error", err);
    }
  }

  function redirectToMapa(servicioId) {
    try {
      sessionStorage.setItem("servicio_id_actual", servicioId);
    } catch {}
    window.location.href = "/html/dashboard/mapa-resguardo.html";
  }

  function resetForm(refs, state, keepSelfie = true) {
    refs.form.reset();
    state.destinoCoords = null;
    state.lastQuery = "";
    clearSuggestions(refs);
    if (!keepSelfie) {
      state.selfieBlob = null;
      state.selfieRemote = false;
      state.selfieDataUrl = null;
      const img = document.getElementById("selfie-thumb");
      if (img) {
        img.hidden = true;
        img.removeAttribute("src");
      }
      updateSelfieHint(state, false);
    }
    if (refs.destinoStatus) {
      refs.destinoStatus.textContent =
        "Empieza a escribir para ver sugerencias o usa Buscar en el mapa.";
      refs.destinoStatus.style.color = "#607d8b";
    }
  }

  function showMsg(state, message) {
    try {
      if (state.snackbar?.MaterialSnackbar) {
        state.snackbar.MaterialSnackbar.showSnackbar({ message });
      } else {
        alert(message);
      }
    } catch {
      alert(message);
    }
  }

  function setButtonLoading(btn, loading) {
    if (!btn) return;
    btn.classList.toggle("loading", loading);
    btn.disabled = loading;
  }

  function redirectToLogin() {
    window.location.href = "/html/login/login.html";
  }

  function normalizeCliente(nombre) {
    return nombre
      .toUpperCase()
      .trim()
      .replace(/\s+/g, " ");
  }

  function hexToBlob(hex, mime) {
    try {
      if (hex.startsWith("\\x")) hex = hex.slice(2);
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
      }
      return new Blob([bytes], { type: mime || "image/jpeg" });
    } catch (err) {
      console.warn(`${LOG_CAMERA} hex parse`, err);
      return null;
    }
  }

  function blobToHex(blob) {
    return blob.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer);
      return (
        "\\x" +
        Array.from(bytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
      );
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function fetchAutocomplete(query, key) {
    if (!key) return [];
    const params = new URLSearchParams({
      key,
      q: query,
      format: "json",
      addressdetails: "0",
      countrycodes: "pe",
      limit: "5",
    });
    const res = await fetch(`https://us1.locationiq.com/v1/search?${params.toString()}`);
    if (!res.ok) throw new Error("autocomplete-fail");
    return res.json();
  }

  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function attachPlaceholderWatcher(form) {
    const handler = (evt) => {
      const input = evt.target;
      if (!input.classList?.contains("mdl-textfield__input")) return;
      const hasValue = Boolean(String(input.value || "").trim());
      input.classList.toggle("has-value", hasValue);
      const wrapper = input.closest(".mdl-textfield");
      if (wrapper) wrapper.classList.toggle("is-dirty", hasValue);
    };
    form.addEventListener("input", handler, true);
    form.addEventListener("change", handler, true);
    form
      .querySelectorAll(".mdl-textfield__input")
      .forEach((input) => handler({ target: input }));
    console.log("[task][HU-PLACEHOLDER-CONSISTENCIA] done", {
      scope: "dashboard-custodia",
    });
  }
})();
// === END HU:HU-DASHBOARD-CUSTODIA-FORM ===
