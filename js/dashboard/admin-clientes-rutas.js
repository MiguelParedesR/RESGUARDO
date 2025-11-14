// === BEGIN HU:HU-ADMIN-RUTAS-CRUD (NO TOCAR FUERA) ===
(function () {
  "use strict";

  const state = {
    clientes: [],
    clienteSeleccionado: null,
    rutas: [],
    puntos: [],
    map: null,
    polyline: null,
    editingRutaId: null,
    loadingClientes: false,
  };

  const ui = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    if (!window.sb) {
      alert("Supabase no inicializado");
      return;
    }
    mapUI();
    bindEvents();
    setupMap();
    loadClientes().catch((err) => {
      console.error("[rutas] load clientes error", err);
      showMsg("No se pudieron cargar los clientes.");
    });
  }

  function mapUI() {
    ui.buscarClientes = document.getElementById("buscar-clientes");
    ui.clientesLista = document.getElementById("clientes-lista");
    ui.clientesEmpty = document.getElementById("clientes-empty");
    ui.btnNuevoCliente = document.getElementById("btn-nuevo-cliente");
    ui.modalCliente = document.getElementById("modal-cliente");
    ui.clienteNombre = document.getElementById("cliente-nombre");
    ui.btnClienteGuardar = document.getElementById("btn-cliente-guardar");
    ui.clienteTitulo = document.getElementById("cliente-actual-titulo");
    ui.rutaNombre = document.getElementById("ruta-nombre");
    ui.rutaDescripcion = document.getElementById("ruta-descripcion");
    ui.rutaTolerancia = document.getElementById("ruta-tolerancia");
    ui.btnLimpiarRuta = document.getElementById("btn-limpiar-ruta");
    ui.btnGuardarRuta = document.getElementById("btn-guardar-ruta");
    ui.btnGenerarRuta = document.getElementById("btn-generar-ruta");
    ui.tablaRutas = document.getElementById("tabla-rutas");
    ui.modalConfirm = document.getElementById("modal-confirm");
    ui.modalConfirmTitle = document.getElementById("modal-confirm-title");
    ui.modalConfirmMessage = document.getElementById("modal-confirm-message");
    ui.btnConfirmAceptar = document.getElementById("btn-confirm-aceptar");
    ui.snackbar = document.getElementById("app-snackbar");
    ui.modalIA = document.getElementById("modal-ia");
    ui.iaPrompt = document.getElementById("ia-prompt");
    ui.iaStatus = document.getElementById("ia-status");
    ui.iaResult = document.getElementById("ia-result");
    ui.btnIaRun = document.getElementById("btn-ia-run");
  }

  function bindEvents() {
    ui.btnNuevoCliente?.addEventListener("click", () => {
      ui.clienteNombre.value = "";
      ui.modalCliente?.showModal();
      ui.clienteNombre?.focus();
    });
    ui.modalCliente?.querySelectorAll("[data-close]").forEach((btn) =>
      btn.addEventListener("click", () => ui.modalCliente.close())
    );
    ui.modalCliente?.addEventListener("submit", handleNuevoCliente);
    ui.modalConfirm
      ?.querySelectorAll("[data-close]")
      .forEach((btn) =>
        btn.addEventListener("click", () => ui.modalConfirm.close())
      );
    ui.modalConfirm?.addEventListener("submit", handleConfirmAction);
    ui.modalIA
      ?.querySelectorAll("[data-close]")
      .forEach((btn) =>
        btn.addEventListener("click", () => ui.modalIA.close())
      );
    ui.modalIA?.addEventListener("close", () => setIaLoading(false));

    ui.buscarClientes?.addEventListener(
      "input",
      debounce((evt) => loadClientes(evt.target.value.trim()), 300)
    );

    ui.btnLimpiarRuta?.addEventListener("click", clearRuta);
    ui.btnGuardarRuta?.addEventListener("click", handleGuardarRuta);
    ui.btnGenerarRuta?.addEventListener("click", openIaModal);
    ui.btnIaRun?.addEventListener("click", handleIaGenerate);
  }

  function setupMap() {
    const mapEl = document.getElementById("map-rutas");
    if (!mapEl) return;
    state.map = L.map(mapEl, {
      zoomControl: true,
      attributionControl: false,
    }).setView([-12.0464, -77.0428], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      tileSize: 256,
    }).addTo(state.map);
    state.polyline = L.polyline([], {
      color: "#3f51b5",
      weight: 4,
    }).addTo(state.map);
    state.map.on("click", (evt) => {
      state.puntos.push({ lat: evt.latlng.lat, lng: evt.latlng.lng });
      refreshPolyline();
      enableSave();
    });
  }

  async function loadClientes(term = "") {
    if (state.loadingClientes) return;
    state.loadingClientes = true;
    try {
      let query = window.sb
        .from("cliente")
        .select("id,nombre,created_at")
        .order("nombre");
      if (term) {
        query = query.ilike("nombre", `${term}%`);
      } else {
        query = query.limit(50);
      }
      const { data, error } = await query;
      if (error) throw error;
      state.clientes = data || [];
      renderClientes();
    } catch (err) {
      console.error("[rutas] loadClientes", err);
      showMsg("Error cargando clientes.");
    } finally {
      state.loadingClientes = false;
    }
  }

  function renderClientes() {
    if (!ui.clientesLista) return;
    ui.clientesLista.innerHTML = "";
    if (!state.clientes.length) {
      ui.clientesEmpty.hidden = false;
      return;
    }
    ui.clientesEmpty.hidden = true;
    state.clientes.forEach((cliente) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "cliente-item";
      if (state.clienteSeleccionado?.id === cliente.id) {
        item.classList.add("is-active");
      }
      const display = (cliente.nombre || "").toUpperCase();
      const avatar = display.charAt(0) || "?";
      item.innerHTML = `
        <span class="cliente-item__avatar">${avatar}</span>
        <span class="cliente-item__name">${display}</span>
      `;
      item.addEventListener("click", () => selectCliente(cliente));
      ui.clientesLista.appendChild(item);
    });
  }

  function selectCliente(cliente) {
    state.clienteSeleccionado = cliente;
    state.editingRutaId = null;
    ui.clienteTitulo.textContent = `Cliente: ${cliente.nombre}`;
    clearRuta();
    ui.btnGuardarRuta.disabled = false;
    loadRutasCliente(cliente.id);
    renderClientes();
  }

  async function loadRutasCliente(clienteId) {
    try {
      const { data, error } = await window.sb
        .from("ruta_cliente")
        .select("id,nombre,descripcion,tolerancia_metros,is_active,created_at,geojson")
        .eq("cliente_id", clienteId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      state.rutas = data || [];
      renderTablaRutas();
    } catch (err) {
      console.error("[rutas] load rutas", err);
      showMsg("No se pudieron cargar las rutas.");
    }
  }

  function renderTablaRutas() {
    if (!ui.tablaRutas) return;
    ui.tablaRutas.innerHTML = "";
    if (!state.rutas.length) {
      const row = document.createElement("tr");
      row.innerHTML = `<td colspan="5" class="tabla-empty">No hay rutas registradas.</td>`;
      ui.tablaRutas.appendChild(row);
      return;
    }
    state.rutas.forEach((ruta) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${ruta.nombre}</td>
        <td>${ruta.tolerancia_metros} m</td>
        <td><span class="badge ${ruta.is_active ? "badge--active" : "badge--inactive"}">${
        ruta.is_active ? "Activa" : "Inactiva"
      }</span></td>
        <td>${formatDate(ruta.created_at)}</td>
        <td>
          <div class="tabla-actions">
            <button data-action="ver" title="Ver en mapa"><i class="material-icons">map</i></button>
            <button data-action="editar" title="Editar"><i class="material-icons">edit</i></button>
            <button data-action="eliminar" title="Eliminar"><i class="material-icons">delete</i></button>
          </div>
        </td>
      `;
      const buttons = row.querySelectorAll("button");
      buttons.forEach((btn) => {
        const action = btn.getAttribute("data-action");
        if (action === "ver") btn.addEventListener("click", () => mostrarRutaEnMapa(ruta));
        if (action === "editar") btn.addEventListener("click", () => cargarRutaEnFormulario(ruta));
        if (action === "eliminar") btn.addEventListener("click", () => confirmarEliminarRuta(ruta));
      });
      ui.tablaRutas.appendChild(row);
    });
  }

  function mostrarRutaEnMapa(ruta) {
    if (!state.map || !ruta?.geojson) return;
    try {
      const parsed = typeof ruta.geojson === "string" ? JSON.parse(ruta.geojson) : ruta.geojson;
      const coords = parsed?.coordinates || [];
      if (!coords.length) return;
      state.puntos = coords.map(([lng, lat]) => ({ lat, lng }));
      refreshPolyline(true);
    } catch (err) {
      console.warn("[rutas] mostrarRutaEnMapa error", err);
    }
  }

  function cargarRutaEnFormulario(ruta) {
    state.editingRutaId = ruta.id;
    ui.rutaNombre.value = ruta.nombre || "";
    ui.rutaDescripcion.value = ruta.descripcion || "";
    ui.rutaTolerancia.value = ruta.tolerancia_metros || 120;
    mostrarRutaEnMapa(ruta);
    enableSave();
  }

  function clearRuta() {
    state.puntos = [];
    state.editingRutaId = null;
    ui.rutaNombre.value = "";
    ui.rutaDescripcion.value = "";
    ui.rutaTolerancia.value = 120;
    refreshPolyline();
    enableSave(false);
  }

  function refreshPolyline(fitBounds = false) {
    if (!state.polyline) return;
    const latlngs = state.puntos.map((pt) => [pt.lat, pt.lng]);
    state.polyline.setLatLngs(latlngs);
    if (fitBounds && latlngs.length >= 2) {
      state.map.fitBounds(latlngs, { padding: [20, 20] });
    }
  }

  function enableSave(enable = true) {
    if (!ui.btnGuardarRuta) return;
    if (state.clienteSeleccionado && (enable || state.puntos.length >= 2)) {
      ui.btnGuardarRuta.disabled = false;
    } else {
      ui.btnGuardarRuta.disabled = true;
    }
  }

  async function handleNuevoCliente(evt) {
    evt.preventDefault();
    const nombre = ui.clienteNombre.value.trim();
    if (!nombre) return;
    try {
      ui.btnClienteGuardar.disabled = true;
      const { data, error } = await window.sb
        .from("cliente")
        .insert({ nombre })
        .select("id,nombre,created_at")
        .single();
      if (error) throw error;
      showMsg("Cliente creado.");
      ui.modalCliente.close();
      state.clientes.unshift(data);
      selectCliente(data);
      renderClientes();
    } catch (err) {
      console.error("[rutas] nuevo cliente", err);
      showMsg(err?.message || "No se pudo crear el cliente.");
    } finally {
      ui.btnClienteGuardar.disabled = false;
    }
  }

  async function handleGuardarRuta() {
    if (!state.clienteSeleccionado) {
      showMsg("Selecciona un cliente.");
      return;
    }
    if (state.puntos.length < 2) {
      showMsg("Dibuja al menos dos puntos en la ruta.");
      return;
    }
    const payload = buildRutaPayload();
    if (!payload) return;
    try {
      ui.btnGuardarRuta.disabled = true;
      let response;
      if (state.editingRutaId) {
        response = await window.sb
          .from("ruta_cliente")
          .update(payload)
          .eq("id", state.editingRutaId)
          .select("id");
      } else {
        response = await window.sb
          .from("ruta_cliente")
          .insert({ ...payload, cliente_id: state.clienteSeleccionado.id })
          .select("id")
          .single();
      }
      if (response.error) throw response.error;
      if (response.data?.id) {
        await window.sb
          .from("ruta_cliente")
          .update({ is_active: false })
          .eq("cliente_id", state.clienteSeleccionado.id)
          .neq("id", response.data.id);
        await window.sb
          .from("ruta_cliente")
          .update({ is_active: true })
          .eq("id", response.data.id);
      }
      showMsg("Ruta guardada.");
      clearRuta();
      await loadRutasCliente(state.clienteSeleccionado.id);
    } catch (err) {
      console.error("[rutas] guardar ruta", err);
      showMsg(err?.message || "No se pudo guardar la ruta.");
    } finally {
      ui.btnGuardarRuta.disabled = false;
    }
  }

  function buildRutaPayload() {
    const nombre = ui.rutaNombre.value.trim();
    const tolerancia = Number(ui.rutaTolerancia.value) || 120;
    if (!nombre) {
      showMsg("La ruta necesita un nombre.");
      return null;
    }
    const geojson = {
      type: "LineString",
      coordinates: state.puntos.map((pt) => [pt.lng, pt.lat]),
    };
    return {
      nombre,
      descripcion: ui.rutaDescripcion.value.trim() || null,
      tolerancia_metros: tolerancia,
      geojson,
      is_active: true,
    };
  }

  function confirmarEliminarRuta(ruta) {
    ui.modalConfirmTitle.textContent = "Eliminar ruta";
    ui.modalConfirmMessage.textContent = `Â¿Eliminar la ruta "${ruta.nombre}"?`;
    ui.modalConfirm.dataset.routeId = ruta.id;
    ui.modalConfirm.showModal();
  }

  async function handleConfirmAction(evt) {
    evt.preventDefault();
    const routeId = ui.modalConfirm.dataset.routeId;
    if (!routeId) {
      ui.modalConfirm.close();
      return;
    }
    try {
      const { error } = await window.sb
        .from("ruta_cliente")
        .delete()
        .eq("id", routeId);
      if (error) throw error;
      showMsg("Ruta eliminada.");
      await loadRutasCliente(state.clienteSeleccionado.id);
    } catch (err) {
      console.error("[rutas] eliminar", err);
      showMsg("No se pudo eliminar la ruta.");
    } finally {
      ui.modalConfirm.removeAttribute("data-route-id");
      ui.modalConfirm.close();
    }
  }

  function openIaModal() {
    if (!state.clienteSeleccionado) {
      showMsg("Selecciona un cliente antes de usar la IA.");
      return;
    }
    if (ui.iaPrompt) {
      ui.iaPrompt.value =
        ui.iaPrompt.value.trim() ||
        `Necesito ideas para nombrar y describir una ruta segura para ${state.clienteSeleccionado.nombre}.`;
    }
    if (ui.iaResult) {
      ui.iaResult.hidden = true;
      ui.iaResult.textContent = "";
    }
    if (ui.iaStatus) ui.iaStatus.textContent = "";
    ui.modalIA?.showModal();
    ui.iaPrompt?.focus();
  }

  async function handleIaGenerate() {
    if (!state.clienteSeleccionado) {
      showMsg("Selecciona un cliente antes de usar la IA.");
      return;
    }
    if (!ui.iaPrompt) return;
    const prompt = ui.iaPrompt.value.trim();
    if (!prompt) {
      ui.iaStatus.textContent = "Describe qué necesitas generar.";
      return;
    }
    setIaLoading(true, "Generando sugerencia...");
    try {
      const context = buildIaContext();
      const response = await fetch("/.netlify/functions/ruta-ai-helper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, context }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "No se pudo generar la ruta.");
      }
      const suggestion = (payload.suggestion || "").trim();
      if (suggestion) {
        if (ui.iaResult) {
          ui.iaResult.hidden = false;
          ui.iaResult.textContent = suggestion;
        }
        if (!ui.rutaDescripcion.value.trim()) {
          ui.rutaDescripcion.value = suggestion;
        }
        if (ui.iaStatus) {
          ui.iaStatus.textContent =
            "Listo. Ajusta el texto antes de guardar la ruta.";
        }
      } else if (ui.iaStatus) {
        ui.iaStatus.textContent =
          "La IA no devolvió respuesta. Intenta con más detalles.";
      }
    } catch (err) {
      console.error("[rutas][ia]", err);
      if (ui.iaStatus)
        ui.iaStatus.textContent =
          err.message || "Error al contactar al asistente.";
    } finally {
      setIaLoading(false);
    }
  }

  function setIaLoading(loading, message = "") {
    if (ui.btnIaRun) ui.btnIaRun.disabled = loading;
    if (message && ui.iaStatus) ui.iaStatus.textContent = message;
  }

  function buildIaContext() {
    return {
      cliente: state.clienteSeleccionado?.nombre || "",
      tolerancia: ui.rutaTolerancia.value || "120",
      rutaNombre: ui.rutaNombre.value || "",
      descripcionActual: ui.rutaDescripcion.value || "",
      puntos: state.puntos,
    };
  }

  function formatDate(value) {
    if (!value) return "--";
    try {
      return new Intl.DateTimeFormat("es-PE", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value));
    } catch {
      return value;
    }
  }

  function debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function showMsg(message) {
    if (ui.snackbar?.MaterialSnackbar) {
      ui.snackbar.MaterialSnackbar.showSnackbar({ message });
      return;
    }
    alert(message);
  }
})();
// === END HU:HU-ADMIN-RUTAS-CRUD ===



