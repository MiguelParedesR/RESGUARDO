// === BEGIN HU:HU-CUSTODIA-REGISTROS-FLUJO (NO TOCAR FUERA) ===
(function () {
  "use strict";

  const STORAGE_PROFILE_KEY = "custodia_profile";
  const LOG_API = "[api]";
  const LOG_SEGUIR = "[seguir]";
  const LOG_ADD = "[add-custodia]";

  const state = {
    profile: null,
    empresa: "",
    clientes: [],
    selectedCliente: "",
    servicios: [],
    isLoading: false,
    pendingAdd: null,
    snackbar: null,
  };

  const ui = {};

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
    state.empresa = profile.empresa || profile.empresa_otro || "";
    mapUI();
    bindEvents();
    loadClientes().catch((err) => {
      console.error(`${LOG_API} clientes`, err);
      showMsg("No se pudieron cargar los clientes.");
    });
  }

  function mapUI() {
    ui.snackbar = document.getElementById("app-snackbar");
    ui.cards = document.getElementById("cards-custodia");
    ui.placeholder = document.getElementById("cards-placeholder");
    ui.clienteSelect = document.getElementById("cliente-select");
    ui.clienteClear = document.getElementById("cliente-clear");
    ui.modalAdd = document.getElementById("modal-add-custodia");
    ui.modalDescription = document.getElementById("add-modal-description");
    ui.modalConfirm = document.getElementById("add-modal-confirm");
  }

  function bindEvents() {
    ui.clienteSelect?.addEventListener("change", (evt) => {
      state.selectedCliente = evt.target.value || "";
      if (state.selectedCliente) {
        loadServicios(state.selectedCliente);
      } else {
        state.servicios = [];
        render();
      }
    });
    ui.clienteClear?.addEventListener("click", () => {
      state.selectedCliente = "";
      if (ui.clienteSelect) ui.clienteSelect.value = "";
      state.servicios = [];
      render();
    });
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

  async function loadClientes() {
    const { data, error } = await window.sb
      .from("servicio")
      .select("cliente_id, cliente:cliente_id(id, nombre)")
      .eq("empresa", state.empresa)
      .eq("estado", "ACTIVO");
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
        });
      }
    });
    state.clientes = Array.from(map.values()).sort((a, b) =>
      a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" })
    );
    renderClienteSelect();
  }

  function renderClienteSelect() {
    if (!ui.clienteSelect) return;
    const current = state.selectedCliente;
    ui.clienteSelect.innerHTML = '<option value="">Seleccione cliente</option>';
    state.clientes.forEach((cliente) => {
      const option = document.createElement("option");
      option.value = cliente.id;
      option.textContent = cliente.nombre;
      if (cliente.id === current) option.selected = true;
      ui.clienteSelect.appendChild(option);
    });
  }

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

    const head = document.createElement("div");
    head.className = "svc-head";
    head.innerHTML = `
      <p class="svc-placa">${row.svc.placa || "SIN PLACA"}</p>
      <p class="svc-meta"><strong>Cliente:</strong> ${row.svc.clienteNombre}</p>
      <p class="svc-meta"><strong>Destino:</strong> ${
        row.svc.destino || "Sin definir"
      }</p>
      <p class="svc-meta"><strong>Tipo:</strong> ${row.svc.tipo}</p>
      <p class="svc-meta"><strong>Creado:</strong> ${formatDate(
        row.svc.creado
      )}</p>
      <p class="svc-meta"><strong>Último ping:</strong> ${formatRelative(
        row.ultimoPing
      )}</p>
    `;
    card.appendChild(head);

    const list = document.createElement("div");
    list.className = "svc-custodios";
    if (row.custodios && row.custodios.length) {
      row.custodios.forEach((custodio) => {
        const item = document.createElement("div");
        item.className = "custodio-row";
        const info = document.createElement("div");
        info.className = "custodio-row__info";
        const isOwner = custodio.custodia_id === state.profile.id;
        info.innerHTML = `
          <p class="custodio-row__name">${
            custodio.nombre_custodio || "Sin nombre"
          }</p>
          <p class="custodio-row__type">${
            custodio.tipo_custodia || "Sin tipo"
          }</p>
        `;
        const badge = document.createElement("span");
        badge.className =
          "badge " + (isOwner ? "badge--owner" : "badge--other");
        badge.textContent = isOwner
          ? "Tu registro"
          : custodio.custodia_id
          ? "Titular"
          : "Pendiente";
        if (!custodio.custodia_id) {
          badge.classList.remove("badge--owner");
          badge.classList.add("badge--pending");
          badge.textContent = "Sin titular";
        }
        item.appendChild(info);
        item.appendChild(badge);
        list.appendChild(item);
      });
    } else {
      list.innerHTML =
        "<p class='svc-meta'>Este servicio aún no tiene custodias asignadas.</p>";
    }
    card.appendChild(list);

    const actions = document.createElement("div");
    actions.className = "svc-actions";
    const actionText = document.createElement("p");
    const actionCta = document.createElement("div");
    actionCta.className = "svc-actions__cta";

    if (owner) {
      actionText.innerHTML =
        "<span class='status-pill'><i class='material-icons' aria-hidden='true'>check</i>Titular verificado</span>";
      const followBtn = document.createElement("button");
      followBtn.className =
        "mdl-button mdl-js-button mdl-button--raised mdl-button--accent";
      followBtn.textContent = "Seguir";
      followBtn.addEventListener("click", () => handleFollow(row, owner));
      actionCta.appendChild(followBtn);
    } else {
      actionText.innerHTML =
        "<span class='warning'>Solo el titular puede continuar.</span> Si este servicio te pertenece, agrégate como custodia.";
      const addBtn = document.createElement("button");
      addBtn.className = "mdl-button mdl-js-button mdl-button--raised";
      addBtn.textContent = "Agregar custodia +";
      addBtn.addEventListener("click", () => openAddModal(row));
      actionCta.appendChild(addBtn);
    }

    actions.appendChild(actionText);
    actions.appendChild(actionCta);
    card.appendChild(actions);

    return card;
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
      descripcion: `${row.svc.placa} · ${row.svc.clienteNombre}`,
    };
    if (ui.modalDescription) {
      ui.modalDescription.textContent = `Servicio ${state.pendingAdd.descripcion}. Selecciona el tipo de custodia que realizarás.`;
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
    const tipo = (
      document.querySelector("input[name='add-tipo']:checked") || {
        value: "Simple",
      }
    ).value;
    try {
      setButtonLoading(ui.modalConfirm, true);
      const nuevo = await agregarCustodia(state.pendingAdd.servicioId, tipo);
      console.log(`${LOG_ADD} ok`, {
        servicio_id: state.pendingAdd.servicioId,
        servicio_custodio_id: nuevo.id,
      });
      persistCustodiaSession(
        {
          servicio_id: state.pendingAdd.servicioId,
          servicio_custodio_id: nuevo.id,
          custodia_id: state.profile.id,
          nombre_custodio: state.profile.nombre,
          tipo_custodia: tipo,
        },
        "add"
      );
      showMsg("Te uniste al servicio. Redirigiendo al mapa...");
      closeAddModal();
      redirectToMapa(state.pendingAdd.servicioId, "add");
    } catch (err) {
      console.error(`${LOG_ADD} error`, err);
      showMsg(err?.friendly || "No se pudo agregar la custodia.");
    } finally {
      setButtonLoading(ui.modalConfirm, false);
    }
  }

  async function agregarCustodia(servicioId, tipo) {
    if (!servicioId) throw new Error("Servicio no válido");
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
          tipo_custodia: tipo,
        },
        { returning: "representation" }
      )
      .select("id")
      .single();
    if (error) throw error;
    return data;
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

  function formatDate(value) {
    if (!value) return "Sin fecha";
    try {
      return new Intl.DateTimeFormat("es-PE", {
        dateStyle: "medium",
        timeStyle: "short",
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
