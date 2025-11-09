// Dashboard Admin - limpio y estable (Lista + Filtros/Mapa)
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
  const snackbar = document.getElementById("app-snackbar");
  const showMsg = (message) => {
    try {
      snackbar?.MaterialSnackbar?.showSnackbar({ message });
    } catch (e) {
      alert(message);
    }
  };
  // Custom map icons (local, CSP-safe)
  const ICON = {
    custodia: L.icon({
      iconUrl: "/assets/icons/custodia-current.svg",
      iconRetinaUrl: "/assets/icons/custodia-current.svg",
      iconSize: [30, 30],
      iconAnchor: [15, 28],
      popupAnchor: [0, -28],
    }),
    destino: L.icon({
      iconUrl: "/assets/icons/pin-destination.svg",
      iconRetinaUrl: "/assets/icons/pin-destination.svg",
      iconSize: [28, 28],
      iconAnchor: [14, 26],
      popupAnchor: [0, -26],
    }),
  };

  const hasAlarma = typeof window.Alarma === "object";
  const hasPushKey = Boolean(window.APP_CONFIG?.WEB_PUSH_PUBLIC_KEY);
  let audioCtx = null;
  let audioUnlocked = false;
  function ensureAudioCtx() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    return audioCtx;
  }
  async function unlockAudio() {
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    const finalize = () => {
      if (ctx.state === "running") {
        audioUnlocked = true;
        window.removeEventListener("pointerdown", unlockAudioListener);
        window.removeEventListener("keydown", unlockAudioListener);
      }
    };
    try {
      if (ctx.state === "suspended" && ctx.resume) {
        await ctx.resume();
      }
    } catch (_) {
      // browser still blocking; keep listeners active
    }
    finalize();
  }
  const unlockAudioListener = () => {
    unlockAudio();
  };
  window.addEventListener("pointerdown", unlockAudioListener);
  window.addEventListener("keydown", unlockAudioListener);

  // Estado de mapa debe declararse antes de cualquier uso para evitar TDZ
  let map;
  const markers = new Map();
  let selectedId = null;
  let overviewLayer = null,
    focusLayer = null,
    routeLayerFocus = null,
    panicLayer = null;
  let panicMarker = null;
  let servicesCache = [];
  let servicesLoaded = false;
  let lastPanicRecord = null;
  let panicBannerEl = null;
  let alarmaUnsubscribe = null;
  const serviceFlags = new Map();
  let alertsEnabled = false;

  // Vistas: desktop muestra ambos paneles; mobile alterna
  const root = document.body;
  const isDesktop = () => window.matchMedia("(min-width: 1024px)").matches;
  const rootEl = document.documentElement;
  function showPanel(name) {
    if (isDesktop()) {
      ensureMap();
      requestAnimationFrame(() => {
        try {
          map?.invalidateSize?.();
        } catch (e) {}
      });
      return;
    }
    const filtros = name === "filtros";
    root.classList.toggle("view-filtros", filtros);
    root.classList.toggle("view-lista", !filtros);
    setTimeout(() => {
      try {
        map?.invalidateSize?.();
      } catch (e) {}
    }, 60);
  }
  const mapPanel = document.querySelector(".map-panel");
  const btnFiltros = document.getElementById("btn-filtros");
  const btnFiltrosMobile = document.getElementById("btn-filtros-mobile");
  const filtersDrawer = document.getElementById("filters-drawer");
  const drawerCloseBtn = document.querySelector(".drawer-close");
  const mapOverlay = document.querySelector(".map-overlay");
  const filtersInlineHost = document.getElementById("filters-inline");
  const btnVerTodos = document.getElementById("btn-ver-todos");
  const btnAlarmaPush = document.getElementById("btn-alarma-push-admin");
  const btnAudioOptin = document.getElementById("btn-audio-optin");
  const audioBtnDefaultLabel = btnAudioOptin ? btnAudioOptin.innerHTML : "";
  const audioBtnActiveLabel =
    '<i class="material-icons">volume_up</i> Sonido activo';
  if (btnAudioOptin && window.Alarma?.getPermissions) {
    const perms = window.Alarma.getPermissions();
    if (perms?.sound) {
      alertsEnabled = true;
      btnAudioOptin.disabled = true;
      btnAudioOptin.innerHTML = audioBtnActiveLabel;
    }
  }
  btnVerTodos?.addEventListener("click", () => {
    try {
      selectedId = null;
      filtersInlineHost?.classList.remove("open");
      btnFiltrosMobile?.setAttribute("aria-expanded", "false");
    } catch (e) {}
    loadServices();
  });
  function openFiltersDrawer() {
    if (!filtersDrawer || !mapPanel) return;
    mapPanel.classList.add("filters-open");
    btnFiltros?.setAttribute("aria-expanded", "true");
    filtersDrawer?.setAttribute("aria-hidden", "false");
    if (mapOverlay) mapOverlay.hidden = false;
    // invalidate after transition
    const t = setTimeout(() => {
      try {
        map?.invalidateSize?.();
      } catch (e) {}
    }, 260);
    const onEnd = (e) => {
      if (e.propertyName === "transform") {
        try {
          map?.invalidateSize?.();
        } catch (e) {}
        clearTimeout(t);
        filtersDrawer.removeEventListener("transitionend", onEnd);
      }
    };
    filtersDrawer.addEventListener("transitionend", onEnd);
  }
  function closeFiltersDrawer() {
    if (!filtersDrawer || !mapPanel) return;
    mapPanel.classList.remove("filters-open");
    btnFiltros?.setAttribute("aria-expanded", "false");
    filtersDrawer?.setAttribute("aria-hidden", "true");
    if (mapOverlay) mapOverlay.hidden = true;
    const t = setTimeout(() => {
      try {
        map?.invalidateSize?.();
      } catch (e) {}
    }, 260);
    const onEnd = (e) => {
      if (e.propertyName === "transform") {
        try {
          map?.invalidateSize?.();
        } catch (e) {}
        clearTimeout(t);
        filtersDrawer.removeEventListener("transitionend", onEnd);
      }
    };
    filtersDrawer.addEventListener("transitionend", onEnd);
  }
  btnFiltros?.addEventListener("click", (e) => {
    e.preventDefault();
    openFiltersDrawer();
  });
  btnFiltrosMobile?.addEventListener("click", (e) => {
    e.preventDefault();
    toggleInlineFilters();
  });
  drawerCloseBtn?.addEventListener("click", () => closeFiltersDrawer());
  mapOverlay?.addEventListener("click", () => closeFiltersDrawer());
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      closeFiltersDrawer();
    }
  });
  if (isDesktop()) {
    ensureMap();
  } else {
    root.classList.add("view-lista");
  }
  window.addEventListener("resize", () => {
    if (isDesktop()) {
      root.classList.remove("view-lista", "view-filtros");
      ensureMap();
      ensureSidebarResizer();
      relocateFilters();
      requestAnimationFrame(() => {
        try {
          map?.invalidateSize?.();
        } catch (e) {}
      });
    }
  });

  // Sidebar width: resizable on desktop and persisted
  const SIDEBAR_KEY = "admin.sidebarW";
  const SIDEBAR_MIN = 280,
    SIDEBAR_MAX = 520;
  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }
  function setSidebarWidth(px) {
    const v = clamp(Math.round(px), SIDEBAR_MIN, SIDEBAR_MAX);
    rootEl.style.setProperty("--sidebar-w", v + "px");
    try {
      localStorage.setItem(SIDEBAR_KEY, String(v));
    } catch (e) {}
  }
  (function initSidebarWidthFromStorage() {
    try {
      const saved = parseInt(localStorage.getItem(SIDEBAR_KEY), 10);
      if (!isNaN(saved) && saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX) {
        rootEl.style.setProperty("--sidebar-w", saved + "px");
      }
    } catch (e) {}
  })();
  function ensureSidebarResizer() {
    if (!isDesktop()) return; // only desktop
    const sidebar = document.querySelector(".sidebar");
    if (!sidebar) return;
    let resizer = sidebar.querySelector(".sidebar-resizer");
    if (!resizer) {
      resizer = document.createElement("div");
      resizer.className = "sidebar-resizer";
      resizer.setAttribute("role", "separator");
      resizer.setAttribute("aria-orientation", "vertical");
      resizer.tabIndex = 0;
      resizer.title = "Ajustar ancho";
      sidebar.appendChild(resizer);
    }
    // Pointer drag
    let dragging = false;
    let startX = 0;
    let startW = 0;
    const onDown = (e) => {
      if (!isDesktop()) return;
      dragging = true;
      root.classList.add("is-resizing");
      const rect = sidebar.getBoundingClientRect();
      startX = e.touches?.[0]?.clientX ?? e.clientX;
      const cs = getComputedStyle(rootEl);
      const current =
        parseInt(cs.getPropertyValue("--sidebar-w"), 10) || rect.width;
      startW = current;
      e.preventDefault();
      window.addEventListener("mousemove", onMove);
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("mouseup", onUp);
      window.addEventListener("touchend", onUp);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const x = e.touches?.[0]?.clientX ?? e.clientX;
      const dx = x - startX;
      setSidebarWidth(startW + dx);
      e.preventDefault();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      root.classList.remove("is-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
    };
    resizer.onmousedown = onDown;
    resizer.ontouchstart = onDown;
    // Keyboard accessibility
    resizer.onkeydown = (ev) => {
      if (ev.key === "ArrowLeft") {
        setSidebarWidth(
          (parseInt(getComputedStyle(rootEl).getPropertyValue("--sidebar-w")) ||
            360) - 12
        );
        ev.preventDefault();
      }
      if (ev.key === "ArrowRight") {
        setSidebarWidth(
          (parseInt(getComputedStyle(rootEl).getPropertyValue("--sidebar-w")) ||
            360) + 12
        );
        ev.preventDefault();
      }
    };
  }
  ensureSidebarResizer();

  // Filtros
  const fEstado = document.getElementById("f-estado");
  const fEmpresa = document.getElementById("f-empresa");
  const fTexto = document.getElementById("f-texto");
  document.getElementById("btn-aplicar").addEventListener("click", () => {
    selectedId = null;
    loadServices();
    if (isDesktop()) {
      closeFiltersDrawer();
    } else {
      filtersInlineHost?.classList.remove("open");
    }
  });
  document.getElementById("btn-reset").addEventListener("click", () => {
    fEstado.value = "ACTIVO";
    fEmpresa.value = "TODAS";
    fTexto.value = "";
    selectedId = null;
    loadServices();
    if (isDesktop()) {
      closeFiltersDrawer();
    } else {
      filtersInlineHost?.classList.remove("open");
    }
  });
  if (btnAlarmaPush) {
    if (!hasAlarma || !hasPushKey) {
      btnAlarmaPush.disabled = true;
      btnAlarmaPush.title = hasAlarma
        ? "Configura APP_CONFIG.WEB_PUSH_PUBLIC_KEY para habilitar push"
        : "Modulo de alarma no disponible";
    }
    btnAlarmaPush.addEventListener("click", async (ev) => {
      ev.preventDefault();
      if (!hasAlarma) {
        showMsg("Modulo de alarma no disponible");
        return;
      }
      if (!hasPushKey) {
        showMsg("Clave VAPID no configurada. Contacta a soporte.");
        return;
      }
      btnAlarmaPush.disabled = true;
      btnAlarmaPush.classList.add("is-working");
      try {
        unlockAudio();
        const empresaFiltro =
          fEmpresa?.value && fEmpresa.value !== "TODAS" ? fEmpresa.value : null;
        await window.Alarma.registerPush("admin", empresaFiltro, {
          origen: "dashboard-admin",
        });
        showMsg("Alertas activadas para administrador.");
      } catch (err) {
        console.warn("[alarma] registerPush admin", err);
        showMsg("No se pudo activar push. Intenta mas tarde.");
        btnAlarmaPush.disabled = false;
      } finally {
        btnAlarmaPush.classList.remove("is-working");
      }
    });
  }

  btnAudioOptin?.addEventListener("click", async () => {
    if (alertsEnabled) {
      showMsg("El sonido ya esta habilitado.");
      return;
    }
    if (!window.Alarma?.enableAlerts) {
      showMsg("Modulo de alarmas no disponible.");
      return;
    }
    btnAudioOptin.disabled = true;
    try {
      const perms = await window.Alarma.enableAlerts({
        sound: true,
        haptics: true,
      });
      alertsEnabled = Boolean(perms?.sound);
      if (alertsEnabled) {
        unlockAudio();
        btnAudioOptin.disabled = true;
        btnAudioOptin.innerHTML = audioBtnActiveLabel;
        showMsg("Alertas sonoras activadas.");
      } else {
        showMsg("Activa sonido desde el navegador para continuar.");
      }
    } catch (err) {
      console.warn("[admin][audio] enable error", err);
      showMsg("No se pudo habilitar el sonido.");
    } finally {
      if (!alertsEnabled) {
        btnAudioOptin.disabled = false;
        btnAudioOptin.innerHTML = audioBtnDefaultLabel;
      }
    }
  });

  // UI refs
  // Tapping header title resets selection (mobile UX)
  const serviciosTitle = document.querySelector(".sidebar-head .lbl");
  serviciosTitle?.addEventListener("click", () => {
    if (selectedId) {
      selectedId = null;
      filtersInlineHost?.classList.remove("open");
      btnFiltrosMobile?.setAttribute("aria-expanded", "false");
      loadServices();
    }
  });
  const listado = document.getElementById("listado");
  const countLabel = document.getElementById("count-label");
  const mapTitle = document.getElementById("map-title");
  const metricPing = document.getElementById("metric-ping");
  const metricEstado = document.getElementById("metric-estado");
  const details = document.getElementById("details");

  // Mapa
  function initMap() {
    const options = {
      preferCanvas: true,
      zoomAnimation: false,
      markerZoomAnimation: false,
      wheelDebounceTime: 40,
    };
    map = L.map("map-admin", options);
    const tl = L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
        updateWhenIdle: true,
        updateWhenZooming: false,
        keepBuffer: 3,
        crossOrigin: true,
      }
    ).addTo(map);
    try {
      document.querySelector(".map-panel")?.classList.add("loading");
      tl.on("load", () => {
        document.querySelector(".map-panel")?.classList.remove("loading");
      });
    } catch (e) {}
    map.setView([-12.0464, -77.0428], 12);
    overviewLayer = L.layerGroup().addTo(map);
    focusLayer = L.layerGroup().addTo(map);
    routeLayerFocus = L.layerGroup().addTo(map);
    panicLayer = L.layerGroup().addTo(map);
    map.on("dragstart", () => {
      window.__adminFollow = false;
    });
    map.on("zoomstart", () => {
      window.__adminFollow = false;
    });
  }
  function ensureMap() {
    if (!map) {
      initMap();
    }
  }

  // Relocate filters between drawer (desktop) and inline (mobile)
  function relocateFilters() {
    if (!filtersDrawer) return;
    if (isDesktop()) {
      if (filtersDrawer.parentElement !== mapPanel)
        mapPanel.insertBefore(
          filtersDrawer,
          mapPanel.querySelector("#map-admin")
        );
      filtersInlineHost?.classList.remove("open");
    } else {
      if (
        filtersInlineHost &&
        filtersDrawer.parentElement !== filtersInlineHost
      )
        filtersInlineHost.appendChild(filtersDrawer);
      filtersInlineHost?.classList.remove("open");
    }
  }
  relocateFilters();

  function toggleInlineFilters() {
    if (!filtersInlineHost) return;
    const willOpen = !filtersInlineHost.classList.contains("open");
    filtersInlineHost.classList.toggle("open");
    btnFiltrosMobile?.setAttribute(
      "aria-expanded",
      willOpen ? "true" : "false"
    );
  }

  // Utilidades
  const POLL_MS = 30000;
  const STALE_MIN = 5;
  const beeped = new Set();
  const fmtDT = (iso) => {
    try {
      return new Intl.DateTimeFormat("es-PE", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/Lima",
      }).format(new Date(iso));
    } catch (e) {
      return iso || "";
    }
  };
  const minDiff = (a, b) => Math.round((a - b) / 60000);
  function normPing(row) {
    if (!row) return null;
    const lat = row.lat ?? row.latitude ?? row.latitud ?? row.y ?? null;
    const lng = row.lng ?? row.longitude ?? row.longitud ?? row.x ?? null;
    const created_at =
      row.captured_at ??
      row.created_at ??
      row.fecha ??
      row.ts ??
      row.updated_at ??
      null;
    if (lat == null || lng == null) return null;
    return { lat, lng, created_at };
  }
  function beep() {
    if (!audioUnlocked) return;
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    try {
      ctx.resume?.();
    } catch (e) {}
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.value = 0.0001;
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
      o.start();
      setTimeout(() => {
        try {
          g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
          o.stop(ctx.currentTime + 0.2);
        } catch (err) {}
      }, 160);
    } catch (err) {}
  }
  async function fetchRoute(from, to) {
    try {
      // sugerencia: mover a tracking-common.routeLocal y eliminar duplicado
      if (window.trackingCommon?.routeLocal)
        return await window.trackingCommon.routeLocal(from, to);
      if (window.routerLocal?.route)
        return await window.routerLocal.route(from, to);
      return null;
    } catch (e) {
      console.warn("[admin] local route error", e);
      return null;
    }
  }

  // Datos
  async function loadServices() {
    if (!window.sb) {
      showMsg("Supabase no inicializado");
      return;
    }
    try {
      const q = window.sb
        .from("servicio")
        .select(
          "id,empresa,placa,estado,tipo,created_at,destino_texto,destino_lat,destino_lng,cliente:cliente_id(nombre)"
        )
        .order("id", { ascending: false });
      if (fEstado.value !== "TODOS") q.eq("estado", fEstado.value);
      if (fEmpresa.value !== "TODAS") q.eq("empresa", fEmpresa.value);
      let { data, error } = await q;
      if (error) throw error;
      const texto = fTexto.value.trim().toUpperCase();
      if (texto) {
        data = (data || []).filter(
          (s) =>
            (s.placa || "").toUpperCase().includes(texto) ||
            (s.cliente?.nombre || "").toUpperCase().includes(texto)
        );
      }
      const servicioIds = (data || []).map((s) => s.id).filter(Boolean);
      const custodiosMap = await fetchCustodiosMap(servicioIds);
      const enriched = await Promise.all(
        (data || []).map(async (s) => {
          try {
            const { data: ping, error: pingErr } = await window.sb
              .from("ubicacion")
              .select("lat,lng,captured_at")
              .eq("servicio_id", s.id)
              .order("captured_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (pingErr) {
              console.warn("[admin] ubicacion query error", pingErr);
            }
            return {
              ...s,
              lastPing: ping || null,
              custodios: custodiosMap.get(s.id) || [],
            };
          } catch (e) {
            console.warn("[admin] ubicacion query exception", e);
            return { ...s, lastPing: null, custodios: custodiosMap.get(s.id) || [] };
          }
        })
      );
      const enrichedNorm = (enriched || []).map((s) => ({
        ...s,
        lastPing: normPing(s.lastPing),
        custodios: Array.isArray(s.custodios) ? s.custodios : [],
      }));
      servicesCache = enrichedNorm;
      servicesLoaded = true;
      renderList(enrichedNorm);
      updateMarkers(enrichedNorm.filter((x) => x.estado === "ACTIVO"));
      // Mantener seguimiento centrado en el admin: si hay seleccionado, actualizar foco y ruta
      if (selectedId) {
        const cur = enrichedNorm.find((x) => x.id === selectedId);
        if (cur) {
          showDetails(cur);
          try {
            await focusMarker(cur);
          } catch (e) {}
        }
      }
    } catch (e) {
      console.error(e);
      showMsg("No se pudieron cargar los servicios");
    }
  }

  function formatTitle(s) {
    const placa = (s.placa || "-").toString().toUpperCase();
    const cliente = (s.cliente?.nombre || "-").toString().toUpperCase();
    const tipo = (s.tipo || "-").toString().toUpperCase();
    return [placa, cliente, tipo].join(" · ");
  }

  async function fetchCustodiosMap(ids) {
    const map = new Map();
    const filtered = Array.isArray(ids) ? ids.filter(Boolean) : [];
    if (!filtered.length) return map;
    try {
      const { data, error } = await window.sb
        .from("servicio_custodio")
        .select("servicio_id,nombre_custodio,tipo_custodia")
        .in("servicio_id", filtered);
      if (error) throw error;
      for (const row of data || []) {
        const key = row.servicio_id;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(row);
      }
    } catch (err) {
      console.warn("[admin] custodios query error", err);
    }
    return map;
  }

  function describeCustodios(list) {
    if (!Array.isArray(list) || !list.length) return "Sin custodios";
    return list
      .map((c) => {
        const nombre = (c.nombre_custodio || "-").trim() || "-";
        const tipo = (c.tipo_custodia || "").trim();
        return tipo ? `${nombre} (${tipo})` : nombre;
      })
      .join(", ");
  }

  function updateServiceFlag(servicioId, flag, value) {
    if (!servicioId) return;
    const key = String(servicioId);
    const current = serviceFlags.get(key) || {};
    if (value) {
      current[flag] = true;
      serviceFlags.set(key, current);
    } else if (current[flag]) {
      delete current[flag];
      if (Object.keys(current).length) serviceFlags.set(key, current);
      else serviceFlags.delete(key);
    }
  }

  function renderAlertBadges(servicioId) {
    const flags = servicioId ? serviceFlags.get(String(servicioId)) : null;
    if (!flags) return "";
    const badges = [];
    if (flags.panic) badges.push('<span class="alarma-badge">PANICO</span>');
    if (flags.checkinPending) {
      badges.push(
        '<span class="alarma-badge alarma-badge--warn">CHECK-IN PENDIENTE</span>'
      );
    }
    return badges.join("");
  }

  function renderList(services) {
    listado.innerHTML = "";
    countLabel.textContent = services.length;
    if (!services.length) {
      listado.innerHTML = '<div class="card">Sin resultados.</div>';
      return;
    }
    services.forEach((s) => {
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.sid = s.id;
      if (s.id === selectedId) card.classList.add("active");
      const flags = serviceFlags.get(String(s.id));
      if (flags?.panic) card.classList.add("alarma-card--panic");
      if (flags?.checkinPending) card.classList.add("alarma-card--flash");
      const badgesHtml = renderAlertBadges(s.id) || "";
      const custodiosLabel = describeCustodios(s.custodios);
      let pingLabel = "-",
        pingClass = "ping-ok",
        alertNow = false;
      if (s.lastPing?.created_at) {
        const mins = minDiff(new Date(), new Date(s.lastPing.created_at));
        pingLabel = `${mins} min`;
        if (mins >= STALE_MIN && s.estado === "ACTIVO") {
          pingClass = "ping-warn";
          alertNow = true;
        }
      } else if (s.estado === "ACTIVO") {
        pingLabel = "sin datos";
        pingClass = "ping-warn";
        alertNow = true;
      }
      if (alertNow) {
        if (!beeped.has(s.id)) {
          beep();
          beeped.add(s.id);
        }
      } else {
        beeped.delete(s.id);
      }
      const tagClass =
        s.estado === "FINALIZADO"
          ? "t-final"
          : pingClass === "ping-warn"
          ? "t-alerta"
          : "t-activo";
      card.innerHTML = `
        <div class="title">
          <div>
            <strong>${h(formatTitle(s))}</strong>
            ${badgesHtml}
          </div>
          <span class="tag ${tagClass}">${h(s.estado)}</span>
        </div>
        <div class="meta"><span class="pill">${h(s.empresa)}</span></div>
        <div><strong>Destino:</strong> ${h(s.destino_texto || "-")}</div>
        <div><strong>Custodios:</strong> ${h(custodiosLabel)}</div>
        <div><strong>Tipo:</strong> ${h(s.tipo || "-")}</div>
        <div class="${pingClass}"><strong>Ultimo ping:</strong> ${pingLabel}</div>
        <div class="row-actions">
          <button class="btn" data-act="ver" data-id="${
            s.id
          }">Ver en mapa</button>
          <button class="btn btn-accent" data-act="fin" data-id="${s.id}" ${
        s.estado === "FINALIZADO" ? "disabled" : ""
      }>Finalizar</button>
        </div>`;
      card.addEventListener("click", async (e) => {
        const btn = e.target.closest("button[data-act]");
        if (!btn) {
          selectService(s);
          return;
        }
        if (btn.dataset.act === "ver") {
          selectService(s);
        } else if (btn.dataset.act === "fin") {
          await finalizarServicio(s);
        }
      });
      listado.appendChild(card);
    });
  }

  function refreshList() {
    if (servicesLoaded) {
      renderList(servicesCache);
    }
  }

  function selectService(s) {
    selectedId = s.id;
    for (const el of listado.querySelectorAll(".card"))
      el.classList.remove("active");
    const me = listado.querySelector(`.card[data-sid="${s.id}"]`);
    me?.classList.add("active");
    // Mobile UX: keep Servicios + Filtros visible; do not switch views
    focusMarker(s);
    showDetails(s);
    if (!isDesktop()) {
      // Asegura que el mapa sea visible en movil quitando vistas exclusivas
      try {
        document.body.classList.remove("view-lista", "view-filtros");
      } catch (e) {}
      try {
        filtersInlineHost?.classList.remove("open");
        btnFiltrosMobile?.setAttribute("aria-expanded", "false");
      } catch (e) {}
      try {
        document
          .querySelector(".map-panel")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) {}
    }
  }

  // Markers + fitBounds
  function updateMarkers(activos) {
    // sugerencia: este metodo comparte responsabilidades (gestion markers + layout bounds).
    // Conviene extraer markers a un gestor y dejar solo layout aquI o moverlo a tracking-common.
    ensureMap();
    if (!map) return;
    try {
      overviewLayer?.clearLayers();
    } catch (e) {}
    try {
      focusLayer?.clearLayers();
    } catch (e) {}
    try {
      routeLayerFocus?.clearLayers();
    } catch (e) {}
    for (const id of Array.from(markers.keys())) {
      if (!activos.find((s) => s.id === id)) {
        markers.get(id).remove();
        markers.delete(id);
      }
    }
    const bounds = [];
    activos.forEach((s) => {
      const p = s.lastPing;
      if (!p?.lat || !p?.lng) return;
      const label = `${h(formatTitle(s))}`;
      const popup = `<strong>${h(formatTitle(s))}</strong><br>Destino: ${h(
        s.destino_texto || "-"
      )}`;
      if (!markers.has(s.id)) {
        const m = L.marker([p.lat, p.lng], {
          title: label,
          icon: ICON.custodia,
          zIndexOffset: 200,
        }).addTo(focusLayer);
        m.bindPopup(popup);
        markers.set(s.id, m);
      } else {
        const m = markers.get(s.id);
        m.setLatLng([p.lat, p.lng]);
        m.setPopupContent(popup);
      }
      bounds.push([p.lat, p.lng]);
    });
    if (bounds.length) {
      if (window.__adminFollow !== false) {
        const b = L.latLngBounds(bounds);
        map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
      }
    } else {
      map.setView([-12.0464, -77.0428], 12);
    }
  }

  let selectionLayer = null;
  let lastRouteSig = "";
  async function focusMarker(s) {
    // sugerencia: extraer esta funcion a tracking-common.drawRouteWithPOIs + tracking-common.routeLocal
    // para reutilizar en la vista de resguardo sin duplicar.
    ensureMap();
    if (!map) return;
    try {
      overviewLayer?.clearLayers();
    } catch (e) {}
    try {
      focusLayer?.clearLayers();
    } catch (e) {}
    try {
      routeLayerFocus?.clearLayers();
    } catch (e) {}
    const p = s.lastPing;
    if (!p?.lat || !p?.lng) return;
    const label = `${h(formatTitle(s))}`;
    const popup = `<strong>${h(formatTitle(s))}</strong><br>Destino: ${h(
      s.destino_texto || "-"
    )}`;
    let m = markers.get(s.id);
    if (!m) {
      m = L.marker([p.lat, p.lng], {
        title: label,
        icon: ICON.custodia,
        zIndexOffset: 200,
      }).addTo(focusLayer);
      m.bindPopup(popup);
      markers.set(s.id, m);
    } else {
      m.setLatLng([p.lat, p.lng]);
      m.setPopupContent(popup);
    }
    // Limpia capa anterior y dibuja ruta/POIs
    const start = [p.lat, p.lng];
    const hasDestino = s.destino_lat != null && s.destino_lng != null;
    L.marker(start, {
      icon: ICON.custodia,
      title: "Partida/Actual",
      zIndexOffset: 200,
    })
      .bindTooltip("Partida/Actual")
      .addTo(focusLayer);
    if (hasDestino) {
      const dest = [s.destino_lat, s.destino_lng];
      L.marker(dest, {
        icon: ICON.destino,
        title: "Destino",
        zIndexOffset: 120,
      })
        .bindTooltip("Destino")
        .addTo(focusLayer);
      const route = await fetchRoute(start, dest);
      if (route && route.length) {
        L.polyline(route, { color: "#1e88e5", weight: 4, opacity: 0.95 }).addTo(
          routeLayerFocus
        );
        const sig =
          String(route[0]) +
          "|" +
          String(route[route.length - 1]) +
          "|" +
          route.length;
        if (sig !== lastRouteSig) {
          lastRouteSig = sig;
          beep();
        }
        const b = L.latLngBounds(route);
        map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
      } else {
        L.polyline([start, dest], {
          color: "#455a64",
          weight: 3,
          opacity: 0.85,
          dashArray: "6,4",
        }).addTo(routeLayerFocus);
        const b = L.latLngBounds([start, dest]);
        map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
      }
    } else {
      map.setView(m.getLatLng(), 15);
    }
    try {
      m.openPopup();
    } catch (e) {}
  }
  function showDetails(s) {
    mapTitle.textContent = formatTitle(s);
    if (s.lastPing?.created_at) {
      const mins = minDiff(new Date(), new Date(s.lastPing.created_at));
      metricPing.textContent = `${mins} min`;
      metricPing.className =
        mins >= STALE_MIN && s.estado === "ACTIVO" ? "ping-warn" : "ping-ok";
    } else {
      metricPing.textContent = s.estado === "ACTIVO" ? "sin datos" : "-";
      metricPing.className = s.estado === "ACTIVO" ? "ping-warn" : "";
    }
    metricEstado.textContent = s.estado;
    const custodiosTexto = describeCustodios(s.custodios);
    details.innerHTML = `<div><strong>Empresa:</strong> ${
      s.empresa
    }</div><div><strong>Cliente:</strong> ${
      s.cliente?.nombre || "-"
    }</div><div><strong>Placa:</strong> ${
      s.placa || "-"
    }</div><div><strong>Tipo:</strong> ${
      s.tipo || "-"
    }</div><div><strong>Destino:</strong> ${
      s.destino_texto || "-"
    }</div><div><strong>Custodios:</strong> ${h(
      custodiosTexto
    )}</div><div><strong>Creado:</strong> ${fmtDT(
      s.created_at
    )}</div><div><button id="btn-finalizar" class="mdl-button mdl-js-button mdl-button--raised mdl-button--accent" ${
      s.estado === "FINALIZADO" ? "disabled" : ""
    }>Finalizar servicio</button></div>`;
    document
      .getElementById("btn-finalizar")
      ?.addEventListener("click", async () => {
        await finalizarServicio(s);
      });
  }
  async function finalizarServicio(servicio) {
    const serviceObj =
      typeof servicio === "object"
        ? servicio
        : servicesCache.find((item) => item.id === servicio) || { id: servicio };
    const id = serviceObj?.id;
    if (!id) return;
    const title = serviceObj.placa ? formatTitle(serviceObj) : `el servicio ${id}`;
    const ok = confirm(`Finalizar ${title}?`);
    if (!ok) return;
    try {
      const { error } = await window.sb
        .from("servicio")
        .update({ estado: "FINALIZADO" })
        .eq("id", id);
      if (error) throw error;
      showMsg("Servicio finalizado");
      await loadServices();
    } catch (e) {
      console.error(e);
      showMsg("No se pudo finalizar el servicio");
    }
  }

  // --- Integracion de alertas de panico (Alarma) ---
  function initAlarmaIntegration() {
    if (!hasAlarma || typeof window.Alarma?.initAdmin !== "function") return;
    try {
      window.Alarma.initAdmin();
      alarmaUnsubscribe = window.Alarma.subscribe(handleAlarmaEvent);
    } catch (err) {
      console.warn("[admin][alarma] init error", err);
    }
  }

  function handleAlarmaEvent(evt) {
    if (!evt) return;
    if (evt.type === "panic") {
      lastPanicRecord = evt.record || evt.payload || evt;
      console.log("[admin][push] recibido panic", {
        servicio_id: lastPanicRecord?.servicio_id,
        cliente: lastPanicRecord?.cliente,
        placa: lastPanicRecord?.placa,
      });
      if (lastPanicRecord?.servicio_id) {
        updateServiceFlag(lastPanicRecord.servicio_id, "panic", true);
        refreshList();
      }
      showPanicBanner(lastPanicRecord);
      focusPanicOnMap(lastPanicRecord, { forceReload: true });
      try {
        window.Alarma.modalPanic?.(lastPanicRecord);
      } catch (err) {
        console.warn("[admin][alarma] modal panic", err);
      }
      try {
        navigator.vibrate?.([240, 120, 240, 140, 320]);
      } catch (_) {}
    } else if (evt.type === "panic-focus" && lastPanicRecord) {
      focusPanicOnMap(lastPanicRecord, { forceReload: false });
    } else if (evt.type === "panic-ack") {
      const servicioId = lastPanicRecord?.servicio_id;
      dismissPanicAlert();
      if (servicioId) {
        updateServiceFlag(servicioId, "panic", false);
        refreshList();
      }
    }
    if (evt.type === "checkin_missed" && evt.record?.servicio_id) {
      updateServiceFlag(evt.record.servicio_id, "checkinPending", true);
      refreshList();
    } else if (evt.type === "checkin_ok" && evt.record?.servicio_id) {
      updateServiceFlag(evt.record.servicio_id, "checkinPending", false);
      refreshList();
    }
  }

  function formatPanicLocation(record) {
    if (record?.direccion) return record.direccion;
    if (record?.lat != null && record?.lng != null) {
      return `${record.lat.toFixed(4)}, ${record.lng.toFixed(4)}`;
    }
    if (record?.metadata?.lat && record?.metadata?.lng) {
      const { lat, lng } = record.metadata;
      return `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;
    }
    return "Sin ubicacion";
  }

  function ensurePanicBanner() {
    if (panicBannerEl) return panicBannerEl;
    const el = document.createElement("section");
    el.className = "panic-banner";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "assertive");
    el.innerHTML = `
      <div class="panic-banner__head">
        <div>
          <div class="panic-banner__eyebrow">ALERTA DE PANICO</div>
          <div class="panic-banner__title js-panic-title">-</div>
          <div class="panic-banner__meta js-panic-meta"></div>
        </div>
        <button type="button" class="panic-banner__close js-panic-close" aria-label="Cerrar alerta">&times;</button>
      </div>
      <div class="panic-banner__body">
        <div><strong>Cliente:</strong> <span class="js-panic-cliente">-</span></div>
        <div><strong>Placa:</strong> <span class="js-panic-placa">-</span></div>
        <div><strong>Empresa:</strong> <span class="js-panic-empresa">-</span></div>
        <div><strong>Ubicacion:</strong> <span class="js-panic-location">-</span></div>
      </div>
      <div class="panic-banner__actions">
        <button type="button" class="btn btn-ghost js-panic-focus">Fijar en mapa</button>
        <button type="button" class="btn btn-accent js-panic-silence">Silenciar</button>
      </div>
    `;
    el.querySelector(".js-panic-focus")?.addEventListener("click", () => {
      if (lastPanicRecord) focusPanicOnMap(lastPanicRecord, { forceReload: false });
    });
    el.querySelector(".js-panic-silence")?.addEventListener("click", () => {
      try {
        window.Alarma?.sirenaOff?.();
      } catch (_) {}
      hidePanicBanner();
    });
    el.querySelector(".js-panic-close")?.addEventListener("click", () => {
      hidePanicBanner();
    });
    document.body.appendChild(el);
    panicBannerEl = el;
    return el;
  }

  function showPanicBanner(record) {
    const el = ensurePanicBanner();
    el.querySelector(".js-panic-title").textContent =
      record?.cliente ? `ALERTA - ${record.cliente}` : "ALERTA DE PANICO";
    el.querySelector(".js-panic-meta").textContent = fmtDT(
      record?.timestamp || new Date().toISOString()
    );
    el.querySelector(".js-panic-cliente").textContent = record?.cliente || "-";
    el.querySelector(".js-panic-placa").textContent = record?.placa || "-";
    el.querySelector(".js-panic-empresa").textContent =
      record?.empresa || "GENERAL";
    el.querySelector(".js-panic-location").textContent =
      formatPanicLocation(record);
    el.classList.add("is-visible");
    document.body.classList.add("panic-banner-visible");
  }

  function hidePanicBanner() {
    if (!panicBannerEl) return;
    panicBannerEl.classList.remove("is-visible");
    document.body.classList.remove("panic-banner-visible");
  }

  function dismissPanicAlert() {
    hidePanicBanner();
    clearPanicMarker();
    lastPanicRecord = null;
    try {
      window.Alarma?.closeModal?.();
    } catch (_) {}
  }

  function focusPanicOnMap(record, options = {}) {
    if (!record) return;
    ensureMap();
    const layer = ensurePanicLayer();
    layer?.clearLayers();
    if (record.lat != null && record.lng != null && map) {
      panicMarker = L.circleMarker([record.lat, record.lng], {
        radius: 16,
        color: "#ff1744",
        fillColor: "#ff5252",
        fillOpacity: 0.75,
        weight: 3,
        className: "panic-marker",
      }).addTo(layer);
      map.setView([record.lat, record.lng], 15, { animate: true });
    }
    if (record.servicio_id) {
      const svc = servicesCache.find((s) => s.id === record.servicio_id);
      if (svc) {
        selectService(svc);
      } else if (options.forceReload) {
        loadServices()
          .then(() => {
            const refreshed = servicesCache.find(
              (s) => s.id === record.servicio_id
            );
            if (refreshed) selectService(refreshed);
          })
          .catch(() => {});
      }
    }
    try {
      mapPanel?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (_) {}
  }

  function ensurePanicLayer() {
    ensureMap();
    if (!panicLayer && map) {
      panicLayer = L.layerGroup().addTo(map);
    }
    return panicLayer;
  }

  function clearPanicMarker() {
    if (panicLayer) panicLayer.clearLayers();
    panicMarker = null;
  }

  // Realtime: subscribe to servicio INSERT/UPDATE and ubicacion INSERT, with debounce
  function debounce(fn, ms) {
    let t = 0;
    return () => {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }
  const scheduleRefresh = debounce(() => {
    try {
      loadServices();
    } catch (e) {}
  }, 150);
  let rtServicio = null,
    rtUbicacion = null;
  function setupRealtime() {
    if (!window.sb?.channel) {
      // fallback polling
      setInterval(loadServices, 30000);
      loadServices();
      return;
    }
    try {
      rtServicio = window.sb
        .channel("rt-servicio-admin")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "servicio" },
          () => scheduleRefresh()
        )
        .subscribe();
    } catch (e) {
      setInterval(loadServices, 30000);
    }
    try {
      rtUbicacion = window.sb
        .channel("rt-ubicacion-admin")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "ubicacion" },
          () => scheduleRefresh()
        )
        .subscribe();
    } catch (e) {}
    window.addEventListener("beforeunload", () => {
      try {
        if (rtServicio) window.sb.removeChannel(rtServicio);
      } catch (e) {}
      try {
        if (rtUbicacion) window.sb.removeChannel(rtUbicacion);
      } catch (e) {}
      try {
        alarmaUnsubscribe?.();
      } catch (e) {}
    });
    loadServices();
  }
  setupRealtime();
  initAlarmaIntegration();
});
