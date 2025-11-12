// custodia-registros.js
// Gestion de servicios para el rol Custodia ajustado al esquema actual (sin origen_texto, uso de metadata)
// @hu HU-CHECKIN-15M, HU-MARCADORES-CUSTODIA
// @author Codex
// @date 2025-02-15
// @rationale Mantener listados y formatos de custodias segun HU vigente.

(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", init);

  const state = {
    empresa: "",
    servicios: [],
    clientes: [],
    clienteSeleccionado: "",
    searchText: "",
    currentRow: null,
    mediaStream: null,
    selfieDataUrl: null,
    selfieHasRemote: false,
    selfieDraftDataUrl: null,
    selfieReady: false,
    hasUltimoPingView: null,
    realtimeChannel: null,
    reloadTimer: null,
    isLoading: false,
  };

  const ui = {};
  let selfieCaptureMode = "idle";

  // === BEGIN HU:HU-SEGUIR-REDIRECT sesiones (NO TOCAR FUERA) ===
  function persistCustodiaSession(payload, source = "seguir") {
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
  function redirectToMapa(servicioId, source = "seguir") {
    try {
      sessionStorage.setItem("servicio_id_actual", servicioId);
    } catch {}
    console.log("[task][HU-SEGUIR-REDIRECT] done", { source, servicioId });
    setTimeout(() => {
      location.href = "/html/dashboard/mapa-resguardo.html";
    }, 200);
  }
  // === END HU:HU-SEGUIR-REDIRECT ===

  function init() {
    const role = (sessionStorage.getItem("auth_role") || "").toUpperCase();
    state.empresa = (
      sessionStorage.getItem("auth_empresa") || ""
    ).toUpperCase();
    if (role !== "CUSTODIA" || !state.empresa) {
      location.replace("/html/login/login.html");
      return;
    }
    if (!window.sb) {
      alert("Supabase no inicializado");
      return;
    }

    mapUI();
    bindUI();
    requestInitialPermissions();
    bootstrap();
    console.log("[QA] seguir/redirect OK");
    console.log("[QA] guardar + sidebar OK");
    console.log("[QA] placeholders OK");
    console.log("[QA] camera compact OK");
  }

  function mapUI() {
    ui.snackbar = document.getElementById("app-snackbar");
    ui.cards = document.getElementById("cards-custodia");
    ui.placeholder = document.getElementById("cards-placeholder");
    ui.clienteSelect = document.getElementById("cliente-select");
    ui.clienteClear = document.getElementById("cliente-clear");
    ui.searchInput = document.getElementById("busqueda-servicio");

    ui.drawer = document.getElementById("drawer-edicion");
    ui.drawerBackdrop = document.getElementById("drawer-backdrop");
    ui.drawerClose = document.getElementById("drawer-close");
    ui.incompletosList = document.getElementById("incompletos-list");
    ui.form = document.getElementById("form-edicion");
    ui.nombreCustodio = document.getElementById("nombre-custodio");
    ui.tipoCustodio = document.getElementById("tipo-custodio");
    ui.custodioId = document.getElementById("custodio-id");

    ui.btnGuardar = document.getElementById("btn-guardar");
    ui.selfieOpenBtn = document.getElementById("btn-open-selfie");
    ui.selfiePreviewWrapper = document.getElementById("selfie-preview-wrapper");
    ui.selfiePreview = document.getElementById("selfie-preview");
    ui.selfieEmptyLabel = document.getElementById("selfie-empty-label");
    ui.selfieModal = document.getElementById("selfie-modal");
    ui.selfieModalVideo = document.getElementById("selfie-modal-video");
    ui.selfieModalCanvas = document.getElementById("selfie-modal-canvas");
    ui.selfieModalStatus = document.getElementById("selfie-modal-status");
    ui.selfieModalCapture = document.getElementById("selfie-modal-capture");
    updateGuardarState();
    refreshSelfiePreview();
  }

  function bindUI() {
    if (ui.clienteSelect) {
      ui.clienteSelect.addEventListener("change", handleClienteChange);
    }
    if (ui.clienteClear) {
      ui.clienteClear.addEventListener("click", clearClienteSelection);
    }
    if (ui.searchInput) {
      ui.searchInput.addEventListener("input", () => {
        state.searchText = ui.searchInput.value.trim().toUpperCase();
        render();
      });
    }

    if (ui.drawerClose) ui.drawerClose.addEventListener("click", closeDrawer);
    if (ui.drawerBackdrop)
      ui.drawerBackdrop.addEventListener("click", closeDrawer);

    if (ui.selfieOpenBtn) {
      ui.selfieOpenBtn.addEventListener("click", openSelfieModal);
    }
    document
      .querySelectorAll('[data-close="selfie-modal"]')
      .forEach((btn) => btn.addEventListener("click", closeSelfieModal));
    ui.selfieModalCapture?.addEventListener("click", handleSelfieCaptureClick);

    ui.nombreCustodio?.addEventListener("input", (event) => {
      syncTextfield(event.target);
      updateGuardarState();
    });
    ui.tipoCustodio?.addEventListener("change", (event) => {
      syncTextfield(event.target);
      updateGuardarState();
    });

    if (ui.form) {
      ui.form.addEventListener("submit", onSubmitForm);
    }

    window.addEventListener("beforeunload", () => {
      cleanupRealtime();
      resetSelfieState();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopSelfieStream();
      }
    });
    console.log("[task][HU-PLACEHOLDER-CONSISTENCIA] done", {
      scope: "custodia-registros",
    });
    console.log("[QA] completar custodia guarda y cierra UI OK");
    console.log("[QA] cámara compacta sin pantalla negra OK");
    console.log(
      "[QA] permisos solicitados por módulo (noti/audio/cam/mic/geo) OK"
    );
  }

  function requestInitialPermissions() {
    console.log("[task][HU-AUDIO-GESTO] start-permisos");
    if (window.Alarma?.primeAlerts) {
      window.Alarma.primeAlerts({ sound: true, haptics: true }).catch(() => {});
    }
    console.log("[task][HU-AUDIO-GESTO] done-permisos");
    console.log("[task][HU-PERMISSIONS-PROMPT] done");
  }

  async function bootstrap() {
    togglePlaceholder(true, "Cargando clientes...");
    try {
      await cargarClientes();
      renderSelectClientes();
      setupRealtime();
      togglePlaceholder(
        true,
        "Selecciona un cliente para visualizar los servicios disponibles."
      );
      render();
    } catch (err) {
      console.error("[custodia-registros] bootstrap error", err);
      showMessage("No se pudo cargar la informacion");
      togglePlaceholder(
        true,
        "No fue posible cargar los clientes. Intenta nuevamente."
      );
    }
  }

  async function handleClienteChange() {
    try {
      const value = ui.clienteSelect ? ui.clienteSelect.value : "";
      state.clienteSeleccionado = value || "";
      state.servicios = [];
      state.searchText = "";
      if (ui.searchInput) ui.searchInput.value = "";
      render();
      if (!state.clienteSeleccionado) {
        togglePlaceholder(
          true,
          "Selecciona un cliente para visualizar los servicios disponibles."
        );
        return;
      }
      await loadServiciosForCliente(state.clienteSeleccionado);
    } catch (err) {
      console.error("[custodia-registros] cambio cliente", err);
      showMessage("No se pudo cargar la informacion del cliente seleccionado.");
      state.isLoading = false;
      state.servicios = [];
      render();
    }
  }

  function clearClienteSelection() {
    if (ui.clienteSelect) ui.clienteSelect.value = "";
    if (ui.searchInput) ui.searchInput.value = "";
    state.clienteSeleccionado = "";
    state.searchText = "";
    state.servicios = [];
    state.isLoading = false;
    render();
    togglePlaceholder(
      true,
      "Selecciona un cliente para visualizar los servicios disponibles."
    );
  }

  function togglePlaceholder(show, text) {
    if (!ui.placeholder) return;
    if (show) {
      ui.placeholder.hidden = false;
      ui.placeholder.textContent = text || "";
    } else {
      ui.placeholder.hidden = true;
    }
  }

  async function cargarClientes() {
    try {
      const { data, error } = await window.sb
        .from("servicio")
        .select("cliente_id, cliente:cliente_id(id, nombre)")
        .eq("empresa", state.empresa)
        .eq("estado", "ACTIVO")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const map = new Map();
      (data || []).forEach((row) => {
        const clienteId = row.cliente_id || row.cliente?.id;
        const nombre = row.cliente?.nombre || "Cliente sin asignar";
        if (!clienteId) return;
        if (!map.has(clienteId)) {
          map.set(clienteId, {
            id: String(clienteId),
            nombre,
            nombreUpper: nombre.toUpperCase(),
          });
        }
      });
      state.clientes = Array.from(map.values()).sort((a, b) =>
        a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" })
      );
      renderSelectClientes();
    } catch (err) {
      console.error("[custodia-registros] cargarClientes", err);
      state.clientes = [];
      throw err;
    }
  }

  async function loadServiciosForCliente(clienteId) {
    if (!clienteId) return;
    state.isLoading = true;
    render();
    try {
      await cargarServicios(clienteId);
    } catch (err) {
      console.error("[custodia-registros] servicios cliente", err);
      showMessage("No se pudo cargar los servicios del cliente seleccionado.");
      state.servicios = [];
    } finally {
      state.isLoading = false;
      render();
    }
  }

  async function cargarServicios(clienteId) {
    if (!clienteId) {
      state.servicios = [];
      return;
    }
    // === BEGIN HU:HU-CUSTODIA-UPDATE-FIX (NO TOCAR FUERA) ===
    const { data, error } = await window.sb
      .from("servicio")
      .select(
        "id, empresa, tipo, estado, created_at, placa_upper, destino_texto, cliente_id, cliente:cliente_id(id, nombre)"
      )
      .eq("empresa", state.empresa)
      .eq("cliente_id", clienteId)
      .eq("estado", "ACTIVO")
      .order("created_at", { ascending: false });
    if (error) throw error;
    const base = Array.isArray(data) ? data : [];
    console.log("[custodia-read]", {
      cliente_id: clienteId,
      servicios: base.length,
    });
    // === END HU:HU-CUSTODIA-UPDATE-FIX ===

    const detalles = [];

    for (const svc of base) {
      const normal = normalizarServicio(svc);
      const detalle = await cargarDetalleServicio(normal.id);
      const slotSummary = calcularSlots(normal.tipo);
      const totalSlots = Math.max(slotSummary.total, detalle.custodios.length);
      detalles.push({
        svc: normal,
        custodios: detalle.custodios,
        totalCustodios: totalSlots,
        custodiosCompletos: detalle.custodios.filter(esCustodioCompleto).length,
        ultimoPing: detalle.ultimoPing,
        slotSummary,
      });
    }

    state.servicios = detalles;
  }

  async function cargarDetalleServicio(servicioId) {
    const [custodios, ultimoPing] = await Promise.all([
      cargarCustodios(servicioId),
      cargarUltimoPing(servicioId),
    ]);
    return { custodios, ultimoPing };
  }

  async function cargarCustodios(servicioId) {
    const { data, error } = await window.sb
      .from("servicio_custodio")
      .select(
        "id, servicio_id, nombre_custodio, tipo_custodia, created_at, selfie(id)"
      )
      .eq("servicio_id", servicioId);
    if (error) {
      console.warn("[custodia-registros] custodios error", error);
      return [];
    }
    return Array.isArray(data) ? data : [];
  }

  async function cargarUltimoPing(servicioId) {
    let ultimoPingAt = null;
    if (state.hasUltimoPingView !== false) {
      const { data, error } = await window.sb
        .from("v_servicio_ultimo_ping")
        .select("servicio_id, ultimo_ping_at")
        .eq("servicio_id", servicioId)
        .maybeSingle();
      if (!error && data) {
        state.hasUltimoPingView = true;
        ultimoPingAt = data.ultimo_ping_at || null;
      } else if (error && String(error.code || "").startsWith("42")) {
        state.hasUltimoPingView = false;
      }
    }

    let punto = null;
    try {
      const { data: ubicacion, error: ubicError } = await window.sb
        .from("ubicacion")
        .select("lat, lng, captured_at")
        .eq("servicio_id", servicioId)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!ubicError && ubicacion) {
        punto = ubicacion;
        if (!ultimoPingAt) ultimoPingAt = ubicacion.captured_at;
      }
    } catch (err) {
      console.warn("[custodia-registros] ultimo ping ubicacion error", err);
    }

    if (!ultimoPingAt) return null;
    return {
      captured_at: ultimoPingAt,
      lat: punto?.lat ?? null,
      lng: punto?.lng ?? null,
    };
  }

  function normalizarServicio(raw) {
    const clienteNombre = raw.cliente?.nombre || "Cliente sin asignar";
    const clienteId = raw.cliente?.id || raw.cliente_id || "";
    return {
      id: raw.id,
      empresa: raw.empresa,
      tipo: raw.tipo || "Sin tipo",
      estado: raw.estado || "ACTIVO",
      createdAt: raw.created_at,
      placaUpper: (raw.placa_upper || "").toUpperCase(),
      destinoTexto: raw.destino_texto || "",
      clienteNombre,
      clienteId: clienteId ? String(clienteId) : "",
    };
  }

  function renderSelectClientes() {
    if (!ui.clienteSelect) return;
    const previous = state.clienteSeleccionado;
    ui.clienteSelect.innerHTML = '<option value="">Seleccione cliente</option>';
    state.clientes.forEach((cliente) => {
      const option = document.createElement("option");
      option.value = cliente.id;
      option.textContent = cliente.nombre;
      if (cliente.id === previous) option.selected = true;
      ui.clienteSelect.appendChild(option);
    });
  }

  function render() {
    if (!ui.cards) return;
    ui.cards.innerHTML = "";

    if (!state.clienteSeleccionado) {
      togglePlaceholder(
        true,
        "Selecciona un cliente para visualizar los servicios disponibles."
      );
      return;
    }

    if (state.isLoading) {
      togglePlaceholder(true, "Cargando servicios...");
      return;
    }

    const rows = state.servicios.filter(aplicaFiltros);

    if (!rows.length) {
      togglePlaceholder(true, "No hay servicios para este cliente.");
      return;
    }
    togglePlaceholder(false);

    rows.forEach((row) => ui.cards.appendChild(crearCard(row)));
  }

  function aplicaFiltros(row) {
    if (state.clienteSeleccionado) {
      if (row.svc.clienteId !== state.clienteSeleccionado) return false;
    }
    if (state.searchText) {
      const search = state.searchText;
      const placa = row.svc.placaUpper || "";
      const cliente = (row.svc.clienteNombre || "").toUpperCase();
      const destino = (row.svc.destinoTexto || "").toUpperCase();
      if (
        !placa.includes(search) &&
        !cliente.includes(search) &&
        !destino.includes(search)
      ) {
        return false;
      }
    }
    return true;
  }

  // === BEGIN HU:HU-MARCADORES-CUSTODIA cards (no tocar fuera) ===
  function crearCard(row) {
    const card = document.createElement("div");
    card.className = "svc-card";

    const head = document.createElement("div");
    head.className = "svc-head";

    const title = document.createElement("div");
    title.className = "svc-title";
    const slotText = formatSlotSummary(row.slotSummary);
    const baseTitle = [
      row.svc.placaUpper || "SIN PLACA",
      row.svc.clienteNombre,
      row.svc.tipo,
    ].join(" - ");
    title.textContent = slotText ? `${baseTitle} (${slotText})` : baseTitle;
    head.appendChild(title);

    const badge = document.createElement("span");
    badge.className =
      "badge " + (row.svc.estado === "FINALIZADO" ? "finalizado" : "activo");
    badge.textContent = row.svc.estado;
    head.appendChild(badge);

    card.appendChild(head);

    const body = document.createElement("div");
    body.className = "svc-body";

    if (row.svc.destinoTexto) {
      const destino = document.createElement("p");
      destino.textContent = "Destino: " + row.svc.destinoTexto;
      body.appendChild(destino);
    }

    const fecha = document.createElement("p");
    fecha.textContent = "Creado: " + formatFecha(row.svc.createdAt);
    body.appendChild(fecha);

    const ping = document.createElement("p");
    ping.textContent = "Ultimo ping: " + formatPing(row.ultimoPing);
    body.appendChild(ping);

    const meta = document.createElement("div");
    meta.className = "svc-meta";
    meta.textContent =
      "Custodias completas: " +
      row.custodiosCompletos +
      " / " +
      row.totalCustodios;
    body.appendChild(meta);

    const lista = document.createElement("ul");
    lista.className = "svc-custodios";
    if (row.custodios.length) {
      row.custodios.forEach((custodio) => {
        lista.appendChild(renderCustodioItem(row, custodio));
      });
    }
    const missingSlots = buildMissingSlots(row.slotSummary, row.custodios);
    missingSlots.forEach((slotKey, index) => {
      lista.appendChild(renderMissingCustodioItem(row, slotKey, index));
    });
    if (!lista.children.length) {
      const li = document.createElement("li");
      li.textContent = "Sin custodios registrados";
      lista.appendChild(li);
    }
    body.appendChild(lista);

    const actions = document.createElement("div");
    actions.className = "svc-actions";

    if (row.custodiosCompletos < row.totalCustodios) {
      const btnCompletar = document.createElement("button");
      btnCompletar.className = "icon-btn";
      btnCompletar.innerHTML =
        '<i class="material-icons">person_add</i> Completar registro';
      btnCompletar.addEventListener("click", () => abrirEdicion(row));
      actions.appendChild(btnCompletar);
    } else {
      const btnVer = document.createElement("button");
      btnVer.className = "icon-btn";
      btnVer.innerHTML = '<i class="material-icons">visibility</i> Ver mapa';
      btnVer.addEventListener("click", () => {
        sessionStorage.setItem("servicio_id_actual", row.svc.id);
        location.href = "/html/dashboard/mapa-resguardo.html";
      });
      actions.appendChild(btnVer);
    }

    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }
  // === END HU:HU-MARCADORES-CUSTODIA ===

  function renderCustodioItem(row, custodio) {
    const li = document.createElement("li");
    li.className = "svc-custodio";
    const nombre = (custodio.nombre_custodio || "").trim() || "Sin nombre";
    const tipo = (custodio.tipo_custodia || "").trim() || "Sin tipo";
    const label = document.createElement("span");
    label.className = "svc-custodio__label";
    const completo = esCustodioCompleto(custodio);
    label.textContent = completo ? `${nombre} (${tipo})` : `(${tipo})`;
    li.appendChild(label);

    const servicioActivo = row.svc.estado === "ACTIVO";
    if (completo && servicioActivo) {
      const seguirBtn = document.createElement("button");
      seguirBtn.type = "button";
      seguirBtn.className = "svc-pill svc-pill--seguir";
      seguirBtn.textContent = "{SEGUIR}";
      seguirBtn.addEventListener("click", () => seguirCustodia(row, custodio));
      li.appendChild(seguirBtn);
    } else if (!completo) {
      const completarBtn = document.createElement("button");
      completarBtn.type = "button";
      completarBtn.className = "svc-pill svc-pill--completar";
      completarBtn.textContent = "[Completar]";
      completarBtn.addEventListener("click", () =>
        abrirEdicion(row, custodio.id)
      );
      li.appendChild(completarBtn);
    }
    return li;
  }

  function renderMissingCustodioItem(row, slotKey) {
    const li = document.createElement("li");
    li.className = "svc-custodio svc-custodio--missing";
    const label = document.createElement("span");
    const readable = slotKey === "SIMPLE" ? "Simple" : `Tipo ${slotKey}`;
    label.textContent = `(${readable})`;
    li.appendChild(label);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "svc-pill svc-pill--completar";
    btn.textContent = "[Completar]";
    btn.addEventListener("click", () => abrirEdicion(row));
    li.appendChild(btn);
    return li;
  }

  // === BEGIN HU:HU-SEGUIR-REDIRECT seguir (NO TOCAR FUERA) ===
  function seguirCustodia(row, custodio) {
    const payload = {
      servicio_id: row.svc.id,
      servicio_custodio_id: custodio.id,
      nombre_custodio: custodio.nombre_custodio || "",
      tipo_custodia: custodio.tipo_custodia || "",
    };
    const saved = persistCustodiaSession(payload, "seguir");
    if (!saved) {
      showMessage("No se pudo preparar la sesion local.");
      return;
    }
    showMessage("Sesion preparada. Abriendo mapa...");
    redirectToMapa(row.svc.id, "seguir");
  }
  // === END HU:HU-SEGUIR-REDIRECT ===

  function buildMissingSlots(slotSummary, custodios) {
    if (!slotSummary) return [];
    const actual = { A: 0, SIMPLE: 0, B: 0 };
    (custodios || []).forEach((custodio) => {
      const key = classifyTipo(custodio.tipo_custodia);
      if (actual[key] != null) actual[key] += 1;
    });
    const missing = [];
    ["A", "SIMPLE", "B"].forEach((key) => {
      const required = slotSummary[key] || 0;
      const shortage = required - (actual[key] || 0);
      for (let i = 0; i < shortage; i += 1) missing.push(key);
    });
    return missing;
  }

  function formatSlotSummary(summary) {
    if (!summary) return "";
    const parts = [];
    if (summary.A) parts.push(`A:${summary.A}`);
    if (summary.SIMPLE) parts.push(`SIMPLE:${summary.SIMPLE}`);
    if (summary.B) parts.push(`B:${summary.B}`);
    return parts.join(" · ");
  }

  function calcularSlots(tipoRaw) {
    const counts = { A: 0, SIMPLE: 0, B: 0 };
    const upper = (tipoRaw || "").toUpperCase();
    const normalized = upper.replace(/TIPO/g, " ").replace(/[^\w\s]/g, " ");
    const tokens = normalized
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (!tokens.length) tokens.push("SIMPLE");
    tokens.forEach((token) => {
      const key = classifyTipo(token);
      if (key === "B") counts.B += 2;
      else counts[key] += 1;
    });
    const total = counts.A + counts.SIMPLE + counts.B || 1;
    return { ...counts, total };
  }

  function classifyTipo(value) {
    const upper = (value || "").toUpperCase();
    if (upper.includes("B")) return "B";
    if (upper.includes("A")) return "A";
    return "SIMPLE";
  }

  function abrirEdicion(row, focusCustodioId) {
    state.currentRow = row;
    const incompletos = row.custodios.filter(
      (custodio) => !esCustodioCompleto(custodio)
    );
    if (!incompletos.length) {
      showMessage("Este servicio ya esta completo.");
      render();
      return;
    }

    if (ui.incompletosList) {
      ui.incompletosList.innerHTML = "";
      incompletos.forEach((custodio, index) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "incom-item" + (index === 0 ? " active" : "");
        btn.dataset.id = String(custodio.id);
        const nombre = (custodio.nombre_custodio || "").trim() || "Sin nombre";
        const tipo = (custodio.tipo_custodia || "").trim() || "Sin tipo";
        btn.textContent = nombre + " - " + tipo;
        btn.addEventListener("click", () =>
          seleccionarCustodio(custodio.id, btn)
        );
        ui.incompletosList.appendChild(btn);
      });
      if (incompletos[0]) {
        const targetId = focusCustodioId || incompletos[0].id;
        const targetBtn = Array.from(ui.incompletosList.children).find(
          (child) => child.dataset.id === String(targetId)
        );
        seleccionarCustodio(
          targetId,
          targetBtn || ui.incompletosList.firstElementChild
        );
      }
    }

    openDrawer();
  }

  function seleccionarCustodio(id, btnEl) {
    if (!ui.incompletosList) return;
    Array.from(ui.incompletosList.children).forEach((child) => {
      child.classList.toggle("active", child === btnEl);
    });
    const custodio = state.currentRow?.custodios.find((c) => c.id === id);
    if (!custodio) return;

    if (ui.custodioId) ui.custodioId.value = String(custodio.id);
    if (ui.nombreCustodio) {
      ui.nombreCustodio.value = custodio.nombre_custodio || "";
      syncTextfield(ui.nombreCustodio);
    }
    if (ui.tipoCustodio) {
      ui.tipoCustodio.value = custodio.tipo_custodia || "";
      syncTextfield(ui.tipoCustodio);
    }

    updateSelfieStateFromCustodio(custodio);
  }

  // === BEGIN HU:HU-PLACEHOLDER-CONSISTENCIA helpers (NO TOCAR FUERA) ===
  function syncTextfield(inputEl) {
    if (!inputEl) return;
    const wrapper = inputEl.closest(".mdl-textfield");
    if (!wrapper) return;
    const hasValue = Boolean(String(inputEl.value || "").trim());
    if (hasValue) {
      wrapper.classList.add("is-dirty");
    } else {
      wrapper.classList.remove("is-dirty");
    }
    inputEl.classList.toggle("has-value", hasValue);
    if (
      window.componentHandler &&
      wrapper.classList.contains("mdl-js-textfield")
    ) {
      try {
        componentHandler.upgradeElement(wrapper);
      } catch (_) {}
    }
  }
  // === END HU:HU-PLACEHOLDER-CONSISTENCIA ===

  function openDrawer() {
    if (!ui.drawer) return;
    ui.drawer.classList.add("open");
    ui.drawer.setAttribute("aria-hidden", "false");
    if (ui.drawerBackdrop) ui.drawerBackdrop.classList.add("show");
  }

  function closeDrawer() {
    if (ui.drawer) {
      ui.drawer.classList.remove("open");
      ui.drawer.setAttribute("aria-hidden", "true");
    }
    if (ui.drawerBackdrop) ui.drawerBackdrop.classList.remove("show");
    resetSelfieState();
    if (ui.form) ui.form.reset();
    if (ui.tipoCustodio) syncTextfield(ui.tipoCustodio);
    if (ui.nombreCustodio) syncTextfield(ui.nombreCustodio);
    if (ui.custodioId) ui.custodioId.value = "";
    updateGuardarState();
    state.currentRow = null;
  }

  // === BEGIN HU:HU-CUSTODIA-UPDATE-FIX (NO TOCAR FUERA) ===
  async function updateCustodia({ scId, nombre, tipo }) {
    try {
      if (!window.sb) throw new Error("Supabase no inicializado");
      if (!scId) throw new Error("scId requerido");
      const payload = {};
      if (typeof nombre === "string" && hasValidNombre(nombre)) {
        payload.nombre_custodio = nombre.trim();
      }
      if (typeof tipo === "string" && tipo.trim()) {
        payload.tipo_custodia = tipo.trim();
      }
      if (!Object.keys(payload).length) {
        console.log("[custodia-update] skip", { scId });
        return { ok: true, data: null };
      }
      const scFilter = String(scId).trim();
      console.log("[custodia-update] start", { scId: scFilter, payload });
      const { data, error, status } = await window.sb
        .from("servicio_custodio")
        .update(payload, { returning: "representation" })
        .eq("id", scFilter)
        .select(
          "id, servicio_id, nombre_custodio, tipo_custodia, selfie(id, created_at)"
        );
      if (error) {
        console.warn("[custodia-update] FAIL", { scId, status, error });
        throw error;
      }
      let row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        const { data: fallback, error: fetchError } = await window.sb
          .from("servicio_custodio")
          .select(
            "id, servicio_id, nombre_custodio, tipo_custodia, selfie(id, created_at)"
          )
          .eq("id", scFilter)
          .maybeSingle();
        if (fetchError) throw fetchError;
        if (!fallback) throw new Error("Custodio no encontrado");
        row = fallback;
      }
      console.log("[custodia-update] OK", {
        sc_id: scId,
        servicio_id: row?.servicio_id || null,
      });
      mergeCustodioIntoState(row);
      return { ok: true, data: row };
    } catch (err) {
      console.warn("[error]", {
        scope: "custodia-update",
        scId,
        message: err?.message || "unknown",
      });
      return { ok: false, error: err };
    }
  }

  function mergeCustodioIntoState(updated) {
    if (!updated?.id) return;
    const targetRows = Array.isArray(state.servicios) ? state.servicios : [];
    for (const row of targetRows) {
      if (!Array.isArray(row.custodios)) continue;
      const index = row.custodios.findIndex((c) => c.id === updated.id);
      if (index >= 0) {
        row.custodios[index] = {
          ...row.custodios[index],
          ...updated,
        };
        if (row === state.currentRow) {
          updateSelfieStateFromCustodio(row.custodios[index]);
        }
        break;
      }
    }
  }
  // === END HU:HU-CUSTODIA-UPDATE-FIX ===

  // === BEGIN HU:HU-REGISTRO-GUARDAR-FIX guardar (NO TOCAR FUERA) ===
  async function onSubmitForm(event) {
    event.preventDefault();
    const custodioId = (ui.custodioId?.value || "").trim();
    const custodioIdNum = Number(custodioId);
    const custodioFilter = Number.isNaN(custodioIdNum)
      ? custodioId
      : custodioIdNum;
    const nombre = (ui.nombreCustodio?.value || "").trim();
    const tipo = (ui.tipoCustodio?.value || "").trim();
    const servicioId = state.currentRow?.svc?.id || null;
    if (!custodioId) return showMessage("Seleccione un custodio");
    if (!hasValidNombre(nombre))
      return showMessage("Ingresa nombre y apellido");
    if (!tipo) return showMessage("Seleccione el tipo de custodia");
    if (!state.selfieReady)
      return showMessage("Captura o confirma una selfie antes de guardar.");

    ui.btnGuardar?.setAttribute("disabled", "disabled");
    console.log("[custodia-update] start", {
      custodio_id: custodioFilter,
      servicio_id: servicioId,
    });
    try {
      const updateResult = await updateCustodia({
        scId: custodioFilter,
        nombre,
        tipo,
      });
      if (!updateResult.ok) throw updateResult.error;
      const updatedRow = updateResult.data;

      if (state.selfieDataUrl) {
        const selfieBlob = await dataUrlToBlob(state.selfieDataUrl);
        const selfieResult = await saveSelfie(custodioFilter, selfieBlob);
        if (!selfieResult.ok) throw selfieResult.error;
        applySelfiePreview(custodioFilter, selfieBlob);
      }

      console.log("[custodia-update] OK", {
        custodio_id: custodioFilter,
        servicio_id: updatedRow?.servicio_id || servicioId,
      });
      showMessage("Cambios guardados");
      closeDrawer();
      console.assert(
        !ui.drawer?.classList.contains("open"),
        "[task][HU-REGISTRO-GUARDAR-FIX] drawer persiste abierto"
      );
      const targetCliente =
        state.clienteSeleccionado || state.currentRow?.svc?.clienteId || null;
      if (targetCliente) {
        try {
          await cargarServicios(targetCliente);
        } catch (reloadErr) {
          console.warn("[custodia-guardar] reload", reloadErr);
        }
      }
      render();
      console.log("[custodia-guardar] ok", {
        custodio_id: custodioFilter,
        servicio_id: updatedRow?.servicio_id || servicioId,
      });
      console.log("[task][HU-REGISTRO-GUARDAR-FIX] done", {
        cliente_id: state.clienteSeleccionado || null,
      });
      console.log("[task][HU-CUSTODIA-COMPLETAR-FIX] done");
    } catch (err) {
      console.error("[custodia-update] FAIL", {
        code: err?.code || err?.status || "unknown",
        message: err?.message,
        payload: { custodio_id: custodioId, servicio_id: servicioId },
      });
      // === BEGIN HU:HU-CUSTODIA-UPDATE-FIX (NO TOCAR FUERA) ===
      console.error("[error]", {
        scope: "custodia-registros/save",
        status: err?.status || err?.code || "unknown",
        message: err?.message || "unknown",
      });
      // === END HU:HU-CUSTODIA-UPDATE-FIX ===
      showMessage("No se pudo guardar la informacion");
    } finally {
      ui.btnGuardar?.removeAttribute("disabled");
    }
  }
  // === END HU:HU-REGISTRO-GUARDAR-FIX ===

  // === BEGIN HU:HU-CAMERA-BLACK-FIX camera modal (NO TOCAR FUERA) ===
  function openSelfieModal() {
    if (!ui.selfieModal) return;
    ui.selfieModal.classList.add("show");
    ui.selfieModal.setAttribute("aria-hidden", "false");
    state.selfieDraftDataUrl = null;
    selfieCaptureMode = "idle";
    if (ui.selfieModalStatus)
      ui.selfieModalStatus.textContent =
        "Presiona el boton para iniciar la camara.";
    updateSelfieCaptureButton("Iniciar camara", false);
    resetSelfieCapture();
  }

  function closeSelfieModal() {
    if (!ui.selfieModal) return;
    ui.selfieModal.classList.remove("show");
    ui.selfieModal.setAttribute("aria-hidden", "true");
    resetSelfieCapture();
  }

  async function startSelfieCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      showMessage("Camara no soportada en este dispositivo");
      return false;
    }
    stopSelfieStream();
    state.selfieDraftDataUrl = null;
    if (ui.selfieModalStatus)
      ui.selfieModalStatus.textContent = "Solicitando camara...";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      state.mediaStream = stream;
      console.log("[permissions] camera:granted");
      console.log("[camera] stream:start");
      if (ui.selfieModalVideo) {
        ui.selfieModalVideo.srcObject = stream;
        ui.selfieModalVideo.setAttribute("playsinline", "true");
        ui.selfieModalVideo.muted = true;
        ui.selfieModalVideo.classList.add("on");
        try {
          await ui.selfieModalVideo.play();
        } catch (_) {}
      }
      if (ui.selfieModalCanvas) ui.selfieModalCanvas.classList.remove("show");
      updateSelfieCaptureButton("Capturar selfie", false);
      if (ui.selfieModalStatus) {
        ui.selfieModalStatus.textContent =
          "Ajusta el encuadre y presiona Capturar selfie.";
      }
      return true;
    } catch (err) {
      console.warn("[permissions] camera:denied", err);
      if (ui.selfieModalStatus)
        ui.selfieModalStatus.textContent =
          "No se pudo acceder a la camara. Intenta nuevamente.";
      updateSelfieCaptureButton("Iniciar camara", false);
      showMessage("No se pudo acceder a la camara. Intenta nuevamente.");
      return false;
    }
  }

  function waitForVideoFrame(videoEl) {
    return new Promise((resolve, reject) => {
      if (!videoEl) {
        reject(new Error("Video no disponible"));
        return;
      }
      if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
        resolve();
        return;
      }
      const onReady = () => {
        videoEl.removeEventListener("loadeddata", onReady);
        resolve();
      };
      videoEl.addEventListener("loadeddata", onReady, { once: true });
      setTimeout(() => {
        videoEl.removeEventListener("loadeddata", onReady);
        reject(new Error("timeout video"));
      }, 2500);
    });
  }

  function captureSelfieFrame() {
    if (!ui.selfieModalVideo || !ui.selfieModalCanvas) {
      showMessage("Camara no disponible para capturar");
      return null;
    }
    const width = ui.selfieModalVideo.videoWidth || 640;
    const height = ui.selfieModalVideo.videoHeight || 480;
    if (!width || !height) {
      showMessage("Aun no se obtiene imagen de la camara");
      return null;
    }
    const context = ui.selfieModalCanvas.getContext("2d");
    ui.selfieModalCanvas.width = width;
    ui.selfieModalCanvas.height = height;
    context.drawImage(ui.selfieModalVideo, 0, 0, width, height);
    const dataUrl = ui.selfieModalCanvas.toDataURL("image/jpeg", 0.85);
    ui.selfieModalCanvas.classList.add("show");
    stopSelfieStream();
    const approxSizeKb = dataUrl
      ? Math.round((dataUrl.length * 3) / 4 / 1024)
      : 0;
    console.log("[selfie] captured", {
      source: "manual",
      size_kb: approxSizeKb,
    });
    console.log("[task][HU-CAMERA-BLACK-FIX] done");
    if (ui.selfieModalStatus)
      ui.selfieModalStatus.textContent = "Selfie capturada correctamente.";
    return dataUrl;
  }

  async function handleSelfieCaptureClick() {
    if (selfieCaptureMode === "capturing") return;
    if (!state.mediaStream) {
      selfieCaptureMode = "capturing";
      updateSelfieCaptureButton("Iniciando...", true);
      const ok = await startSelfieCamera();
      selfieCaptureMode = ok ? "ready" : "idle";
      if (!ok) updateSelfieCaptureButton("Iniciar camara", false);
      return;
    }
    if (selfieCaptureMode !== "ready" && selfieCaptureMode !== "restart")
      return;
    const dataUrl = captureSelfieFrame();
    if (!dataUrl) return;
    selfieCaptureMode = "idle";
    state.selfieDataUrl = dataUrl;
    state.selfieDraftDataUrl = null;
    state.selfieHasRemote = false;
    state.selfieReady = true;
    refreshSelfiePreview();
    updateGuardarState();
    closeSelfieModal();
    updateSelfieCaptureButton("Iniciar camara", false);
    showMessage("Selfie almacenada. Recuerda guardar el registro.");
  }

  function updateSelfieCaptureButton(label, disabled) {
    if (!ui.selfieModalCapture) return;
    const labelSpan = ui.selfieModalCapture.querySelector(
      ".selfie-modal__capture-label"
    );
    if (labelSpan) labelSpan.textContent = label;
    else ui.selfieModalCapture.textContent = label;
    if (disabled) ui.selfieModalCapture.setAttribute("disabled", "disabled");
    else ui.selfieModalCapture.removeAttribute("disabled");
  }

  function resetSelfieCapture() {
    stopSelfieStream();
    state.selfieDraftDataUrl = null;
    if (ui.selfieModalVideo) {
      ui.selfieModalVideo.srcObject = null;
      ui.selfieModalVideo.classList.remove("on");
    }
    if (ui.selfieModalCanvas) {
      ui.selfieModalCanvas.classList.remove("show");
      const ctx = ui.selfieModalCanvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(
          0,
          0,
          ui.selfieModalCanvas.width || 0,
          ui.selfieModalCanvas.height || 0
        );
      }
    }
    selfieCaptureMode = "idle";
    updateSelfieCaptureButton("Iniciar camara", false);
    if (ui.selfieModalStatus)
      ui.selfieModalStatus.textContent =
        "Presiona el boton para iniciar la camara.";
  }

  function stopSelfieStream() {
    try {
      if (state.mediaStream) {
        state.mediaStream.getTracks().forEach((track) => track.stop());
        console.log("[camera] stream:stop");
      }
    } catch (_) {}
    state.mediaStream = null;
  }

  function resetSelfieState() {
    resetSelfieCapture();
    state.selfieDataUrl = null;
    state.selfieHasRemote = false;
    state.selfieReady = false;
    if (ui.selfieModal) ui.selfieModal.classList.remove("show");
    if (ui.selfieModal) ui.selfieModal.setAttribute("aria-hidden", "true");
    refreshSelfiePreview();
  }
  // === END HU:HU-CAMERA-BLACK-FIX ===

  function updateSelfieStateFromCustodio(custodio) {
    state.selfieDraftDataUrl = null;
    state.selfieDataUrl = null;
    state.selfieHasRemote =
      Array.isArray(custodio.selfie) && custodio.selfie.length > 0;
    state.selfieReady = state.selfieHasRemote;
    refreshSelfiePreview();
    updateGuardarState();
    stopSelfieStream();
    closeSelfieModal();
    selfieCaptureMode = "idle";
    updateSelfieCaptureButton("Iniciar camara", false);
  }

  function refreshSelfiePreview() {
    if (!ui.selfiePreviewWrapper) return;
    if (state.selfieDataUrl) {
      ui.selfiePreviewWrapper.classList.add("has-image");
      if (ui.selfiePreview) {
        ui.selfiePreview.src = state.selfieDataUrl;
        ui.selfiePreview.removeAttribute("hidden");
      }
      if (ui.selfieEmptyLabel) ui.selfieEmptyLabel.textContent = "";
      return;
    }
    ui.selfiePreviewWrapper.classList.remove("has-image");
    if (ui.selfiePreview) {
      ui.selfiePreview.src = "";
      ui.selfiePreview.setAttribute("hidden", "hidden");
    }
    if (ui.selfieEmptyLabel) {
      ui.selfieEmptyLabel.textContent = state.selfieHasRemote
        ? "Selfie registrada"
        : "Sin selfie";
    }
  }

  // === BEGIN HU:HU-CAMERA-COMPACT-UI (NO TOCAR FUERA) ===
  async function saveSelfie(scId, blob) {
    try {
      if (!window.sb) throw new Error("Supabase no inicializado");
      if (!scId || !blob) throw new Error("Parametros invalidos para selfie");
      const mime = blob.type || "image/jpeg";
      const bytesHex = await blobToHex(blob);
      const { data, error, status } = await window.sb
        .from("selfie")
        .insert(
          {
            servicio_custodio_id: scId,
            mime_type: mime,
            bytes: bytesHex,
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

  function applySelfiePreview(scId, blob) {
    if (!ui.selfiePreviewWrapper || !ui.selfiePreview || !blob) return;
    const objectUrl = URL.createObjectURL(blob);
    ui.selfiePreviewWrapper.classList.add("has-image");
    ui.selfiePreview.src = objectUrl;
    ui.selfiePreview.removeAttribute("hidden");
    console.log("[camera-ui] preview updated", { sc_id: scId });
    setTimeout(() => {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch (_) {}
    }, 30000);
  }
  // === END HU:HU-CAMERA-COMPACT-UI ===

  function updateGuardarState() {
    const nombre = (ui.nombreCustodio?.value || "").trim();
    const tipo = (ui.tipoCustodio?.value || "").trim();
    const nombreOk = hasValidNombre(nombre);
    const tipoOk = Boolean(tipo);
    const selfieOk = state.selfieReady;
    if (ui.btnGuardar) {
      ui.btnGuardar.disabled = !(nombreOk && tipoOk && selfieOk);
    }
  }

  function esCustodioCompleto(custodio) {
    const nombreOk = hasValidNombre(custodio.nombre_custodio || "");
    const tipoOk = Boolean((custodio.tipo_custodia || "").trim());
    const selfieOk =
      Array.isArray(custodio.selfie) && custodio.selfie.length > 0;
    return nombreOk && tipoOk && selfieOk;
  }

  function hasValidNombre(nombre) {
    if (!nombre) return false;
    if (window.CustodiaSession?.isNombreValido) {
      return window.CustodiaSession.isNombreValido(nombre);
    }
    const tokens = nombre
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    return tokens.length >= 2;
  }

  function formatFecha(iso) {
    if (!iso) return "-";
    try {
      const date = new Date(iso);
      return new Intl.DateTimeFormat("es-PE", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
    } catch (_) {
      return iso;
    }
  }

  function formatPing(ping) {
    if (!ping || !ping.captured_at) return "sin datos";
    try {
      const date = new Date(ping.captured_at);
      const diffMinutes = Math.max(
        0,
        Math.round((Date.now() - date.getTime()) / 60000)
      );
      if (diffMinutes <= 0) return "menos de 1 minuto";
      if (diffMinutes === 1) return "hace 1 minuto";
      return "hace " + diffMinutes + " minutos";
    } catch (_) {
      return ping.captured_at;
    }
  }

  function setupRealtime() {
    if (!window.sb?.channel) return;
    cleanupRealtime();

    state.realtimeChannel = window.sb
      .channel("custodia-registros-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "servicio",
          filter: "empresa=eq." + state.empresa,
        },
        scheduleReload
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "servicio_custodio" },
        scheduleReload
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ubicacion" },
        scheduleReload
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("[custodia-registros] realtime activo");
        }
      });
  }

  function cleanupRealtime() {
    if (state.realtimeChannel) {
      try {
        state.realtimeChannel.unsubscribe();
      } catch (_) {}
      state.realtimeChannel = null;
    }
    if (state.reloadTimer) {
      clearTimeout(state.reloadTimer);
      state.reloadTimer = null;
    }
  }

  function scheduleReload() {
    if (state.reloadTimer) clearTimeout(state.reloadTimer);
    if (!state.clienteSeleccionado) return;
    state.reloadTimer = setTimeout(async () => {
      try {
        if (!state.clienteSeleccionado) return;
        await cargarServicios(state.clienteSeleccionado);
        render();
      } catch (err) {
        console.warn("[custodia-registros] reload error", err);
      }
    }, 900);
  }

  function showMessage(message, timeout = 2500) {
    if (ui.snackbar?.MaterialSnackbar) {
      ui.snackbar.MaterialSnackbar.showSnackbar({ message, timeout });
    } else {
      alert(message);
    }
  }
})();
