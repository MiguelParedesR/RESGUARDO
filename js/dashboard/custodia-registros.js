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
    hasUltimoPingView: null,
    realtimeChannel: null,
    reloadTimer: null,
    isLoading: false,
  };

  const ui = {};

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

    ui.camStartBtn = document.querySelector('.cam-action[data-action="start"]');
    ui.camCaptureBtn = document.querySelector(
      '.cam-action[data-action="capture"]'
    );
    ui.camRetryBtn = document.querySelector('.cam-action[data-action="retry"]');
    ui.camVideo = document.getElementById("cam-video");
    ui.camCanvas = document.getElementById("cam-canvas");
    ui.selfiePreview = document.getElementById("selfie-preview");
    ui.camEstado = document.getElementById("cam-estado");
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

    if (ui.camStartBtn) {
      ui.camStartBtn.addEventListener("click", startCamera);
    }
    if (ui.camCaptureBtn) {
      ui.camCaptureBtn.addEventListener("click", captureSelfie);
    }
    if (ui.camRetryBtn) {
      ui.camRetryBtn.addEventListener("click", resetCamera);
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
      .order("created_at", { ascending: false });
    if (error) throw error;
    const base = Array.isArray(data) ? data : [];

    const detalles = [];

    for (const svc of base) {
      const normal = normalizarServicio(svc);
      const detalle = await cargarDetalleServicio(normal.id);
      detalles.push({
        svc: normal,
        custodios: detalle.custodios,
        totalCustodios: detalle.custodios.length,
        custodiosCompletos: detalle.custodios.filter(esCustodioCompleto).length,
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
    title.textContent = [
      row.svc.placaUpper || "SIN PLACA",
      row.svc.clienteNombre,
      row.svc.tipo,
    ].join(" - ");
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
        const li = document.createElement("li");
        const nombre = (custodio.nombre_custodio || "").trim() || "Sin nombre";
        const tipo = (custodio.tipo_custodia || "").trim() || "Sin tipo";
        li.textContent =
          nombre +
          " (" +
          tipo +
          ")" +
          (esCustodioCompleto(custodio) ? "" : " - incompleto");
        lista.appendChild(li);
      });
    } else {
      const li = document.createElement("li");
      li.textContent = "Sin custodios asignados";
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

  function abrirEdicion(row) {
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
        seleccionarCustodio(
          incompletos[0].id,
          ui.incompletosList.firstElementChild
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

    resetCamera();
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
  }

  async function onSubmitForm(event) {
    event.preventDefault();
    const custodioId = (ui.custodioId?.value || "").trim();
    const nombre = (ui.nombreCustodio?.value || "").trim();
    const tipo = (ui.tipoCustodio?.value || "").trim();
    if (!custodioId) return showMessage("Seleccione un custodio");
    if (!nombre) return showMessage("Ingrese un nombre");
    if (!tipo) return showMessage("Seleccione el tipo de custodia");

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

  function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      showMessage("Camara no soportada en este dispositivo");
      return;
    }
    if (ui.camStartBtn) ui.camStartBtn.disabled = true;
    if (ui.camEstado) ui.camEstado.textContent = "Solicitando permisos...";

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((stream) => {
        state.mediaStream = stream;
        if (ui.camVideo) {
          ui.camVideo.srcObject = stream;
          ui.camVideo.style.display = "block";
        }
        if (ui.selfiePreview) ui.selfiePreview.style.display = "none";
        if (ui.camCaptureBtn) ui.camCaptureBtn.disabled = false;
        if (ui.camRetryBtn) ui.camRetryBtn.disabled = true;
        if (ui.camEstado) ui.camEstado.textContent = "Camara lista";
      })
      .catch((err) => {
        console.error("[custodia-registros] camara error", err);
        if (ui.camEstado)
          ui.camEstado.textContent = "No se pudo acceder a la camara";
        if (ui.camStartBtn) ui.camStartBtn.disabled = false;
      });
  }

  function captureSelfie() {
    if (!state.mediaStream || !ui.camVideo || !ui.camCanvas) {
      showMessage("Inicie la camara antes de capturar");
      return;
    }
    const width = ui.camVideo.videoWidth || 640;
    const height = ui.camVideo.videoHeight || 480;
    ui.camCanvas.width = width;
    ui.camCanvas.height = height;
    const context = ui.camCanvas.getContext("2d");
    context.drawImage(ui.camVideo, 0, 0, width, height);
    state.selfieDataUrl = ui.camCanvas.toDataURL("image/jpeg", 0.85);
    if (ui.selfiePreview) {
      ui.selfiePreview.src = state.selfieDataUrl;
      ui.selfiePreview.style.display = "block";
    }
    if (ui.camVideo) ui.camVideo.style.display = "none";
    if (ui.camCaptureBtn) ui.camCaptureBtn.disabled = true;
    if (ui.camRetryBtn) ui.camRetryBtn.disabled = false;
    if (ui.camEstado) ui.camEstado.textContent = "Selfie capturada";
  }

  function resetCamera() {
    try {
      if (state.mediaStream) {
        state.mediaStream.getTracks().forEach((track) => track.stop());
      }
    } catch (_) {}
    state.mediaStream = null;
    state.selfieDataUrl = null;
    if (ui.camVideo) {
      ui.camVideo.srcObject = null;
      ui.camVideo.style.display = "none";
    }
    if (ui.selfiePreview) ui.selfiePreview.style.display = "none";
    if (ui.camCaptureBtn) ui.camCaptureBtn.disabled = true;
    if (ui.camRetryBtn) ui.camRetryBtn.disabled = true;
    if (ui.camStartBtn) ui.camStartBtn.disabled = false;
    if (ui.camEstado) ui.camEstado.textContent = "Camara inactiva";
  }

  function esCustodioCompleto(custodio) {
    const nombreOk = Boolean((custodio.nombre_custodio || "").trim());
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
