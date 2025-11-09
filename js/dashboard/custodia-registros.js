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
    selectedCustodioId: null,
    selfieDataUrl: null,
    selfieModalStream: null,
    selfieModalOpen: false,
    hasUltimoPingView: null,
    realtimeChannel: null,
    reloadTimer: null,
    isLoading: false,
    permissionsRequested: false,
  };

  const ui = {};
  const SLOT_RULES = [
    {
      key: "SIMPLE",
      label: "Simple",
      badge: "SIMPLE",
      required: 1,
      matcher: (tipo) => tipo.includes("SIMPLE"),
    },
    {
      key: "TIPO A",
      label: "Tipo A",
      badge: "A",
      required: 1,
      matcher: (tipo) => tipo.includes("A"),
    },
    {
      key: "TIPO B",
      label: "Tipo B",
      badge: "B",
      required: 2,
      matcher: (tipo) => tipo.includes("B"),
    },
  ];

  function normalizeTipoCustodia(value) {
    if (!value) return "";
    const txt = String(value).trim().toUpperCase();
    if (txt.includes("TIPO B") || txt === "B") return "TIPO B";
    if (txt.includes("TIPO A") || txt === "A") return "TIPO A";
    if (txt.includes("SIMPLE")) return "SIMPLE";
    return txt || "";
  }

  function buildSlotPlan(servicioTipo) {
    const tipo = String(servicioTipo || "")
      .trim()
      .toUpperCase();
    if (!tipo) return [];
    const plan = [];
    SLOT_RULES.forEach((rule) => {
      if (rule.matcher(tipo)) {
        plan.push({ ...rule });
      }
    });
    return plan;
  }

  function countNombreTokens(nombre) {
    if (!nombre) return 0;
    return nombre
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean).length;
  }

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
    requestEssentialPermissions();
    bindUI();
    bootstrap();
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

    ui.btnOpenSelfie = document.getElementById("btn-open-selfie");
    ui.selfiePreview = document.getElementById("selfie-preview");
    ui.selfiePreviewWrapper = document.getElementById("selfie-preview-wrapper");
    ui.selfieEmptyLabel = document.getElementById("selfie-empty-label");
    ui.btnGuardar = document.getElementById("btn-guardar");

    ui.selfieModal = document.getElementById("selfie-modal");
    ui.selfieModalVideo = document.getElementById("selfie-modal-video");
    ui.selfieModalCanvas = document.getElementById("selfie-modal-canvas");
    ui.selfieModalStatus = document.getElementById("selfie-modal-status");
    ui.selfieModalStart = document.getElementById("selfie-modal-start");
    ui.selfieModalCapture = document.getElementById("selfie-modal-capture");
    ui.selfieModalRetry = document.getElementById("selfie-modal-retry");
    ui.selfieModalAccept = document.getElementById("selfie-modal-accept");

    updateSelfiePreview(null);
    updateGuardarButton();
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

    ui.nombreCustodio?.addEventListener("input", updateGuardarButton);
    ui.tipoCustodio?.addEventListener("change", updateGuardarButton);

    if (ui.btnOpenSelfie) {
      ui.btnOpenSelfie.addEventListener("click", openSelfieModal);
    }
    if (ui.selfieModalStart) {
      ui.selfieModalStart.addEventListener("click", startSelfieStream);
    }
    if (ui.selfieModalCapture) {
      ui.selfieModalCapture.addEventListener("click", captureSelfieFromModal);
    }
    if (ui.selfieModalRetry) {
      ui.selfieModalRetry.addEventListener("click", restartSelfieCapture);
    }
    if (ui.selfieModalAccept) {
      ui.selfieModalAccept.addEventListener("click", acceptSelfieFromModal);
    }
    if (ui.selfieModal) {
      ui.selfieModal
        .querySelectorAll("[data-close=\"selfie-modal\"]")
        .forEach((btn) =>
          btn.addEventListener("click", () => closeSelfieModal())
        );
    }

    if (ui.form) {
      ui.form.addEventListener("submit", onSubmitForm);
    }

    window.addEventListener("beforeunload", () => {
      cleanupRealtime();
      resetCamera();
    });
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
      const value = ui.clienteSelect ? ui.clienteSelect.value : '';
      state.clienteSeleccionado = value || '';
      state.servicios = [];
      state.searchText = '';
      if (ui.searchInput) ui.searchInput.value = '';
      render();
      if (!state.clienteSeleccionado) {
        togglePlaceholder(true, 'Selecciona un cliente para visualizar los servicios disponibles.');
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
    if (ui.clienteSelect) ui.clienteSelect.value = '';
    if (ui.searchInput) ui.searchInput.value = '';
    state.clienteSeleccionado = '';
    state.searchText = '';
    state.servicios = [];
    state.isLoading = false;
    render();
    togglePlaceholder(true, 'Selecciona un cliente para visualizar los servicios disponibles.');
  }

  function togglePlaceholder(show, text) {
    if (!ui.placeholder) return;
    if (show) {
      ui.placeholder.hidden = false;
      ui.placeholder.textContent = text || '';
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
    const baseRaw = Array.isArray(data) ? data : [];
    const base = baseRaw.filter(
      (row) => (row.estado || "").toUpperCase() !== "FINALIZADO"
    );

    const detalles = [];

    for (const svc of base) {
      const normal = normalizarServicio(svc);
      const detalle = await cargarDetalleServicio(normal.id);
      const slotPlan = buildSlotPlan(normal.tipo);
      const requiredSlots = slotPlan.reduce(
        (acc, slot) => acc + (slot.required || 0),
        0
      );
      const custodiosCompletos = detalle.custodios.filter(esCustodioCompleto)
        .length;
      detalles.push({
        svc: normal,
        custodios: detalle.custodios,
        totalCustodios: requiredSlots || detalle.custodios.length,
        totalRegistrados: detalle.custodios.length,
        custodiosCompletos,
        slotPlan,
        ultimoPing: detalle.ultimoPing,
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
      clienteId: clienteId ? String(clienteId) : '',
    };
  }

  function renderSelectClientes() {
    if (!ui.clienteSelect) return;
    const previous = state.clienteSeleccionado;
    ui.clienteSelect.innerHTML = '<option value="">Seleccione cliente</option>';
    state.clientes.forEach((cliente) => {
      const option = document.createElement('option');
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
    title.textContent = buildCardTitle(row);
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
    const total =
      row.totalCustodios ||
      row.totalRegistrados ||
      row.custodios.length ||
      0;
    meta.textContent =
      "Custodias completas: " + row.custodiosCompletos + " / " + total;
    body.appendChild(meta);

    body.appendChild(renderSlots(row));
    card.appendChild(body);
    return card;
  }

  function buildCardTitle(row) {
    const placa = row.svc.placaUpper || "SIN PLACA";
    const cliente = row.svc.clienteNombre || "CLIENTE";
    const baseTipo = (row.svc.tipo || "TIPO").toUpperCase();
    if (!row.slotPlan || !row.slotPlan.length) {
      return [placa, cliente, baseTipo].join(" – ");
    }
    const badges = row.slotPlan
      .map((slot) => `(${slot.required}${slot.badge})`)
      .join("");
    return `${placa} – ${cliente} – ${baseTipo} ${badges}`;
  }

  function renderSlots(row) {
    const container = document.createElement("div");
    container.className = "svc-slots";
    const groups = groupCustodiosPorTipo(row.custodios);
    const plan = Array.isArray(row.slotPlan) ? row.slotPlan : [];
    if (plan.length) {
      plan.forEach((slot) => {
        const key = slot.key;
        const label = slot.label;
        const registros = groups.get(key) || [];
        const count = Math.max(slot.required, registros.length);
        for (let i = 0; i < count; i++) {
          container.appendChild(
            crearSlotItem(row, registros[i] || null, label, key)
          );
        }
        groups.delete(key);
      });
    }
    if (groups.size) {
      groups.forEach((custodios, key) => {
        custodios.forEach((custodio) =>
          container.appendChild(
            crearSlotItem(row, custodio, key || "Custodia", key || "OTRO")
          )
        );
      });
    }
    if (!container.children.length) {
      const empty = document.createElement("p");
      empty.className = "svc-meta";
      empty.textContent = "Sin custodias registradas.";
      container.appendChild(empty);
    }
    return container;
  }

  function groupCustodiosPorTipo(custodios) {
    const map = new Map();
    (custodios || []).forEach((custodio) => {
      const key = normalizeTipoCustodia(custodio.tipo_custodia);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(custodio);
    });
    return map;
  }

  function crearSlotItem(row, custodio, typeLabel, typeKey) {
    const slot = document.createElement("div");
    slot.className = "slot-item";
    const esCompleto = custodio ? esCustodioCompleto(custodio) : false;
    if (!custodio) slot.classList.add("slot-empty");
    else if (esCompleto) slot.classList.add("slot-complete");
    else slot.classList.add("slot-partial");

    const main = document.createElement("div");
    main.className = "slot-main";
    const title = document.createElement("span");
    title.className = "slot-title";
    title.textContent = custodio
      ? (custodio.nombre_custodio || "Sin nombre").trim()
      : `(${typeLabel})`;
    main.appendChild(title);

    const meta = document.createElement("span");
    meta.className = "slot-meta";
    if (custodio) {
      const issues = [];
      if (countNombreTokens(custodio.nombre_custodio || "") < 2)
        issues.push("Nombre incompleto");
      if (!custodio.tipo_custodia) issues.push("Sin tipo");
      if (
        !Array.isArray(custodio.selfie) ||
        custodio.selfie.length === 0
      )
        issues.push("Selfie pendiente");
      meta.textContent = issues.length ? issues.join(" • ") : "Listo";
    } else {
      meta.textContent = "Falta registrar " + typeLabel;
    }
    main.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "slot-actions";
    if (custodio && esCompleto) {
      const seguir = document.createElement("button");
      seguir.type = "button";
      seguir.className = "slot-btn slot-btn--seguir";
      seguir.textContent = "Seguir";
      seguir.addEventListener("click", () => seguirCustodio(row, custodio));
      actions.appendChild(seguir);
    } else {
      const completar = document.createElement("button");
      completar.type = "button";
      completar.className = "slot-btn slot-btn--completar";
      completar.textContent = "Completar";
      completar.addEventListener("click", () =>
        abrirEdicion(row, custodio?.id, typeKey)
      );
      actions.appendChild(completar);
    }

    slot.appendChild(main);
    slot.appendChild(actions);
    return slot;
  }
  // === END HU:HU-MARCADORES-CUSTODIA ===

  function abrirEdicion(row, focusId, typeKey) {
    state.currentRow = row;
    let incompletos = row.custodios.filter(
      (custodio) => !esCustodioCompleto(custodio)
    );
    if (typeKey && !focusId) {
      const target = incompletos.find(
        (custodio) => normalizeTipoCustodia(custodio.tipo_custodia) === typeKey
      );
      if (target) focusId = target.id;
    }
    if (!incompletos.length) {
      showMessage("No hay custodios pendientes para este servicio.");
      return;
    }

    if (ui.incompletosList) {
      ui.incompletosList.innerHTML = "";
      incompletos.forEach((custodio, index) => {
        const btn = document.createElement("button");
        const isActive = focusId
          ? custodio.id === focusId
          : index === 0;
        btn.type = "button";
        btn.className = "incom-item" + (isActive ? " active" : "");
        btn.dataset.id = String(custodio.id);
        const nombre = (custodio.nombre_custodio || "").trim() || "Sin nombre";
        const tipo = (custodio.tipo_custodia || "").trim() || "Sin tipo";
        btn.textContent = nombre + " - " + tipo;
        btn.addEventListener("click", () =>
          seleccionarCustodio(custodio.id, btn)
        );
        ui.incompletosList.appendChild(btn);
      });
      const activeBtn =
        ui.incompletosList.querySelector(".incom-item.active") ||
        ui.incompletosList.firstElementChild;
      if (activeBtn) {
        seleccionarCustodio(
          activeBtn.dataset.id,
          activeBtn
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
    const custodio = state.currentRow?.custodios.find(
      (c) => String(c.id) === String(id)
    );
    if (!custodio) return;
    state.selectedCustodioId = custodio.id;

    if (ui.custodioId) ui.custodioId.value = String(custodio.id);
    if (ui.nombreCustodio) {
      ui.nombreCustodio.value = custodio.nombre_custodio || "";
      syncTextfield(ui.nombreCustodio);
    }
    if (ui.tipoCustodio) {
      ui.tipoCustodio.value = custodio.tipo_custodia || "";
      syncTextfield(ui.tipoCustodio);
    }

    resetCamera();
    updateGuardarButton();
  }

  function syncTextfield(inputEl) {
    if (!inputEl) return;
    const wrapper = inputEl.closest(".mdl-textfield");
    if (!wrapper) return;
    if (inputEl.value && String(inputEl.value).trim()) {
      wrapper.classList.add("is-dirty");
    } else {
      wrapper.classList.remove("is-dirty");
    }
    if (
      window.componentHandler &&
      wrapper.classList.contains("mdl-js-textfield")
    ) {
      try {
        componentHandler.upgradeElement(wrapper);
      } catch (_) {}
    }
  }

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
    resetCamera();
    if (ui.form) ui.form.reset();
    if (ui.tipoCustodio) syncTextfield(ui.tipoCustodio);
    if (ui.nombreCustodio) syncTextfield(ui.nombreCustodio);
    if (ui.custodioId) ui.custodioId.value = "";
    state.selfieDataUrl = null;
    updateGuardarButton();
  }

  async function onSubmitForm(event) {
    event.preventDefault();
    const custodioId = (ui.custodioId?.value || "").trim();
    const nombre = (ui.nombreCustodio?.value || "").trim();
    const tipo = (ui.tipoCustodio?.value || "").trim();
    if (!custodioId) return showMessage("Seleccione un custodio");
    if (countNombreTokens(nombre) < 2) {
      showMessage("Ingresa al menos nombre y apellido");
      return;
    }
    if (!tipo) return showMessage("Seleccione el tipo de custodia");
    if (!state.selfieDataUrl) {
      showMessage("Captura la selfie para continuar");
      return;
    }

    try {
      const updatePayload = { nombre_custodio: nombre, tipo_custodia: tipo };
      const { error: updateError } = await window.sb
        .from("servicio_custodio")
        .update(updatePayload)
        .eq("id", custodioId);
      if (updateError) throw updateError;

      if (state.selfieDataUrl) {
        const base64 = state.selfieDataUrl.split(",")[1];
        const { error: selfieError } = await window.sb.rpc("guardar_selfie", {
          p_servicio_custodio_id: Number(custodioId),
          p_mime_type: "image/jpeg",
          p_base64: base64,
        });
        if (selfieError) throw selfieError;
      }

      showMessage("Cambios guardados");
      closeDrawer();
      await cargarServicios();
      render();
    } catch (err) {
      console.error("[custodia-registros] guardar custodio", err);
      showMessage("No se pudo guardar la informacion");
    }
  }

  function openSelfieModal() {
    if (!ui.selfieModal) return;
    ui.selfieModal.classList.add("show");
    ui.selfieModal.setAttribute("aria-hidden", "false");
    state.selfieModalOpen = true;
    updateSelfieModalStatus("Inicia la camara para capturar tu selfie.");
    updateSelfieModalButtons({
      start: false,
      capture: true,
      retry: true,
      accept: true,
    });
    resetSelfieCanvas();
  }

  function closeSelfieModal() {
    if (!ui.selfieModal) return;
    ui.selfieModal.classList.remove("show");
    ui.selfieModal.setAttribute("aria-hidden", "true");
    state.selfieModalOpen = false;
    stopSelfieStream();
    resetSelfieCanvas();
    updateSelfieModalButtons({
      start: false,
      capture: true,
      retry: true,
      accept: true,
    });
    updateSelfieModalStatus("Inicia la camara para capturar tu selfie.");
  }

  function updateSelfieModalStatus(message) {
    if (ui.selfieModalStatus) ui.selfieModalStatus.textContent = message;
  }

  function updateSelfieModalButtons(states) {
    if (ui.selfieModalStart)
      ui.selfieModalStart.disabled = Boolean(states.start);
    if (ui.selfieModalCapture)
      ui.selfieModalCapture.disabled = Boolean(states.capture);
    if (ui.selfieModalRetry)
      ui.selfieModalRetry.disabled = Boolean(states.retry);
    if (ui.selfieModalAccept)
      ui.selfieModalAccept.disabled = Boolean(states.accept);
  }

  async function startSelfieStream() {
    if (!navigator.mediaDevices?.getUserMedia) {
      showMessage("Camara no soportada en este dispositivo");
      return;
    }
    updateSelfieModalButtons({
      start: true,
      capture: true,
      retry: true,
      accept: true,
    });
    updateSelfieModalStatus("Solicitando permisos de camara...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      state.selfieModalStream = stream;
      if (ui.selfieModalVideo) {
        ui.selfieModalVideo.srcObject = stream;
        ui.selfieModalVideo.style.display = "block";
      }
      if (ui.selfieModalCanvas) {
        ui.selfieModalCanvas
          .getContext("2d")
          ?.clearRect(
            0,
            0,
            ui.selfieModalCanvas.width || 0,
            ui.selfieModalCanvas.height || 0
          );
        ui.selfieModalCanvas.style.display = "none";
      }
      updateSelfieModalButtons({
        start: true,
        capture: false,
        retry: true,
        accept: true,
      });
      updateSelfieModalStatus("Camara lista. Captura la selfie cuando estes listo.");
    } catch (err) {
      console.warn("[custodia-registros] camara error", err);
      showMessage("No se pudo acceder a la camara");
      updateSelfieModalButtons({
        start: false,
        capture: true,
        retry: true,
        accept: true,
      });
      updateSelfieModalStatus("No se pudo iniciar la camara.");
    }
  }

  function captureSelfieFromModal() {
    if (!state.selfieModalStream || !ui.selfieModalVideo || !ui.selfieModalCanvas) {
      showMessage("Inicia la camara primero");
      return;
    }
    const video = ui.selfieModalVideo;
    const canvas = ui.selfieModalCanvas;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, w, h);
    canvas.style.display = "block";
    video.style.display = "none";
    updateSelfieModalButtons({
      start: true,
      capture: true,
      retry: false,
      accept: false,
    });
    updateSelfieModalStatus("Revisa la selfie antes de confirmarla.");
  }

  function restartSelfieCapture() {
    if (!ui.selfieModalVideo || !ui.selfieModalCanvas) return;
    ui.selfieModalVideo.style.display = "block";
    ui.selfieModalCanvas.style.display = "none";
    updateSelfieModalButtons({
      start: true,
      capture: false,
      retry: true,
      accept: true,
    });
    updateSelfieModalStatus("Camara lista para una nueva captura.");
  }

  function acceptSelfieFromModal() {
    if (!ui.selfieModalCanvas || !ui.selfieModalCanvas.width) {
      showMessage("Captura una selfie antes de confirmarla.");
      return;
    }
    const dataUrl = ui.selfieModalCanvas.toDataURL("image/jpeg", 0.9);
    state.selfieDataUrl = dataUrl;
    updateSelfiePreview(dataUrl);
    closeSelfieModal();
    updateGuardarButton();
  }

  function resetSelfieCanvas() {
    if (ui.selfieModalCanvas) {
      ui.selfieModalCanvas
        .getContext("2d")
        ?.clearRect(
          0,
          0,
          ui.selfieModalCanvas.width || 0,
          ui.selfieModalCanvas.height || 0
        );
      ui.selfieModalCanvas.style.display = "none";
    }
    if (ui.selfieModalVideo) {
      ui.selfieModalVideo.srcObject = null;
      ui.selfieModalVideo.style.display = "none";
    }
  }

  function stopSelfieStream() {
    try {
      state.selfieModalStream
        ?.getTracks()
        ?.forEach((track) => track.stop());
    } catch (err) {
      console.warn("[custodia-registros] detener camara", err);
    }
    state.selfieModalStream = null;
  }

  function resetCamera() {
    if (state.selfieModalOpen) {
      closeSelfieModal();
    }
    stopSelfieStream();
    state.selfieDataUrl = null;
    updateSelfiePreview(null);
    updateGuardarButton();
  }

  function seguirCustodio(row, custodio) {
    if (!custodio?.id) {
      showMessage("No se pudo identificar la custodia seleccionada.");
      return;
    }
    try {
      const payload = {
        servicio_id: row.svc.id,
        servicio_custodio_id: custodio.id,
        nombre_custodio: custodio.nombre_custodio || "",
        tipo_custodia: custodio.tipo_custodia || "",
      };
      window.CustodiaSession?.save(payload, {
        ttlMs: 4 * 60 * 60 * 1000,
      });
      sessionStorage.setItem("servicio_id_actual", row.svc.id);
      console.log("[session] seguir", {
        servicio_id: row.svc.id,
        servicio_custodio_id: custodio.id,
      });
      showMessage("Sesion vinculada. Abriendo mapa de seguimiento...");
      setTimeout(() => {
        location.href = "/html/dashboard/mapa-resguardo.html";
      }, 120);
    } catch (err) {
      console.warn("[session] seguir error", err);
      showMessage("No se pudo guardar la sesion local");
    }
  }

  function updateSelfiePreview(dataUrl) {
    if (!ui.selfiePreviewWrapper) return;
    if (dataUrl) {
      if (ui.selfiePreview) {
        ui.selfiePreview.src = dataUrl;
        ui.selfiePreview.style.display = "block";
      }
      if (ui.selfieEmptyLabel) ui.selfieEmptyLabel.style.display = "none";
      if (ui.btnOpenSelfie) ui.btnOpenSelfie.textContent = "Cambiar foto";
    } else {
      if (ui.selfiePreview) ui.selfiePreview.style.display = "none";
      if (ui.selfieEmptyLabel) ui.selfieEmptyLabel.style.display = "inline-flex";
      if (ui.btnOpenSelfie) ui.btnOpenSelfie.textContent = "Tomar foto";
    }
  }

  function updateGuardarButton() {
    const custodioId = (ui.custodioId?.value || "").trim();
    const nombre = (ui.nombreCustodio?.value || "").trim();
    const tipo = (ui.tipoCustodio?.value || "").trim();
    const nombreOk = countNombreTokens(nombre) >= 2;
    const ready =
      Boolean(custodioId) && nombreOk && Boolean(tipo) && Boolean(state.selfieDataUrl);
    if (ui.btnGuardar) ui.btnGuardar.disabled = !ready;
  }

  function esCustodioCompleto(custodio) {
    const nombreOk = countNombreTokens(custodio.nombre_custodio || "") >= 2;
    const tipoOk = Boolean((custodio.tipo_custodia || "").trim());
    const selfieOk =
      Array.isArray(custodio.selfie) && custodio.selfie.length > 0;
    return nombreOk && tipoOk && selfieOk;
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

  async function requestEssentialPermissions() {
    if (state.permissionsRequested) return;
    state.permissionsRequested = true;
    const results = { location: false, audio: false, camera: false };
    if (navigator.geolocation) {
      results.location = await new Promise((resolve) => {
        try {
          navigator.geolocation.getCurrentPosition(
            () => resolve(true),
            (err) => {
              console.warn("[session] geolocalizacion rechazada", err);
              resolve(false);
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 }
          );
        } catch (err) {
          console.warn("[session] geolocalizacion error", err);
          resolve(false);
        }
      });
    }
    if (window.Alarma?.enableAlerts) {
      try {
        const perms = await window.Alarma.enableAlerts({
          sound: true,
          haptics: true,
        });
        results.audio = Boolean(perms?.sound);
      } catch (err) {
        console.warn("[audio] enableAlerts fallo", err);
      }
    } else if (window.Alarma?.getPermissions) {
      try {
        results.audio = Boolean(window.Alarma.getPermissions().sound);
      } catch (_) {}
    }
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        stream.getTracks().forEach((track) => track.stop());
        results.camera = true;
      } catch (err) {
        console.warn("[session] camara fallo", err);
      }
    }
    console.log("[session] permisos solicitados", results);
    if (!results.location || !results.audio || !results.camera) {
      showMessage(
        "Activa permisos de ubicacion, sonido y camara para evitar bloqueos."
      );
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
