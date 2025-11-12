// @hu HU-MARCADORES-CUSTODIA
// @author Codex
// @date 2025-02-15
// @rationale Ajustar etiquetas y pings segun HU.

document.addEventListener("DOMContentLoaded", () => {
  const h = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[c])
    );
  const toBase64 = (data) => {
    try {
      if (!data) return "";
      if (/^[A-Za-z0-9+/]+=*$/.test(data)) return data;
      if (typeof data === "string" && data.startsWith("\\x")) {
        const hex = data.slice(2);
        let bin = "";
        for (let i = 0; i < hex.length; i += 2)
          bin += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
        return btoa(bin);
      }
      return btoa(data);
    } catch {
      return "";
    }
  };

  // Snackbar
  const snackbar = document.getElementById("app-snackbar");
  const showMsg = (message) => {
    try {
      if (snackbar && snackbar.MaterialSnackbar)
        snackbar.MaterialSnackbar.showSnackbar({ message });
      else alert(message);
    } catch {
      alert(message);
    }
  };

  // Anti-exfiltraciÃ³n bÃ¡sica (disuasiva)
  const antiOverlay = document.getElementById("anti-capture-overlay");
  document.addEventListener("contextmenu", (e) => {
    if (e.target.closest(".sensitive")) {
      e.preventDefault();
      showMsg("Zona protegida");
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) antiOverlay && antiOverlay.classList.add("show");
    else antiOverlay && antiOverlay.classList.remove("show");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key && e.key.toLowerCase() === "printscreen") {
      antiOverlay && antiOverlay.classList.add("show");
      setTimeout(
        () => antiOverlay && antiOverlay.classList.remove("show"),
        1200
      );
      showMsg("Captura desaconsejada en esta zona");
    }
  });

  // UI elementos
  const btnReset = document.getElementById("btn-reset");
  const placasContainer = document.getElementById("placas-container");
  const sidebar = document.getElementById("sidebar");
  const toggleSidebarBtn = document.getElementById("toggle-sidebar");
  const scrim = document.getElementById("scrim");
  const searchClientes = document.getElementById("search-clientes");
  const listaClientes = document.getElementById("lista-clientes");
  const sidebarLoader = document.getElementById("clientes-loader");
  const sidebarEmpty = document.getElementById("sidebar-empty");
  const sidebarEmptyText = document.getElementById("sidebar-empty-text");
  const selectClientesMobile = document.getElementById(
    "select-clientes-mobile"
  );
  const btnMobileClear = document.getElementById("btn-mobile-clear");
  const fotosModal = document.getElementById("fotos-modal");
  const fotosGrid = document.getElementById("fotos-grid");

  if (!window.sb) {
    console.error("[consulta] Supabase no inicializado (config.js)");
    showMsg("Error de inicializaciÃ³n");
    return;
  }

  // Helpers
  const fmtFecha = (iso) => {
    try {
      const d = new Date(iso);
      return new Intl.DateTimeFormat("es-PE", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/Lima",
      }).format(d);
    } catch {
      return iso || "";
    }
  };
  function groupBy(arr, keyFn) {
    return arr.reduce((acc, item) => {
      const k = keyFn(item);
      (acc[k] ||= []).push(item);
      return acc;
    }, {});
  }

  // Estado
  let clientesCache = [];
  let clienteSeleccionado = null;

  function setSidebarLoading(loading) {
    if (sidebarLoader) sidebarLoader.hidden = !loading;
    if (listaClientes) listaClientes.classList.toggle("is-dimmed", loading);
  }

  function showSidebarEmpty(show, message) {
    if (!sidebarEmpty) return;
    sidebarEmpty.hidden = !show;
    if (show && message && sidebarEmptyText) {
      sidebarEmptyText.textContent = message;
    }
  }

  function clientInitial(nombre) {
    return (nombre || "?").trim().charAt(0).toUpperCase() || "?";
  }

  function renderSidebar(clientes, emptyMessage) {
    if (!listaClientes) return;
    listaClientes.innerHTML = "";
    if (!clientes?.length) {
      showSidebarEmpty(true, emptyMessage || "Sin clientes registrados.");
      return;
    }
    showSidebarEmpty(false);
    const currentId = clienteSeleccionado?.id;
    for (const c of clientes) {
      const li = document.createElement("li");
      li.dataset.id = c.id;
      li.innerHTML = `
        <span class="client-pill">${h(clientInitial(c.nombre))}</span>
        <div class="client-info">
          <p class="client-name">${h(c.nombre)}</p>
          <p class="client-meta">Toca para ver servicios activos</p>
        </div>`;
      if (currentId && String(currentId) === String(c.id)) {
        li.classList.add("is-active");
      }
      li.addEventListener("click", async () => {
        clienteSeleccionado = c;
        for (const item of listaClientes.querySelectorAll("li"))
          item.classList.remove("is-active");
        li.classList.add("is-active");
        placasContainer && (placasContainer.innerHTML = "");
        await cargarServiciosPorCliente(c.id);
        if (window.matchMedia("(max-width: 1023px)").matches) closeSidebar();
      });
      listaClientes.appendChild(li);
    }
  }

  function filterClientes(q) {
    q = (q || "").toLowerCase().trim();
    if (!q) {
      renderSidebar(clientesCache);
      return;
    }
    const filtered = clientesCache.filter((c) =>
      (c.nombre || "").toLowerCase().includes(q)
    );
    renderSidebar(
      filtered,
      filtered.length
        ? null
        : "No hay resultados — intenta con otro nombre."
    );
  }

  async function cargarClientes() {
    try {
      setSidebarLoading(true);
      showSidebarEmpty(false);
      const { data, error } = await window.sb
        .from("cliente")
        .select("id, nombre")
        .order("nombre", { ascending: true });
      if (error) throw error;
      clientesCache = data || [];
      renderSidebar(clientesCache, "Sin clientes registrados.");
      // build mobile select options
      if (selectClientesMobile) {
        selectClientesMobile.innerHTML =
          '<option value="">Seleccione cliente</option>';
        for (const c of clientesCache) {
          const opt = document.createElement("option");
          opt.value = c.id;
          opt.textContent = c.nombre;
          selectClientesMobile.appendChild(opt);
        }
      }
    } catch (e) {
      console.error(e);
      showMsg("No se pudieron cargar los clientes");
      renderSidebar([], "Error al cargar clientes.");
    }
    finally {
      setSidebarLoading(false);
    }
  }

  async function cargarServiciosPorCliente(clienteId) {
    try {
      const { data, error } = await window.sb
        .from("servicio")
        .select("id, placa, destino_texto, estado, tipo, created_at")
        .eq("cliente_id", clienteId)
        .eq("estado", "ACTIVO")
        .order("created_at", { ascending: false });
      if (error) throw error;
      renderPlacasAgrupadas(data || []);
    } catch (e) {
      console.error(e);
      showMsg("No se pudieron cargar los servicios del cliente");
    }
  }

  function renderPlacasAgrupadas(servicios) {
    if (!placasContainer) return;
    placasContainer.innerHTML = "";
    if (!servicios.length) {
      placasContainer.innerHTML = `
        <div class="mdl-card mdl-shadow--2dp placa-card">
          <div class="mdl-card__supporting-text">Sin servicios para este cliente.</div>
        </div>`;
      return;
    }

    const porPlaca = groupBy(servicios, (s) => s.placa || "SIN-PLACA");
    const selectedText =
      (clienteSeleccionado && clienteSeleccionado.nombre) || "";
    const group = document.createElement("section");
    group.className = "cliente-group";
    const totalPlacas = Object.keys(porPlaca).length;
    group.innerHTML = `
      <header class="cliente-header">
        <h3 class="cliente-title">${h(selectedText)}</h3>
        <div class="cliente-subtitle">${
          servicios.length
        } servicio(s) - ${totalPlacas} placa(s)</div>
      </header>
      <div class="placas-grid" id="cliente-cards"></div>
    `;
    const cardsContainer = group.querySelector("#cliente-cards");
    placasContainer.appendChild(group);
    group.classList.add("mount-fade");

    Object.entries(porPlaca).forEach(([placa, lista]) => {
      const ultima = lista[0];
      const card = document.createElement("article");
      card.className = "mdl-card mdl-shadow--2dp placa-card sensitive";

      const header = document.createElement("div");
      header.className = "placa-header";
      header.setAttribute("aria-expanded", "false");
      header.innerHTML = `
        <div class="placa-title">
          <span class="chip">${placa}</span>
          <div class="placa-meta">${h(
            (clienteSeleccionado && clienteSeleccionado.nombre) || ""
          )} · ${lista.length} servicio(s)</div>
        </div>
        <button class="mdl-button mdl-js-button mdl-button--icon" aria-label="Expandir">
          <i class="material-icons expand-icon">expand_more</i>
        </button>
      `;

      const panel = document.createElement("div");
      panel.className = "servicios-panel";

      header.addEventListener("click", async () => {
        panel.classList.toggle("open");
        const icon = header.querySelector(".material-icons");
        const open = panel.classList.contains("open");
        if (icon) icon.textContent = open ? "expand_less" : "expand_more";
        header.setAttribute("aria-expanded", open ? "true" : "false");
        if (open && !panel.dataset.loaded) {
          panel.innerHTML = "";
          for (const svc of lista) {
            const svcEl = await renderServicioCard(svc);
            panel.appendChild(svcEl);
          }
          panel.dataset.loaded = "1";
        }
      });

      card.appendChild(header);
      card.appendChild(panel);
      cardsContainer && cardsContainer.appendChild(card);
      if (window.componentHandler && window.componentHandler.upgradeElement)
        window.componentHandler.upgradeElement(card);
    });
  }

  // === BEGIN HU:HU-MARCADORES-CUSTODIA consulta cards (no tocar fuera) ===
  async function renderServicioCard(svc) {
    const card = document.createElement("div");
    card.className = "servicio-card";
    card.innerHTML = `
      <ul class="servicio-meta">
        ${buildMetaItem({
          icon: "style",
          label: "Tipo",
          value: svc.tipo || "Sin tipo",
          meta: "tipo",
          spanAttr: 'data-field="tipo"',
        })}
        ${buildMetaItem({
          icon: "place",
          label: "Destino",
          value: svc.destino_texto || "Sin destino",
          meta: "destino",
        })}
        ${buildMetaItem({
          icon: "person",
          label: "Custodia(s)",
          value: "Sin titular",
          meta: "contacto",
          spanAttr: 'data-field="contacto"',
          includeAvatar: true,
        })}
      </ul>
      <div class="servicio-actions">
        <button type="button" class="btn-secondary is-muted" data-action="ver-fotos" disabled>
          <i class="material-icons" aria-hidden="true">photo_library</i>
          <span>Ver fotos</span>
        </button>
      </div>
    `;
    const custodiosBlock = document.createElement("div");
    custodiosBlock.className = "custodios-block";
    custodiosBlock.innerHTML =
      "<p class='custodios-empty'>Cargando custodias...</p>";
    card.appendChild(custodiosBlock);

    const fotosBtn = card.querySelector("[data-action='ver-fotos']");
    const contactoEl = card.querySelector("[data-field='contacto']");
    const contactoAvatar = card.querySelector(".contact-avatar");
    if (contactoAvatar) contactoAvatar.textContent = "C";
    const tipoEl = card.querySelector("[data-field='tipo']");

    try {
      const custodios = await fetchCustodiosDetalle(svc.id);
      const resumen = buildTipoResumen(custodios || []);
      if (tipoEl) tipoEl.textContent = resumen;
      const titular =
        custodios?.find((cust) => cust.custodia?.nombre) || custodios?.[0];
      const contactoNombre =
        titular?.custodia?.nombre ||
        titular?.nombre_custodio ||
        "Sin titular";
      if (contactoEl) contactoEl.textContent = contactoNombre;
      const fotos = buildSelfieItems(custodios || []);
      configureFotosButton(fotosBtn, fotos);
      if (contactoAvatar) {
        const avatarPhoto = fotos.find((item) => {
          const custId = titular?.custodia?.id || titular?.custodia_id;
          return custId && item.custodiaId === custId;
        });
        if (avatarPhoto?.src) {
          contactoAvatar.innerHTML = `<img src="${avatarPhoto.src}" alt="Selfie de ${h(
            titular?.custodia?.nombre || titular?.nombre_custodio || "Custodia"
          )}">`;
        } else {
          const initial =
            (contactoNombre || "C").trim().charAt(0).toUpperCase() || "C";
          contactoAvatar.textContent = initial;
        }
      }
      renderCustodiosMiniList(custodiosBlock, custodios);
    } catch (err) {
      console.warn("[consulta] custodios detalle error", err);
      custodiosBlock.innerHTML =
        "<p class='custodios-empty'>No se pudo cargar la información de custodias.</p>";
      if (fotosBtn) {
        fotosBtn.disabled = true;
        fotosBtn.classList.add("is-muted");
        fotosBtn.querySelector("span").textContent = "Sin fotos";
      }
    }

    return card;
  }

  function buildMetaItem({
    icon,
    label,
    value,
    meta = "",
    spanAttr = "",
    includeAvatar = false,
  }) {
    return `
      <li ${meta ? `data-meta="${meta}"` : ""}>
        ${
          includeAvatar
            ? '<div class="contact-avatar" aria-hidden="true"></div>'
            : `<span class="material-icons icon" aria-hidden="true">${icon}</span>`
        }
        <div class="meta-copy">
          <span class="label">${h(label)}</span>
          <span class="value" ${spanAttr}>${h(value || "-")}</span>
        </div>
      </li>
    `;
  }

  function buildTipoResumen(custodios) {
    if (!custodios || !custodios.length) return "Sin custodios";
    const counts = new Map();
    custodios.forEach((c) => {
      const tipo = (c.tipo_custodia || "Sin tipo").trim() || "Sin tipo";
      counts.set(tipo, (counts.get(tipo) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([tipo, total]) => `${tipo} x${total}`)
      .join(" · ");
  }
  // === END HU:HU-MARCADORES-CUSTODIA ===

  // Sidebar toggle
  function openSidebar() {
    sidebar && sidebar.classList.add("open");
    scrim && scrim.removeAttribute("hidden");
  }
  function closeSidebar() {
    sidebar && sidebar.classList.remove("open");
    scrim && scrim.setAttribute("hidden", "");
  }
  const mqTablet = window.matchMedia("(max-width: 1023px)");
  const mqMobile = window.matchMedia("(max-width: 599px)");
  function syncResponsiveState() {
    if (mqMobile.matches) {
      closeSidebar();
      if (toggleSidebarBtn) toggleSidebarBtn.style.display = "none";
    } else {
      if (toggleSidebarBtn) toggleSidebarBtn.style.display = "";
    }
    if (!mqTablet.matches) {
      scrim && scrim.setAttribute("hidden", "");
    }
  }
  window.addEventListener("resize", () => {
    syncResponsiveState();
  });
  syncResponsiveState();

  // Events
  toggleSidebarBtn &&
    toggleSidebarBtn.addEventListener("click", () => {
      if (sidebar && sidebar.classList.contains("open")) closeSidebar();
      else openSidebar();
    });
  scrim && scrim.addEventListener("click", closeSidebar);
  searchClientes &&
    searchClientes.addEventListener("input", () =>
      filterClientes(searchClientes.value)
    );
  if (selectClientesMobile) {
    selectClientesMobile.addEventListener("change", async () => {
      const id = selectClientesMobile.value;
      if (!id) {
        placasContainer && (placasContainer.innerHTML = "");
        clienteSeleccionado = null;
        return;
      }
      clienteSeleccionado =
        clientesCache.find((c) => String(c.id) === String(id)) || null;
      placasContainer && (placasContainer.innerHTML = "");
      await cargarServiciosPorCliente(id);
    });
  }
  if (btnMobileClear) {
    btnMobileClear.addEventListener("click", () => {
      if (selectClientesMobile) selectClientesMobile.value = "";
      clienteSeleccionado = null;
      placasContainer && (placasContainer.innerHTML = "");
    });
  }

  // Modal fotos
  function showFotosCustodia(items) {
    if (!fotosModal || !fotosGrid) return;
    fotosGrid.innerHTML = "";
    for (const it of items) {
      const fig = document.createElement("figure");
      const img = document.createElement("img");
      img.src = it.src;
      img.alt = it.label || "Foto de custodia";
      const cap = document.createElement("figcaption");
      cap.textContent = it.label || "";
      fig.appendChild(img);
      fig.appendChild(cap);
      fotosGrid.appendChild(fig);
    }
    fotosModal.setAttribute("aria-hidden", "false");
  }
  fotosModal &&
    fotosModal.addEventListener("click", (e) => {
      const t = e.target;
      const shouldClose =
        t.classList.contains("modal-backdrop") ||
        t.closest('[data-close="modal"]');
      if (shouldClose) {
        fotosModal.setAttribute("aria-hidden", "true");
        fotosGrid && (fotosGrid.innerHTML = "");
      }
    });

  // Close modal or drawer with Esc
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (fotosModal && fotosModal.getAttribute("aria-hidden") === "false") {
        fotosModal.setAttribute("aria-hidden", "true");
        fotosGrid && (fotosGrid.innerHTML = "");
      }
      if (sidebar && sidebar.classList.contains("open")) closeSidebar();
    }
  });

  // Reset
  btnReset &&
    btnReset.addEventListener("click", () => {
      clienteSeleccionado = null;
      placasContainer && (placasContainer.innerHTML = "");
      if (listaClientes)
        listaClientes
          .querySelectorAll("li")
          .forEach((li) => li.classList.remove("is-active"));
      if (searchClientes) {
        searchClientes.value = "";
        renderSidebar(clientesCache);
      }
      if (selectClientesMobile) {
        selectClientesMobile.innerHTML =
          '<option value="">Seleccione cliente</option>';
        for (const c of clientesCache) {
          const opt = document.createElement("option");
          opt.value = c.id;
          opt.textContent = c.nombre;
          selectClientesMobile.appendChild(opt);
        }
      }
    });

  const debounce = (fn, ms = 150) => {
    let t = 0;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  };

  const scheduleClienteRefresh = debounce(async () => {
    if (clienteSeleccionado && clienteSeleccionado.id) {
      try {
        await cargarServiciosPorCliente(clienteSeleccionado.id);
      } catch (err) {
        console.warn("[consulta] refresh fallo", err);
      }
    }
  }, 200);

  setupRealtime();

  function setupRealtime() {
    try {
      const ch = window.sb?.channel?.("rt-consulta-servicio");
      if (!ch) return;
      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "servicio" },
        (payload) => {
          const row = payload.new || payload.old || {};
          if (clienteSeleccionado && row.cliente_id === clienteSeleccionado.id)
            scheduleClienteRefresh();
        }
      ).subscribe();
      window.addEventListener("beforeunload", () => {
        try {
          window.sb.removeChannel(ch);
        } catch {}
      });
    } catch (err) {
      console.warn("[consulta] realtime inactivo", err);
    }
  }

  // === BEGIN HU:HU-MARCADORES-CUSTODIA consulta custodios (NO TOCAR FUERA) ===
  async function fetchCustodiosDetalle(servicioId) {
    const { data, error } = await window.sb
      .from("servicio_custodio")
      .select(
        `
        id,
        tipo_custodia,
        custodia_id,
        nombre_custodio,
        created_at,
        custodia:custodia_id (
          id,
          nombre,
          empresa,
          empresa_otro,
          selfies:selfie_custodia_id_fkey (
            id,
            mime_type,
            bytes,
            created_at
          )
        ),
        sc_selfies:selfie_servicio_custodio_id_fkey (
          id,
          mime_type,
          bytes,
          created_at
        )
      `
      )
      .eq("servicio_id", servicioId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  function renderCustodiosMiniList(container, custodios) {
    if (!custodios || !custodios.length) {
      container.innerHTML =
        "<p class='custodios-empty'>Sin custodias registradas.</p>";
      return;
    }
    container.innerHTML = "";
    custodios.forEach((cust) => {
      const nombre = (
        cust.custodia?.nombre ||
        cust.nombre_custodio ||
        "Sin nombre"
      ).trim();
      const empresa =
        cust.custodia?.empresa ||
        cust.custodia?.empresa_otro ||
        "Empresa sin registrar";
      const tipo = cust.tipo_custodia || "Sin tipo";
      const fotoSrc = getSelfieSrc(cust);

      const item = document.createElement("div");
      item.className = "custodios-item";

      const avatarBtn = document.createElement(fotoSrc ? "button" : "div");
      avatarBtn.className = "custodio-avatar" + (fotoSrc ? "" : " is-empty");
      if (fotoSrc) {
        const img = document.createElement("img");
        img.src = fotoSrc;
        img.alt = `Selfie de ${nombre}`;
        avatarBtn.appendChild(img);
        avatarBtn.addEventListener("click", () =>
          showFotosCustodia([{ src: fotoSrc, label: `Custodia: ${nombre}` }])
        );
      } else {
        avatarBtn.textContent =
          nombre?.charAt(0)?.toUpperCase() || (cust.custodia_id ? "C" : "?");
      }
      item.appendChild(avatarBtn);

      const info = document.createElement("div");
      info.className = "custodio-info";
      info.innerHTML = `
        <p class="custodio-info__name">${h(nombre)}</p>
        <p class="custodio-info__meta">${h(tipo)} \\u00b7 ${h(empresa)}</p>
      `;
      item.appendChild(info);

      container.appendChild(item);
    });
  }

  function configureFotosButton(btn, items) {
    if (!btn) return;
    if (!items.length) {
      btn.disabled = true;
      btn.classList.add("is-muted");
      const label = btn.querySelector("span");
      if (label) label.textContent = "Sin fotos";
      return;
    }
    btn.disabled = false;
    btn.classList.remove("is-muted");
    const label = btn.querySelector("span");
    if (label) label.textContent = `Ver fotos (${items.length})`;
    btn.__fotos = items;
    if (!btn.dataset.bound) {
      btn.addEventListener("click", () => {
        if (Array.isArray(btn.__fotos) && btn.__fotos.length) {
          showFotosCustodia(btn.__fotos);
        }
      });
      btn.dataset.bound = "1";
    }
  }

  function buildSelfieItems(entries) {
    const list = [];
    (entries || []).forEach((cust) => {
      const nombre =
        (cust.custodia?.nombre || cust.nombre_custodio || "Custodia").trim();
      const files = [
        ...(Array.isArray(cust.custodia?.selfies)
          ? cust.custodia.selfies
          : []),
        ...(Array.isArray(cust.sc_selfies) ? cust.sc_selfies : []),
      ];
      files.forEach((file) => {
        if (!file?.bytes) return;
        const mime = file.mime_type || "image/jpeg";
        list.push({
          src: `data:${mime};base64,${toBase64(file.bytes)}`,
          label: `Custodia: ${nombre}`,
          custodiaId: cust.custodia?.id || cust.custodia_id || null,
          servicioCustodioId: cust.id,
        });
      });
    });
    return list;
  }

  function getSelfieSrc(entry) {
    const primary =
      Array.isArray(entry?.custodia?.selfies) && entry.custodia.selfies.length
        ? entry.custodia.selfies
        : [];
    const secondary =
      Array.isArray(entry?.sc_selfies) && entry.sc_selfies.length
        ? entry.sc_selfies
        : [];
    const ordered = [...primary, ...secondary].sort((a, b) => {
      const aTime = a?.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b?.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    });
    const file = ordered.find((row) => row && row.bytes);
    if (!file || !file.bytes) return null;
    const mime = file.mime_type || "image/jpeg";
    return `data:${mime};base64,${toBase64(file.bytes)}`;
  }
  // === END HU:HU-MARCADORES-CUSTODIA ===

  // Start
  cargarClientes();
});
