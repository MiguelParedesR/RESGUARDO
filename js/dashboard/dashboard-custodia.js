// === BEGIN HU:HU-DASHBOARD-CUSTODIA-FORM crear-servicio (NO TOCAR FUERA) ===
(function () {
  "use strict";

  const STORAGE_PROFILE_KEY = "custodia_profile";
  const SESSION_FALLBACK_KEY = "custodia_session";
  const LOG_SERVICIO = "[servicio]";
  const LOG_API = "[api]";
  const PLACA_REGEX = /^[A-Z0-9]{6}$/;
  const PLACA_ALERT_WINDOW_MS = 12 * 60 * 60 * 1000;
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
    attachPlaceholderWatcher(refs.form);
    bindEvents(refs, state);
    console.log(`${LOG_SERVICIO} dashboard listo`, {
      custodia_id: profile.id,
      empresa: profile.empresa || profile.empresa_otro || "-",
    });
  }

  function cacheDom() {
    return {
      form: document.getElementById("form-custodia"),
      tipo: document.getElementById("tipo"),
      clienteInput: document.getElementById("cliente-search"),
      clienteBox: document.querySelector(".cliente-search"),
      clienteClear: document.getElementById("cliente-clear"),
      clienteResults: document.getElementById("cliente-results"),
      clienteFeedback: document.getElementById("cliente-feedback"),
      clienteAddBtn: document.getElementById("cliente-add-btn"),
      modalCliente: document.getElementById("modal-cliente"),
      modalClienteInput: document.getElementById("modal-cliente-input"),
      modalClienteSave: document.getElementById("modal-cliente-save"),
      modalClienteFeedback: document.getElementById("modal-cliente-feedback"),
      modalClienteCancel: document.getElementById("modal-cliente-cancel"),
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
      btnGuardar: document.getElementById("btn-guardar"),
      btnLimpiar: document.getElementById("btn-limpiar"),
      btnUbicaciones: document.getElementById("btn-ubicaciones"),
      snackbar: document.getElementById("app-snackbar"),
      modalUbicaciones: document.getElementById("modal-ubicaciones"),
      modalUbicacionesClose: document.getElementById("modal-ubicaciones-close"),
      ubicacionesLista: document.getElementById("ubicaciones-lista"),
      modalPlaca: document.getElementById("modal-placa"),
      modalPlacaClose: document.getElementById("modal-placa-close"),
      modalPlacaCliente: document.getElementById("modal-placa-cliente"),
      modalPlacaDestino: document.getElementById("modal-placa-destino"),
      modalPlacaFecha: document.getElementById("modal-placa-fecha"),
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
      snackbar: refs.snackbar,
      clienteResults: [],
      clienteSearchTimer: null,
      clienteSelectedId: "",
      clienteSelectedNombre: "",
      clienteQuery: "",
      manualClienteInput: "",
      placaCheckTimer: null,
      lastPlacaAlertId: "",
      savedUbicaciones: [],
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
    refs.btnLimpiar?.addEventListener("click", () => resetForm(refs, state));
    refs.tipo?.addEventListener("change", () =>
      updateGuardarEstado(refs, state)
    );
    refs.destino.addEventListener("input", () => {
      updateGuardarEstado(refs, state);
    });
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
    refs.placa.addEventListener("input", () => {
      refs.placa.value = refs.placa.value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      updateGuardarEstado(refs, state);
      schedulePlacaCheck(refs, state);
    });
    refs.btnUbicaciones?.addEventListener("click", () =>
      handleUbicacionesGuardadas(refs, state)
    );
    refs.modalUbicacionesClose?.addEventListener("click", () =>
      closeUbicacionesModal(refs)
    );
    refs.modalUbicaciones?.addEventListener("click", (evt) => {
      if (evt.target === refs.modalUbicaciones) closeUbicacionesModal(refs);
    });
    refs.modalPlacaClose?.addEventListener("click", () =>
      closePlacaModal(refs)
    );
    refs.modalPlaca?.addEventListener("click", (evt) => {
      if (evt.target === refs.modalPlaca) closePlacaModal(refs);
    });
    refs.ubicacionesLista?.addEventListener("click", (evt) => {
      const btn = evt.target.closest("button[data-destino]");
      if (!btn) return;
      applyUbicacionGuardada(btn, refs, state);
    });
    bindClienteSearch(refs, state);
    updateGuardarEstado(refs, state);
  }

  function handleDestinoKeydown(evt, state, refs) {
    const items = Array.from(refs.suggestions.querySelectorAll("li"));
    if (!items.length) return;
    if (evt.key === "ArrowDown") {
      evt.preventDefault();
      state.acIndex = (state.acIndex + 1) % items.length;
      items.forEach((li, i) =>
        li.classList.toggle("active", i === state.acIndex)
      );
    } else if (evt.key === "ArrowUp") {
      evt.preventDefault();
      state.acIndex = (state.acIndex - 1 + items.length) % items.length;
      items.forEach((li, i) =>
        li.classList.toggle("active", i === state.acIndex)
      );
    } else if (evt.key === "Enter" && state.acIndex >= 0) {
      evt.preventDefault();
      selectSuggestion(items[state.acIndex], refs, state);
    } else if (evt.key === "Escape") {
      clearSuggestions(refs);
    }
  }

  async function handleDestinoInput(state, refs) {
    const query = refs.destino.value.trim();
    state.destinoCoords = null;
    updateGuardarEstado(refs, state);
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
      refs.destinoStatus.textContent =
        "Dirección establecida desde autocompletar.";
      refs.destinoStatus.style.color = "#2e7d32";
    }
    clearSuggestions(refs);
    updateGuardarEstado(refs, state);
  }

  function clearSuggestions(refs) {
    refs.suggestions.innerHTML = "";
    refs.suggestions.classList.remove("visible");
  }

  function openMapModal(refs, state) {
    if (!refs.modalMapa) return;
    refs.modalMapa.classList.add("open");
    refs.modalMapa.setAttribute("aria-hidden", "false");
    setTimeout(() => {
      initMapIfNeeded(refs, state);
      state.map?.setView(
        [MAP_DEFAULT.lat, MAP_DEFAULT.lng],
        MAP_DEFAULT.zoom
      );
      refs.mapSearchInput?.focus();
    }, 150);
  }

  function closeMapModal(refs) {
    if (!refs.modalMapa) return;
    refs.modalMapa.classList.remove("open");
    refs.modalMapa.setAttribute("aria-hidden", "true");
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
    const setDefault = () =>
      state.map.setView([MAP_DEFAULT.lat, MAP_DEFAULT.lng], MAP_DEFAULT.zoom);
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
      const res = await fetch(
        `https://us1.locationiq.com/v1/reverse.php?${params.toString()}`
      );
      if (!res.ok) throw new Error("reverse-fail");
      const data = await res.json();
      if (data?.display_name) {
        refs.destino.value = data.display_name;
        refs.destino.classList.add("has-value");
        if (refs.destinoStatus) {
          refs.destinoStatus.textContent =
            "Dirección establecida desde el mapa.";
          refs.destinoStatus.style.color = "#2e7d32";
        }
        updateGuardarEstado(refs, state);
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
      updateGuardarEstado(refs, state);
    } catch (err) {
      console.warn(`${LOG_API} search`, err);
      showMsg(state, "No se pudo buscar en el mapa.");
    }
  }

  async function handleSubmit(evt, refs, state) {
    evt.preventDefault();
    if (!state.profile) {
      showMsg(state, "Sesión no válida. Inicia nuevamente.");
      return;
    }
    const empresa = state.profile.empresa;
    if (!empresa) {
      showMsg(
        state,
        "Tu empresa no está configurada. Contacta al administrador."
      );
      return;
    }
    const clienteNombre = (state.clienteSelectedNombre || "").trim();
    const placaRaw = refs.placa.value.trim().toUpperCase();
    const destinoTexto = refs.destino.value.trim();
    const tipo = refs.tipo.value || "Simple";
    if (!state.clienteSelectedId || !clienteNombre) {
      showMsg(state, "Selecciona un cliente de la lista o agrégalo.");
      return;
    }
    if (!PLACA_REGEX.test(placaRaw))
      return showMsg(
        state,
        "La placa debe tener exactamente 6 caracteres alfanuméricos."
      );
    if (!destinoTexto) return showMsg(state, "Ingresa la dirección destino.");
    setButtonLoading(refs.btnGuardar, true);
    try {
      await ensurePlacaDisponible(empresa, placaRaw);
      const servicio = await createServicio({
        empresa,
        cliente_id: state.clienteSelectedId,
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
      updateGuardarEstado(refs, state);
    }
  }

  async function ensurePlacaDisponible(empresa, placaUpper) {
    const registro = await fetchUltimoServicioPorPlaca(empresa, placaUpper);
    if (registro && estaDentroVentana12h(registro)) {
      const clienteNombre = registro.cliente?.nombre || "-";
      const destino = registro.destino_texto || "Sin destino";
      const err = new Error("servicio-reciente");
      err.friendly = `La placa ya fue registrada recientemente (Cliente: ${clienteNombre}, Destino: ${destino}).`;
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

  function resetForm(refs, state) {
    refs.form.reset();
    state.destinoCoords = null;
    state.lastQuery = "";
    clearSuggestions(refs);
    if (refs.destinoStatus) {
      refs.destinoStatus.textContent =
        "Empieza a escribir para ver sugerencias o usa Buscar en el mapa.";
      refs.destinoStatus.style.color = "#607d8b";
    }
    clearClienteSelection(refs, state, true);
    state.lastPlacaAlertId = "";
    updateGuardarEstado(refs, state);
    closePlacaModal(refs);
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

  function updateGuardarEstado(refs, state) {
    const tipoOk = Boolean(refs.tipo?.value && refs.tipo.value !== "");
    const clienteOk = Boolean(state.clienteSelectedId);
    const placaOk = PLACA_REGEX.test((refs.placa?.value || "").trim());
    const destinoOk = Boolean((refs.destino?.value || "").trim());
    const coordsOk =
      typeof state.destinoCoords?.lat === "number" &&
      typeof state.destinoCoords?.lng === "number";
    const ready = tipoOk && clienteOk && placaOk && destinoOk && coordsOk;
    if (refs.btnGuardar) {
      refs.btnGuardar.disabled = !ready;
    }
    return ready;
  }

  function schedulePlacaCheck(refs, state) {
    clearTimeout(state.placaCheckTimer);
    const placaUpper = (refs.placa.value || "").trim().toUpperCase();
    if (!PLACA_REGEX.test(placaUpper)) {
      state.lastPlacaAlertId = "";
      closePlacaModal(refs);
      return;
    }
    state.placaCheckTimer = setTimeout(() => {
      checkPlacaReciente(refs, state, placaUpper);
    }, 350);
  }

  async function checkPlacaReciente(refs, state, placaUpper) {
    if (!state.profile?.empresa) return;
    try {
      const registro = await fetchUltimoServicioPorPlaca(
        state.profile.empresa,
        placaUpper
      );
      if (registro && estaDentroVentana12h(registro)) {
        if (state.lastPlacaAlertId === registro.id) return;
        state.lastPlacaAlertId = registro.id;
        openPlacaModal(refs, registro);
      } else {
        state.lastPlacaAlertId = "";
        closePlacaModal(refs);
      }
    } catch (err) {
      console.warn("[placa-check] error", err);
    }
  }

  function openPlacaModal(refs, registro) {
    if (!refs.modalPlaca) return;
    if (refs.modalPlacaCliente)
      refs.modalPlacaCliente.textContent = registro.cliente?.nombre || "-";
    if (refs.modalPlacaDestino)
      refs.modalPlacaDestino.textContent = registro.destino_texto || "Sin destino";
    if (refs.modalPlacaFecha)
      refs.modalPlacaFecha.textContent = formatFechaCorta(registro.created_at);
    refs.modalPlaca.classList.add("open");
    refs.modalPlaca.setAttribute("aria-hidden", "false");
  }

  function closePlacaModal(refs) {
    if (!refs.modalPlaca) return;
    refs.modalPlaca.classList.remove("open");
    refs.modalPlaca.setAttribute("aria-hidden", "true");
  }

  async function handleUbicacionesGuardadas(refs, state) {
    if (!state.clienteSelectedId) {
      updateClienteFeedback(refs, "Selecciona un cliente para revisar ubicaciones.");
      return;
    }
    if (!state.profile?.empresa) return;
    openUbicacionesModal(refs);
    renderUbicacionesGuardadas(refs, {
      loading: true,
    });
    try {
      const ubicaciones = await fetchUbicacionesGuardadas(
        state.profile.empresa,
        state.clienteSelectedId
      );
      renderUbicacionesGuardadas(refs, { data: ubicaciones });
    } catch (err) {
      console.warn("[ubicaciones] error", err);
      renderUbicacionesGuardadas(refs, {
        error: "No se pudieron cargar las ubicaciones guardadas.",
      });
    }
  }

  function openUbicacionesModal(refs) {
    if (!refs.modalUbicaciones) return;
    refs.modalUbicaciones.classList.add("open");
    refs.modalUbicaciones.setAttribute("aria-hidden", "false");
  }

  function closeUbicacionesModal(refs) {
    if (!refs.modalUbicaciones) return;
    refs.modalUbicaciones.classList.remove("open");
    refs.modalUbicaciones.setAttribute("aria-hidden", "true");
  }

  function renderUbicacionesGuardadas(refs, { data, loading, error } = {}) {
    if (!refs.ubicacionesLista) return;
    refs.ubicacionesLista.innerHTML = "";
    const li = document.createElement("li");
    if (loading) {
      li.textContent = "Cargando ubicaciones...";
      refs.ubicacionesLista.appendChild(li);
      return;
    }
    if (error) {
      li.textContent = error;
      refs.ubicacionesLista.appendChild(li);
      return;
    }
    if (!data?.length) {
      li.textContent = "Aún no hay ubicaciones guardadas para este cliente.";
      refs.ubicacionesLista.appendChild(li);
      return;
    }
    data.forEach((row) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.destino = row.destino_texto || "";
      button.dataset.lat = row.destino_lat ?? "";
      button.dataset.lng = row.destino_lng ?? "";
      const cliente = document.createElement("p");
      cliente.className = "saved-client";
      cliente.textContent = row.cliente?.nombre || "-";
      const destino = document.createElement("p");
      destino.className = "saved-destino";
      destino.textContent = row.destino_texto || "Sin destino";
      const fecha = document.createElement("p");
      fecha.className = "saved-fecha";
      fecha.textContent = formatFechaCorta(row.created_at);
      button.append(cliente, destino, fecha);
      item.appendChild(button);
      refs.ubicacionesLista.appendChild(item);
    });
  }

  function applyUbicacionGuardada(btn, refs, state) {
    const destino = btn.dataset.destino || "";
    if (!destino) return;
    refs.destino.value = destino;
    refs.destino.classList.add("has-value");
    const lat = parseFloat(btn.dataset.lat);
    const lng = parseFloat(btn.dataset.lng);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      state.destinoCoords = { lat, lng };
      if (refs.destinoStatus) {
        refs.destinoStatus.textContent = "Dirección seleccionada de favoritos.";
        refs.destinoStatus.style.color = "#2e7d32";
      }
    } else {
      state.destinoCoords = null;
      if (refs.destinoStatus) {
        refs.destinoStatus.textContent =
          "Esta ubicación no tiene coordenadas. Usa el mapa.";
        refs.destinoStatus.style.color = "#c62828";
      }
      showMsg(state, "Esta ubicación no cuenta con coordenadas almacenadas.");
    }
    closeUbicacionesModal(refs);
    updateGuardarEstado(refs, state);
  }

  async function fetchUbicacionesGuardadas(empresa, clienteId) {
    const { data, error } = await window.sb
      .from("servicio")
      .select(
        "id,destino_texto,destino_lat,destino_lng,cliente:cliente_id(nombre),created_at"
      )
      .eq("empresa", empresa)
      .eq("cliente_id", clienteId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw error;
    return data || [];
  }

  async function fetchUltimoServicioPorPlaca(empresa, placaUpper) {
    if (!empresa || !placaUpper) return null;
    const { data, error } = await window.sb
      .from("servicio")
      .select("id,destino_texto,cliente:cliente_id(nombre),created_at,estado")
      .eq("empresa", empresa)
      .eq("placa_upper", placaUpper)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    return data?.[0] || null;
  }

  function estaDentroVentana12h(registro) {
    if (!registro?.created_at) return false;
    const delta = Date.now() - new Date(registro.created_at).getTime();
    return delta < PLACA_ALERT_WINDOW_MS;
  }

  function formatFechaCorta(dateStr) {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    return date.toLocaleString("es-PE", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function redirectToLogin() {
    window.location.href = "/html/login/login.html";
  }

  function normalizeCliente(nombre) {
    return nombre.toUpperCase().trim().replace(/\s+/g, " ");
  }

  // === BEGIN HU:HU-DASHBOARD-CUSTODIA-CLIENTE-SEARCH ===
  function bindClienteSearch(refs, state) {
    if (!refs.clienteInput) return;
    refs.clienteInput.addEventListener("input", () =>
      handleClienteSearchInput(refs, state)
    );
    refs.clienteInput.addEventListener("focus", () => {
      if (state.clienteResults.length) {
        refs.clienteResults.hidden = false;
        refs.clienteBox?.setAttribute("aria-expanded", "true");
      }
    });
    refs.clienteInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        const first = state.clienteResults?.[0];
        if (first) selectClienteResult(first, refs, state);
      } else if (evt.key === "Escape") {
        hideClienteResults(refs);
      }
    });
    document.addEventListener("click", (evt) => {
      if (!evt.target.closest(".cliente-field")) hideClienteResults(refs);
    });
    refs.clienteResults?.addEventListener("click", (evt) => {
      const btn = evt.target.closest("button[data-cliente-id]");
      if (!btn) return;
      selectClienteResult(
        {
          id: btn.dataset.clienteId,
          nombre: btn.dataset.clienteNombre,
        },
        refs,
        state
      );
    });
    refs.clienteClear?.addEventListener("click", () =>
      clearClienteSelection(refs, state)
    );
    refs.clienteAddBtn?.addEventListener("click", () =>
      openClienteModal(refs, state)
    );
    refs.modalClienteCancel?.addEventListener("click", () =>
      closeClienteModal(refs)
    );
    refs.modalCliente?.addEventListener("click", (evt) => {
      if (evt.target === refs.modalCliente) closeClienteModal(refs);
    });
    refs.modalClienteSave?.addEventListener("click", () =>
      handleClienteSave(refs, state)
    );
    updateClienteFeedback(refs, "");
  }

  function handleClienteSearchInput(refs, state) {
    const value = refs.clienteInput.value || "";
    state.clienteQuery = value;
    state.clienteSelectedId = "";
    state.clienteSelectedNombre = "";
    state.manualClienteInput = value;
    hideClienteResults(refs);
    if (refs.clienteAddBtn) refs.clienteAddBtn.hidden = true;
    if (state.clienteSearchTimer) clearTimeout(state.clienteSearchTimer);
    if (!value.trim()) {
      state.clienteResults = [];
      updateClienteFeedback(refs, "");
      clearClienteSelection(refs, state, true);
      return;
    }
    updateClienteFeedback(refs, "Buscando clientes...");
    state.clienteSearchTimer = setTimeout(
      () => searchClientes(value, refs, state, true),
      320
    );
  }

  async function searchClientes(query, refs, state, autoSelect = false) {
    try {
      const pattern = `${normalizeCliente(query)}%`;
      const { data, error } = await window.sb
        .from("cliente")
        .select("id,nombre")
        .ilike("nombre_upper", pattern)
        .order("nombre", { ascending: true })
        .limit(20);
      if (error) throw error;
      state.clienteResults = data || [];
      renderClienteResults(refs, state);
      if (state.clienteResults.length) {
        if (refs.clienteAddBtn) {
          refs.clienteAddBtn.hidden = true;
          delete refs.clienteAddBtn.dataset.prefill;
        }
        updateClienteFeedback(refs, "");
        if (autoSelect) {
          autoSelectCliente(refs, state, state.clienteResults[0]);
        }
      } else {
        updateClienteFeedback(refs, "Sin coincidencias. Puedes agregarlo.");
        if (refs.clienteAddBtn) {
          const typed = query.trim();
          if (typed.length >= 3) {
            refs.clienteAddBtn.hidden = false;
            refs.clienteAddBtn.dataset.prefill = typed;
          } else {
            refs.clienteAddBtn.hidden = true;
            delete refs.clienteAddBtn.dataset.prefill;
          }
        }
        state.clienteSelectedId = "";
        state.clienteSelectedNombre = "";
        state.clienteQuery = query;
        state.manualClienteInput = query;
        refs.clienteInput.value = query;
        refs.clienteInput.classList.toggle("has-value", Boolean(query.trim()));
        updateGuardarEstado(refs, state);
      }
    } catch (err) {
      console.warn("[cliente-search] error", err);
      updateClienteFeedback(refs, "No se pudo buscar clientes.");
    }
  }

  function autoSelectCliente(refs, state, cliente) {
    if (!cliente?.id) return;
    selectClienteResult(cliente, refs, state, {
      manualValue: state.manualClienteInput || "",
      auto: true,
    });
  }

  function renderClienteResults(refs, state) {
    const list = refs.clienteResults;
    if (!list) return;
    list.innerHTML = "";
    list.hidden = true;
    refs.clienteBox?.setAttribute("aria-expanded", "false");
  }

  function hideClienteResults(refs) {
    if (refs.clienteResults) {
      refs.clienteResults.hidden = true;
      refs.clienteResults.innerHTML = "";
    }
    refs.clienteBox?.setAttribute("aria-expanded", "false");
  }

  function selectClienteResult(cliente, refs, state, options = {}) {
    if (!cliente?.id) return;
    const manualValue = (options.manualValue || "").trim();
    state.clienteSelectedId = cliente.id;
    state.clienteSelectedNombre = cliente.nombre || "";
    state.clienteQuery = manualValue || cliente.nombre || "";
    state.manualClienteInput = manualValue;
    if (refs.clienteInput) {
      refs.clienteInput.value = cliente.nombre || "";
      refs.clienteInput.classList.add("has-value");
      if (
        manualValue &&
        (cliente.nombre || "")
          .toUpperCase()
          .startsWith(manualValue.toUpperCase())
      ) {
        requestAnimationFrame(() => {
          if (document.activeElement !== refs.clienteInput) return;
          const end = (cliente.nombre || "").length;
          refs.clienteInput?.setSelectionRange(manualValue.length, end);
        });
      }
    }
    hideClienteResults(refs);
    refs.clienteAddBtn.hidden = true;
    updateClienteFeedback(refs, "");
    updateGuardarEstado(refs, state);
  }

  function clearClienteSelection(refs, state, silent = false) {
    state.clienteSelectedId = "";
    state.clienteSelectedNombre = "";
    state.clienteQuery = "";
    state.clienteResults = [];
    state.manualClienteInput = "";
    if (refs.clienteInput) {
      refs.clienteInput.value = "";
      refs.clienteInput.classList.remove("has-value");
    }
    hideClienteResults(refs);
  refs.clienteAddBtn.hidden = true;
  delete refs.clienteAddBtn.dataset.prefill;
  if (!silent) updateClienteFeedback(refs, "");
  updateGuardarEstado(refs, state);
}

  function updateClienteFeedback(refs, message) {
    if (refs.clienteFeedback) refs.clienteFeedback.textContent = message || "";
  }

  function openClienteModal(refs, state) {
    if (!refs.modalCliente) return;
    refs.modalClienteInput.value = (state.clienteQuery || "").trim();
    if (refs.modalClienteFeedback) refs.modalClienteFeedback.textContent = "";
    refs.modalCliente.classList.add("open");
    refs.modalCliente.setAttribute("aria-hidden", "false");
    setTimeout(() => refs.modalClienteInput?.focus(), 60);
  }

  function closeClienteModal(refs) {
    if (!refs.modalCliente) return;
    refs.modalCliente.classList.remove("open");
    refs.modalCliente.setAttribute("aria-hidden", "true");
    if (refs.modalClienteFeedback) refs.modalClienteFeedback.textContent = "";
  }

  async function handleClienteSave(refs, state) {
    const nombre = refs.modalClienteInput?.value.trim();
    if (!nombre || nombre.length < 3) {
      if (refs.modalClienteFeedback) {
        refs.modalClienteFeedback.textContent =
          "Ingresa al menos 3 caracteres para el nombre.";
      }
      return;
    }
    if (refs.modalClienteFeedback) {
      refs.modalClienteFeedback.textContent = "Guardando...";
    }
    try {
      const { data, error } = await window.sb
        .from("cliente")
        .insert({ nombre })
        .select("id,nombre")
        .single();
      if (error) throw error;
      closeClienteModal(refs);
      selectClienteResult(data, refs, state, { manualValue: data.nombre || "" });
      updateClienteFeedback(refs, "Cliente agregado correctamente.");
    } catch (err) {
      console.error("[cliente-modal] error", err);
      if (refs.modalClienteFeedback) {
        refs.modalClienteFeedback.textContent =
          "Error al guardar. Intenta nuevamente.";
      }
    }
  }
  // === END HU:HU-DASHBOARD-CUSTODIA-CLIENTE-SEARCH ===

  async function fetchAutocomplete(query, key) {
    if (!key) return [];
    const normalized = (query || "").trim();
    if (normalized.length < 3) return [];
    const params = new URLSearchParams({
      key,
      q: normalized,
      format: "json",
      addressdetails: "0",
      countrycodes: "pe",
      limit: "5",
      normalizecity: "1",
    });
    const endpoints = [
      `https://us1.locationiq.com/v1/autocomplete.php?${params.toString()}`,
      `https://us1.locationiq.com/v1/search.php?${params.toString()}`,
    ];
    for (const url of endpoints) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.status === 404) {
          continue;
        }
        if (!res.ok) {
          console.warn(`${LOG_API} autocomplete ${res.status}`, { url });
          continue;
        }
        const data = await res.json();
        if (Array.isArray(data) && data.length) return data;
        if (url.includes("search.php")) return data || [];
      } catch (err) {
        console.warn(`${LOG_API} autocomplete fetch`, { url, err });
      }
    }
    return [];
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
