// === BEGIN HU:HU-CUSTODIA-REGISTROS-FLUJO (NO TOCAR FUERA) ===
(function () {
  "use strict";

  const STORAGE_PROFILE_KEY = "custodia_profile";
  const LOG_API = "[api]";
  const LOG_SEGUIR = "[seguir]";
  const LOG_ADD = "[add-custodia]";
  const LOG_PROFILE = "[profile]";
  const TIPO_CUSTODIA_META = {
    S: {
      code: "S",
      label: "Simple",
      description: "1 custodia en la cabina de la unidad que resguarda.",
    },
    A: {
      code: "A",
      label: "Tipo A",
      description: "1 custodia con vehículo detrás de la unidad que resguarda.",
    },
    B: {
      code: "B",
      label: "Tipo B",
      description: "Combinación de una custodia simple y una tipo A.",
    },
  };

  // === BEGIN HU:HU-CUSTODIA-CLIENTE-SEARCH+RUTA ===
  const CLIENTE_SEARCH_DEBOUNCE = 320;
  // === END HU:HU-CUSTODIA-CLIENTE-SEARCH+RUTA ===

  const state = {
    profile: null,
    empresa: "",
    // === BEGIN HU:HU-CUSTODIA-CLIENTE-SEARCH+RUTA ===
    clienteQuery: "",
    clienteResults: [],
    isSearchingClientes: false,
    selectedClienteName: "",
    routeCache: new Map(),
    // === END HU:HU-CUSTODIA-CLIENTE-SEARCH+RUTA ===
    selectedCliente: "",
    servicios: [],
    isLoading: false,
    pendingAdd: null,
    snackbar: null,
    profileSynced: false,
  };

  const ui = {};
  // === BEGIN HU:HU-CUSTODIA-CLIENTE-SEARCH+RUTA ===
  let clienteSearchTimer = null;
  // === END HU:HU-CUSTODIA-CLIENTE-SEARCH+RUTA ===

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    if (!window.sb) {
      alert("Supabase no inicializado");
      return;
    }
    const profile = loadProfile();
    if (!profile) {
      redirectToLogin();
      return;
    }
    state.profile = profile;
    state.profileSynced = false;
    state.empresa = profile.empresa || profile.empresa_otro || "";
    mapUI();
    bindEvents();
    searchClientes("")
      .catch((err) => {
        console.error(`${LOG_API} clientes`, err);
        showMsg("No se pudieron cargar los clientes.");
      });
  }

  function mapUI() {
    ui.snackbar = document.getElementById("app-snackbar");
    ui.cards = document.getElementById("cards-custodia");
    ui.placeholder = document.getElementById("cards-placeholder");
    // === BEGIN HU:HU-CUSTODIA-CLIENTE-SEARCH+RUTA ===
    ui.clienteSearchInput = document.getElementById("cliente-search");
    ui.clienteSearchField = document.getElementById("cliente-search-field");
    ui.clienteResults = document.getElementById("cliente-results");
    ui.clienteFeedback = document.getElementById("cliente-feedback");
    ui.clienteAddBtn = document.getElementById("cliente-add-btn");
    ui.clienteClear = document.getElementById("cliente-clear");
    ui.routeModal = document.getElementById("modal-ruta-cliente");
    ui.routeModalName = document.getElementById("route-modal-name");
    ui.routeModalDesc = document.getElementById("route-modal-desc");
    ui.newClienteModal = document.getElementById("modal-cliente-nuevo");
    ui.newClienteInput = document.getElementById("cliente-nombre");
    ui.newClienteFeedback = document.getElementById("cliente-modal-feedback");
    ui.newClienteSave = document.getElementById("cliente-modal-save");
    if (ui.clienteResults) ui.clienteResults.hidden = true;
    updateClienteFeedback("Escribe para buscar clientes.");
    // === END HU:HU-CUSTODIA-CLIENTE-SEARCH+RUTA ===
    ui.modalAdd = document.getElementById("modal-add-custodia");
    ui.modalDescription = document.getElementById("add-modal-description");
    ui.modalConfirm = document.getElementById("add-modal-confirm");
  }

  function bindEvents() {
    // === BEGIN HU:HU-CUSTODIA-CLIENTE-SEARCH+RUTA ===
    ui.clienteSearchInput?.addEventListener("input", handleClienteSearchInput);
    ui.clienteSearchInput?.addEventListener("focus", () => {
      if (state.clienteResults.length) setClienteResultsVisible(true);
    });
    ui.clienteSearchInput?.addEventListener("keydown", handleClienteSearchKey);
    ui.clienteResults?.addEventListener("click", handleClienteResultClick);
    ui.clienteClear?.addEventListener("click", handleClienteClear);
    ui.clienteAddBtn?.addEventListener("click", openNewClienteModal);
    document.addEventListener("click", handleClienteSearchBlur, true);
    document.addEventListener("keydown", handleEscapeClose);
    document
      .querySelectorAll("[data-route-close]")
      .forEach((el) => el.addEventListener("click", closeRouteModal));
    document
      .querySelectorAll("[data-cliente-close]")
      .forEach((el) => el.addEventListener("click", closeNewClienteModal));
    ui.newClienteSave?.addEventListener("click", handleNewClienteSave);
    // === END HU:HU-CUSTODIA-CLIENTE-SEARCH+RUTA ===
    document
      .querySelectorAll("[data-add-close]")
      .forEach((el) => el.addEventListener("click", () => closeAddModal()));
    ui.modalConfirm?.addEventListener("click", () => handleAddConfirm());
  }

  function loadProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_PROFILE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.id) return null;
      if (parsed.exp_ts && parsed.exp_ts < Date.now()) {
        localStorage.removeItem(STORAGE_PROFILE_KEY);
        return null;
      }
      return parsed;
    } catch (err) {
      console.warn("perfil invalido", err);
      return null;
    }
  }

  // === BEGIN HU:HU-CUSTODIA-CLIENTE-SEARCH+RUTA ===
  function handleClienteSearchInput(evt) {
    const value = evt.target.value || "";
    state.clienteQuery = value;
    if (clienteSearchTimer) clearTimeout(clienteSearchTimer);
    clienteSearchTimer = setTimeout(() => {
      searchClientes(value).catch((err) => {
        console.error(`${LOG_API} clientes search`, err);
      });
    }, CLIENTE_SEARCH_DEBOUNCE);
  }

  function handleClienteSearchKey(evt) {
    if (evt.key !== "Enter") return;
    const first = state.clienteResults?.[0];
    if (first) {
      selectCliente(first);
      setClienteResultsVisible(false);
      evt.preventDefault();
    }
  }

  function handleClienteResultClick(evt) {
    const btn = evt.target.closest(".cliente-search__result-btn");
    if (!btn) return;
    const { clienteId, clienteNombre } = btn.dataset;
    selectCliente({
      id: clienteId,
      nombre: clienteNombre || btn.textContent.trim(),
    });
  }

  function handleClienteClear() {
    state.selectedCliente = "";
    state.selectedClienteName = "";
    state.clienteQuery = "";
    state.servicios = [];
    state.clienteResults = [];
    if (ui.clienteSearchInput) ui.clienteSearchInput.value = "";
    setClienteResultsVisible(false);
    toggleAddClienteButton(false);
    updateClienteFeedback("Escribe para buscar clientes.");
    render();
  }

  function handleClienteSearchBlur(evt) {
    if (
      ui.clienteSearchField?.contains(evt.target) ||
      ui.clienteResults?.contains(evt.target) ||
      ui.clienteAddBtn?.contains(evt.target)
    ) {
      return;
    }
    setClienteResultsVisible(false);
  }

  function handleEscapeClose(evt) {
    if (evt.key !== "Escape") return;
    const routeOpen = ui.routeModal?.getAttribute("aria-hidden") === "false";
    const clienteOpen =
      ui.newClienteModal?.getAttribute("aria-hidden") === "false";
    if (clienteOpen) {
      closeNewClienteModal();
      evt.stopPropagation();
      return;
    }
    if (routeOpen) {
      closeRouteModal();
      evt.stopPropagation();
    }
  }

  function setClienteResultsVisible(visible) {
    if (!ui.clienteResults || !ui.clienteSearchField) return;
    ui.clienteResults.hidden = !visible;
    ui.clienteSearchField.setAttribute(
      "aria-expanded",
      visible ? "true" : "false"
    );
  }

  function updateClienteFeedback(message) {
    if (!ui.clienteFeedback) return;
    ui.clienteFeedback.textContent = message || "";
  }

  function toggleAddClienteButton(visible, prefill = "") {
    if (!ui.clienteAddBtn) return;
    if (visible && prefill.trim().length >= 1) {
      ui.clienteAddBtn.hidden = false;
      ui.clienteAddBtn.dataset.prefill = prefill.trim();
    } else {
      ui.clienteAddBtn.hidden = true;
      delete ui.clienteAddBtn.dataset.prefill;
    }
  }

  function openNewClienteModal() {
    if (!ui.newClienteModal) return;
    const prefill =
      ui.clienteAddBtn?.dataset.prefill || state.clienteQuery || "";
    if (ui.newClienteInput) ui.newClienteInput.value = prefill.trim();
    setNewClienteFeedback("");
    ui.newClienteModal.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => ui.newClienteInput?.focus());
  }

  function closeNewClienteModal() {
    if (!ui.newClienteModal) return;
    ui.newClienteModal.setAttribute("aria-hidden", "true");
  }

  function setNewClienteFeedback(message, isError = false) {
    if (!ui.newClienteFeedback) return;
    ui.newClienteFeedback.textContent = message || "";
    ui.newClienteFeedback.style.color = isError ? "#d32f2f" : "var(--ink-300)";
  }

  async function handleNewClienteSave() {
    const nombre = (ui.newClienteInput?.value || "").trim();
    if (!nombre || nombre.length < 3) {
      setNewClienteFeedback("Ingresa al menos 3 caracteres.", true);
      ui.newClienteInput?.focus();
      return;
    }
    setNewClienteFeedback("");
    setButtonLoading(ui.newClienteSave, true);
    try {
      const { data, error } = await window.sb
        .from("cliente")
        .insert({ nombre })
        .select("id, nombre")
        .single();
      if (error) throw error;
      closeNewClienteModal();
      showMsg("Cliente agregado correctamente.");
      selectCliente(data);
      searchClientes(nombre).catch(() => {});
    } catch (err) {
      console.error(`${LOG_API} cliente nuevo`, err);
      setNewClienteFeedback("Error al guardar el cliente.", true);
      showMsg("No se pudo agregar el cliente.");
    } finally {
      setButtonLoading(ui.newClienteSave, false);
    }
  }

  function selectCliente(cliente) {
    if (!cliente?.id) return;
    state.selectedCliente = cliente.id;
    state.selectedClienteName = cliente.nombre || "";
    state.clienteQuery = cliente.nombre || "";
    if (ui.clienteSearchInput) ui.clienteSearchInput.value = state.clienteQuery;
    setClienteResultsVisible(false);
    toggleAddClienteButton(false);
    loadServicios(state.selectedCliente);
    maybeShowRutaCliente(cliente.id, cliente.nombre);
  }

  async function searchClientes(query = "") {
    state.isSearchingClientes = true;
    updateClienteFeedback("Buscando clientes...");
    try {
      const normalized = (query || "").trim().toUpperCase();
      const pattern = normalized ? `${normalized}%` : "%";
      const { data, error } = await window.sb
        .from("cliente")
        .select("id, nombre, created_at")
        .ilike("nombre_upper", pattern)
        .order("nombre", { ascending: true })
        .limit(20);
      if (error) throw error;
      state.clienteResults = data || [];
      renderClienteResults();
      if (!state.clienteResults.length) {
        toggleAddClienteButton(true, normalized);
        updateClienteFeedback(
          normalized
            ? "Sin coincidencias. Puedes agregar un nuevo cliente."
            : "Aún no hay clientes registrados."
        );
      } else {
        toggleAddClienteButton(false);
        updateClienteFeedback(
          `${state.clienteResults.length} cliente(s) encontrado(s)`
        );
      }
    } catch (err) {
      state.clienteResults = [];
      renderClienteResults();
      toggleAddClienteButton(false);
      updateClienteFeedback("Error al buscar clientes.");
      throw err;
    } finally {
      state.isSearchingClientes = false;
    }
  }

  function renderClienteResults() {
    if (!ui.clienteResults) return;
    ui.clienteResults.innerHTML = "";
    if (!state.clienteResults.length) {
      setClienteResultsVisible(false);
      return;
    }
    const frag = document.createDocumentFragment();
    state.clienteResults.forEach((cliente) => {
      const item = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cliente-search__result-btn";
      btn.dataset.clienteId = cliente.id;
      btn.dataset.clienteNombre = cliente.nombre;
      btn.setAttribute(
        "aria-selected",
        cliente.id === state.selectedCliente ? "true" : "false"
      );
      const name = document.createElement("span");
      name.className = "cliente-search__result-name";
      name.textContent = cliente.nombre;
      btn.appendChild(name);
      item.appendChild(btn);
      frag.appendChild(item);
    });
    ui.clienteResults.appendChild(frag);
    const shouldShow = document.activeElement === ui.clienteSearchInput;
    setClienteResultsVisible(shouldShow);
  }

  async function maybeShowRutaCliente(clienteId, clienteNombre) {
    if (!clienteId || !ui.routeModal) return;
    if (state.routeCache.has(clienteId)) {
      const cached = state.routeCache.get(clienteId);
      if (cached) showRouteModal(cached, clienteNombre);
      return;
    }
    try {
      const { data, error } = await window.sb
        .from("ruta_cliente")
        .select("id, nombre, descripcion")
        .eq("cliente_id", clienteId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      const route = data || null;
      state.routeCache.set(clienteId, route);
      if (route) showRouteModal(route, clienteNombre);
    } catch (err) {
      console.warn(`${LOG_API} ruta_cliente`, err);
    }
  }

  function showRouteModal(route, clienteNombre) {
    if (!ui.routeModal) return;
    const title = route?.nombre || clienteNombre || "Ruta asignada";
    if (ui.routeModalName) ui.routeModalName.textContent = title;
    if (ui.routeModalDesc) {
      if (route?.descripcion) {
        ui.routeModalDesc.textContent = route.descripcion;
        ui.routeModalDesc.hidden = false;
      } else {
        ui.routeModalDesc.hidden = true;
      }
    }
    ui.routeModal.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() =>
      ui.routeModal?.querySelector(".route-modal__cta")?.focus()
    );
  }

  function closeRouteModal() {
    if (!ui.routeModal) return;
    ui.routeModal.setAttribute("aria-hidden", "true");
  }
  // === END HU:HU-CUSTODIA-CLIENTE-SEARCH+RUTA ===
  async function loadServicios(clienteId) {
    if (!clienteId) return;
    state.isLoading = true;
    render();
    try {
      console.log(`${LOG_API} servicios cliente`, { clienteId });
      const { data, error } = await window.sb
        .from("servicio")
        .select(
          `
          id, tipo, estado, created_at, placa_upper, destino_texto,
          cliente:cliente_id(id, nombre),
          servicio_custodio:servicio_custodio!servicio_custodio_servicio_id_fkey(
            id,
            nombre_custodio,
            tipo_custodia,
            custodia_id,
            created_at
          )
        `
        )
        .eq("empresa", state.empresa)
        .eq("cliente_id", clienteId)
        .eq("estado", "ACTIVO")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = await Promise.all(
        (data || []).map(async (row) => {
          const ultimoPing = await fetchUltimoPing(row.id);
          return {
            svc: normalizeServicio(row),
            custodios: row.servicio_custodio || [],
            ultimoPing,
          };
        })
      );
      state.servicios = rows;
    } catch (err) {
      console.error(`${LOG_API} servicios`, err);
      state.servicios = [];
      showMsg("No se pudieron cargar los servicios.");
    } finally {
      state.isLoading = false;
      render();
    }
  }

  async function fetchUltimoPing(servicioId) {
    try {
      const { data, error } = await window.sb
        .from("v_servicio_ultimo_ping")
        .select("ultimo_ping_at")
        .eq("servicio_id", servicioId)
        .maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return data?.ultimo_ping_at || null;
    } catch (err) {
      console.warn(`${LOG_API} ultimo ping`, err);
      return null;
    }
  }

  function normalizeServicio(row) {
    return {
      id: row.id,
      tipo: row.tipo || "Sin tipo",
      placa: (row.placa_upper || "").toUpperCase(),
      destino: row.destino_texto || "",
      creado: row.created_at,
      clienteNombre: row.cliente?.nombre || "Cliente sin asignar",
    };
  }

  function render() {
    if (!ui.cards) return;
    ui.cards.innerHTML = "";
    if (!state.selectedCliente) {
      setPlaceholder(
        true,
        "Selecciona un cliente para visualizar los servicios disponibles."
      );
      return;
    }
    if (state.isLoading) {
      setPlaceholder(true, "Cargando servicios...");
      return;
    }
    if (!state.servicios.length) {
      setPlaceholder(true, "No hay servicios activos para este cliente.");
      return;
    }
    setPlaceholder(false);
    state.servicios.forEach((row) => ui.cards.appendChild(renderCard(row)));
  }

  function renderCard(row) {
    const owner = (row.custodios || []).find(
      (cust) => cust.custodia_id === state.profile.id
    );
    const card = document.createElement("article");
    card.className = "svc-card";
    const pingInfo = buildPingInfo(row.ultimoPing);
    const destino =
      row.svc.destino || row.svc.destino_texto || "Sin definir";
    const clienteFormatted = formatCliente(row.svc.clienteNombre);
    const tipoServicioInfo = resolveTipoCustodia(row.svc.tipo);
    const tipoFormatted = tipoServicioInfo
      ? `${tipoServicioInfo.label} (${tipoServicioInfo.code})`
      : "Sin tipo";
    const custodiasTexto = formatCustodias(row.custodios);

    card.innerHTML = `
      <header class="svc-card__header">
        <div>
          <span class="svc-chip">${row.svc.placa || "SIN PLACA"}</span>
        </div>
      </header>
      <div class="svc-info-grid">
        ${buildInfoItem("Cliente", clienteFormatted, "apartment")}
        ${buildInfoItem("Destino", destino, "place")}
        ${buildInfoItem("Tipo", tipoFormatted, "category", {
          valueTitle: tipoServicioInfo?.description,
        })}
        ${buildInfoItem("Custodia(s) asignada(s)", custodiasTexto, "groups")}
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "svc-actions";
    const actionText = document.createElement("p");
    actionText.className = "svc-actions__copy";
    const actionCta = document.createElement("div");
    actionCta.className = "svc-actions__cta";

    if (owner) {
      actionText.classList.add("is-success");
      actionText.textContent =
        "Eres el titular de este servicio. Puedes continuar con el seguimiento.";
      const followBtn = document.createElement("button");
      followBtn.type = "button";
      followBtn.className = "btn-primary";
      followBtn.innerHTML =
        '<i class="material-icons" aria-hidden="true">navigation</i><span>Seguir servicio</span>';
      followBtn.addEventListener("click", () => handleFollow(row, owner));
      actionCta.appendChild(followBtn);
    } else {
      actionText.classList.add("is-warning");
      actionText.textContent =
        "Solo el titular verificado puede continuar. Agrega tu custodia para tomar el control.";
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "btn-secondary";
      addBtn.innerHTML =
        '<i class="material-icons" aria-hidden="true">person_add</i><span>Agregar custodia +</span>';
      addBtn.addEventListener("click", () => openAddModal(row));
      actionCta.appendChild(addBtn);
    }

    actions.appendChild(actionText);
    actions.appendChild(actionCta);
    card.appendChild(actions);
    return card;
  }

  function buildInfoItem(label, value, icon, options = {}) {
    const safeValue =
      typeof value === "string" && value.trim().length
        ? value.trim()
        : String(value ?? "Sin registro");
    const valueClass = options.valueClass ? ` ${options.valueClass}` : "";
    const valueTitle = options.valueTitle
      ? ` title="${escapeAttr(options.valueTitle)}"`
      : "";
    return `
      <article class="info-item" role="group" aria-label="${label}">
        <span class="info-item__label">
          <span class="material-icons" aria-hidden="true">${icon}</span>${label}
        </span>
        <span class="info-item__value${valueClass}"${valueTitle}>${safeValue}</span>
      </article>
    `;
  }

  function formatCliente(nombre) {
    return (nombre || "Sin cliente").toUpperCase();
  }

  function formatTipo(value, options = {}) {
    const info = resolveTipoCustodia(value);
    if (!info) return options.fallback || "Sin tipo";
    if (options.short) return info.code;
    if (options.labelOnly) return info.label;
    return `${info.label} (${info.code})`;
  }

  function formatCustodias(lista) {
    if (!lista || !lista.length) return "Sin custodias asignadas";
    return lista
      .map((custodio) => {
        const nombre = custodio.nombre_custodio || "Sin nombre";
        const tipo = formatTipo(custodio.tipo_custodia, {
          short: true,
          fallback: "?",
        });
        return `${nombre} (${tipo})`;
      })
      .join(", ");
  }

  function resolveTipoCustodia(raw) {
    if (!raw) return null;
    const text = String(raw).trim();
    if (!text) return null;
    const letters = text
      .toUpperCase()
      .replace(/[()]/g, "")
      .replace(/[^A-Z]/g, "");
    if (letters.includes("SIMPLE") || letters === "S") {
      return { ...TIPO_CUSTODIA_META.S };
    }
    if (letters.includes("TIPOA") || letters === "A") {
      return { ...TIPO_CUSTODIA_META.A };
    }
    if (letters.includes("TIPOB") || letters === "B") {
      return { ...TIPO_CUSTODIA_META.B };
    }
    return null;
  }

  function escapeAttr(value) {
    return String(value ?? "").replace(/"/g, "&quot;");
  }

  function buildPingInfo(value) {
    if (!value) {
      return {
        text: "Sin ping reciente",
        detail: "Sin registro",
        className: "svc-ping--alert",
      };
    }
    const diff = Date.now() - new Date(value).getTime();
    let className = "svc-ping--alert";
    if (diff <= 5 * 60 * 1000) {
      className = "svc-ping--ok";
    } else if (diff <= 15 * 60 * 1000) {
      className = "svc-ping--warn";
    }
    return {
      text: `Ping ${formatRelative(value)}`,
      detail: formatDateShort(value),
      className,
    };
  }

  async function handleFollow(row, owner) {
    if (!owner?.id) {
      showMsg("No se encontró el registro de custodia.");
      return;
    }
    try {
      const ok = await verifyOwnerOnServer(owner.id);
      if (!ok) {
        showMsg(
          "Ya no eres el titular de este servicio. Refresca y vuelve a intentarlo."
        );
        await loadServicios(state.selectedCliente);
        return;
      }
    } catch (err) {
      console.error("[seguir] guard error", err);
      showMsg("No se pudo verificar tu titularidad. Intenta nuevamente.");
      return;
    }
    persistCustodiaSession(
      {
        servicio_id: row.svc.id,
        servicio_custodio_id: owner.id,
        custodia_id: owner.custodia_id,
        nombre_custodio: owner.nombre_custodio,
        tipo_custodia: owner.tipo_custodia,
      },
      "seguir"
    );
    console.log(`${LOG_SEGUIR} ready`, {
      servicio_id: row.svc.id,
      servicio_custodio_id: owner.id,
    });
    redirectToMapa(row.svc.id, "seguir");
  }

  function openAddModal(row) {
    state.pendingAdd = {
      servicioId: row.svc.id,
      descripcion: `${row.svc.placa} – ${row.svc.clienteNombre}`,
    };
    if (ui.modalDescription) {
      ui.modalDescription.textContent = `Servicio ${state.pendingAdd.descripcion}. Selecciona el tipo de custodia que realizaras.`;
    }
    const radios = document.querySelectorAll("input[name='add-tipo']");
    radios.forEach((radio, index) => {
      radio.checked = index === 0;
    });
    ui.modalAdd?.classList.add("show");
    ui.modalAdd?.setAttribute("aria-hidden", "false");
  }

  function closeAddModal() {
    state.pendingAdd = null;
    ui.modalAdd?.classList.remove("show");
    ui.modalAdd?.setAttribute("aria-hidden", "true");
  }

  async function handleAddConfirm() {
    if (!state.pendingAdd) return;
    const tipoSeleccionado =
      (
        document.querySelector("input[name='add-tipo']:checked") || {
          value: "Simple",
        }
      ).value || "";
    const tipoInfo = resolveTipoCustodia(tipoSeleccionado);
    if (!tipoInfo) {
      showMsg("Selecciona un tipo de custodia valido.");
      return;
    }
    const targetServicioId = state.pendingAdd.servicioId;
    try {
      setButtonLoading(ui.modalConfirm, true);
      const nuevo = await agregarCustodia(targetServicioId, tipoInfo.label);
      console.log(`${LOG_ADD} ok`, {
        servicio_id: targetServicioId,
        servicio_custodio_id: nuevo.id,
      });
      persistCustodiaSession(
        {
          servicio_id: targetServicioId,
          servicio_custodio_id: nuevo.id,
          custodia_id: state.profile.id,
          nombre_custodio: state.profile.nombre,
          tipo_custodia: tipoInfo.label,
        },
        "add"
      );
      showMsg("Te uniste al servicio. Redirigiendo al mapa...");
      closeAddModal();
      redirectToMapa(targetServicioId, "add");
    } catch (err) {
      console.error(`${LOG_ADD} error`, err);
      showMsg(err?.friendly || "No se pudo agregar la custodia.");
    } finally {
      setButtonLoading(ui.modalConfirm, false);
    }
  }

  async function agregarCustodia(servicioId, tipo) {
    if (!servicioId) throw new Error("Servicio no valido");
    const tipoInfo = resolveTipoCustodia(tipo);
    if (!tipoInfo) {
      const err = new Error("tipo-invalido");
      err.friendly = "Selecciona un tipo de custodia valido.";
      throw err;
    }
    await ensureCustodiaRecord();
    const already = state.servicios
      .find((row) => row.svc.id === servicioId)
      ?.custodios.find((c) => c.custodia_id === state.profile.id);
    if (already) {
      const err = new Error("duplicate");
      err.friendly = "Ya estás asignado a este servicio.";
      throw err;
    }
    const { data, error } = await window.sb
      .from("servicio_custodio")
      .insert(
        {
          servicio_id: servicioId,
          custodia_id: state.profile.id,
          nombre_custodio: state.profile.nombre,
          tipo_custodia: tipoInfo.label,
        },
        { returning: "representation" }
      )
      .select("id")
      .single();
    if (error) {
      throw decorateAddError(error);
    }
    return data;
  }
  async function ensureCustodiaRecord() {
    if (state.profileSynced) return state.profile.id;
    const id = state.profile?.id;
    if (!id) {
      const err = new Error("profile-missing");
      err.friendly = "Tu sesión expiró. Inicia sesión nuevamente.";
      throw err;
    }
    const { data, error } = await window.sb
      .from("custodia")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error(`${LOG_PROFILE} lookup error`, error);
      throw error;
    }
    if (!data?.id) {
      console.warn(`${LOG_PROFILE} no row`, { id });
      const err = new Error("custodia-missing");
      err.friendly =
        "No encontramos tu registro de custodia. Completa el onboarding y vuelve a iniciar sesión.";
      err.code = "CUSTODIA_MISSING";
      throw err;
    }
    state.profileSynced = true;
    return data.id;
  }

  function decorateAddError(error) {
    const code = String(error?.code || error?.details?.code || "");
    if (code === "23503") {
      const err = new Error("custodia_fk_missing");
      err.code = code;
      err.friendly =
        "Tu registro de custodia no está disponible. Vuelve a iniciar sesión o repite el registro.";
      return err;
    }
    if (error?.friendly) return error;
    const fallback = new Error(error?.message || "No se pudo agregar la custodia.");
    fallback.code = code || "ADD_ERROR";
    fallback.friendly = "No se pudo agregar la custodia.";
    return fallback;
  }

  function setPlaceholder(visible, text) {
    if (!ui.placeholder) return;
    if (visible) {
      ui.placeholder.hidden = false;
      ui.placeholder.textContent = text || "";
    } else {
      ui.placeholder.hidden = true;
    }
  }

  function showMsg(message) {
    try {
      if (ui.snackbar?.MaterialSnackbar) {
        ui.snackbar.MaterialSnackbar.showSnackbar({ message });
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

  async function verifyOwnerOnServer(scId) {
    if (!scId) return false;
    const { data, error } = await window.sb
      .from("servicio_custodio")
      .select("custodia_id")
      .eq("id", scId)
      .maybeSingle();
    if (error) throw error;
    return data?.custodia_id === state.profile.id;
  }

  function formatDateShort(value) {
    if (!value) return "Sin fecha";
    try {
      return new Intl.DateTimeFormat("es-PE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value));
    } catch {
      return value;
    }
  }

  function formatRelative(value) {
    if (!value) return "Sin registro";
    const diff = Date.now() - new Date(value).getTime();
    if (diff < 2 * 60 * 1000) return "Hace instantes";
    const minutes = Math.round(diff / 60000);
    if (minutes < 60) return `Hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `Hace ${hours} h`;
    const days = Math.round(hours / 24);
    return `Hace ${days} d`;
  }

  function redirectToLogin() {
    window.location.href = "/html/login/login.html";
  }

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
      const ttl = window.CustodiaSession?.TTL_MS || 4 * 60 * 60 * 1000;
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
})();
// === END HU:HU-CUSTODIA-REGISTROS-FLUJO ===







