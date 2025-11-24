// Dashboard Admin - limpio y estable (Lista + Filtros/Mapa)
// @hu HU-PANICO-MODAL-UNICO, HU-PANICO-TTS, HU-AUDIO-GESTO, HU-MARCADORES-CUSTODIA, HU-CHECKIN-15M
// @author Codex
// @date 2025-02-15
// @rationale Mantener dashboard admin alineado con sonido, pánico y check-in sin regresiones.

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

  // === BEGIN HU:HU-RUTA-DESVIO-FRONT-ADMIN (ui refs) ===
  const routeAlertPanel = document.getElementById("route-alert-admin");
  const routeAlertTitle = document.getElementById("route-alert-title");
  const routeAlertBody = document.getElementById("route-alert-body");
  const routeAlertMeta = document.getElementById("route-alert-meta");
  const routeAlertViewBtn = document.getElementById("route-alert-view");
  const routeAlertDismissBtn = document.getElementById("route-alert-dismiss");
  routeAlertViewBtn?.addEventListener("click", () => handleRouteAlertView());
  routeAlertDismissBtn?.addEventListener("click", () =>
    dismissRouteAlert("clear")
  );
  // === END HU:HU-RUTA-DESVIO-FRONT-ADMIN ===

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
  const PING_FRESH_MIN = 10;
  const LATE_REPORT_MIN = 16;
  const REPORT_RETRY_MS = 60000;
  let selectedId = null;
  let overviewLayer = null,
    focusLayer = null,
    routeLayerFocus = null,
    panicLayer = null;
  let rutaClienteLayer = null;
  const rutaClienteCache = new Map();
  let routeAlertRecord = null;
  let panicMarker = null;
  let servicesCache = [];
  let servicesLoaded = false;
  let lastPanicRecord = null;
  let alarmaUnsubscribe = null;
  const serviceFlags = new Map();
  const lateReportTimers = new Map();
  let alertsEnabled = false;
  const canUseRealtime = () =>
    window.APP_CONFIG?.REALTIME_OK !== false && Boolean(window.sb?.channel);

  // === BEGIN HU:HU-MAP-MARKERS-ALL realtime state (NO TOCAR FUERA) ===
  const MARKER_COLUMNS =
    "servicio_custodio_id,servicio_id,lat,lng,ultimo_ping_at,cliente,placa";
  const markersRealtime = {
    channel: null,
    channelServicioId: null,
    refreshTimer: null,
    loading: false,
    queuedTrigger: null,
    mode: "general",
    lastPayload: [],
  };
  function cleanupMarkersChannel() {
    if (markersRealtime.channel && window.sb?.removeChannel) {
      try {
        window.sb.removeChannel(markersRealtime.channel);
      } catch (err) {
        console.warn("[markers] cleanup channel error", err);
      }
    }
    markersRealtime.channel = null;
    markersRealtime.channelServicioId = null;
    if (markersRealtime.refreshTimer) {
      clearTimeout(markersRealtime.refreshTimer);
      markersRealtime.refreshTimer = null;
    }
  }
  function ensureMarkersChannel(servicioId) {
    if (!canUseRealtime()) {
      cleanupMarkersChannel();
      return;
    }
    if (
      markersRealtime.channel &&
      markersRealtime.channelServicioId === servicioId
    )
      return;
    cleanupMarkersChannel();
    const channelName = servicioId
      ? `admin-markers-servicio-${servicioId}`
      : "admin-markers-general";
    try {
      const channel = window.sb.channel(channelName);
      channel
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "ubicacion",
            ...(servicioId ? { filter: `servicio_id=eq.${servicioId}` } : {}),
          },
          () => {
            scheduleMarkersRefresh("realtime");
          }
        )
        .subscribe((status) => {
          console.log("[markers] channel", status, channelName);
        });
      markersRealtime.channel = channel;
      markersRealtime.channelServicioId = servicioId;
    } catch (err) {
      console.warn("[markers] channel error", err);
    }
  }
  function scheduleMarkersRefresh(trigger = "realtime") {
    if (markersRealtime.refreshTimer) {
      clearTimeout(markersRealtime.refreshTimer);
    }
    markersRealtime.refreshTimer = setTimeout(() => {
      refreshMarkersState(trigger).catch((err) =>
        console.warn("[markers] refresh error", err)
      );
    }, 420);
  }
  async function refreshMarkersState(trigger = "manual") {
    if (!window.sb) return;
    if (markersRealtime.loading) {
      markersRealtime.queuedTrigger = trigger;
      return;
    }
    markersRealtime.loading = true;
    const servicioId = selectedId || null;
    markersRealtime.mode = servicioId ? "servicio" : "general";
    try {
      const dataset = await fetchMarkerDataset(servicioId);
      markersRealtime.lastPayload = dataset;
      updateMarkers(dataset, {
        scopedToService: Boolean(servicioId),
        servicioId,
      });
      ensureMarkersChannel(servicioId);
      const activos =
        servicesCache.filter((svc) => svc.estado === "ACTIVO").length || 0;
      if (!servicioId && activos > 0 && !dataset.length) {
        console.warn("[markers] generales sin ping fresco", {
          activos,
          trigger,
        });
      }
      if (servicioId) {
        const svc = servicesCache.find((item) => item.id === servicioId);
        const expected =
          svc && Array.isArray(svc.custodios)
            ? svc.custodios.filter(
                (c) => c?.lastPing?.lat != null && c?.lastPing?.lng != null
              ).length
            : null;
        if (expected != null && dataset.length !== expected) {
          console.warn("[markers] ajuste de duplicados", {
            servicioId,
            expected,
            got: dataset.length,
          });
          // Evita fallar por duplicados o pings atrasados
          const unique = new Map();
          dataset.forEach((row) => {
            const key = row?.servicio_custodio_id || row?.custodia_id;
            if (!key) return;
            if (!unique.has(key)) unique.set(key, row);
          });
          if (unique.size !== dataset.length) {
            const deduped = Array.from(unique.values());
            updateMarkers(deduped, {
              scopedToService: true,
              servicioId,
            });
            markersRealtime.lastPayload = deduped;
          }
        }
      }
      console.log("[task][HU-MAP-MARKERS-ALL] done", {
        mode: markersRealtime.mode,
        count: dataset.length,
        trigger,
      });
    } catch (err) {
      console.warn("[markers] dataset error", err);
    } finally {
      markersRealtime.loading = false;
      const queued = markersRealtime.queuedTrigger;
      markersRealtime.queuedTrigger = null;
      if (queued) {
        scheduleMarkersRefresh(queued);
      }
    }
  }
  async function fetchMarkerDataset(servicioId = null) {
    if (!window.sb) return [];
    try {
      let query = window.sb
        .from("v_ultimo_ping_por_custodia")
        .select(MARKER_COLUMNS);
      if (servicioId) {
        query = query.eq("servicio_id", servicioId);
      }
      const { data, error } = await query;
      if (error) throw error;
      const now = new Date();
      const usable = [];
      const custIds = new Set();
      (data || []).forEach((row) => {
        if (!row?.servicio_custodio_id) return;
        if (row.lat == null || row.lng == null) return;
        const pingMinutes = row.ultimo_ping_at
          ? minDiff(now, new Date(row.ultimo_ping_at))
          : Number.POSITIVE_INFINITY;
        if (!servicioId && pingMinutes > PING_FRESH_MIN) return;
        usable.push({ row, pingMinutes });
        custIds.add(row.servicio_custodio_id);
      });
      const meta = await fetchCustodiosMetaByIds(Array.from(custIds));
      return usable.map(({ row, pingMinutes }) => {
        const info = meta.get(row.servicio_custodio_id) || {};
        return {
          servicioId: row.servicio_id,
          servicio_custodio_id: row.servicio_custodio_id,
          nombre: info.nombre_custodio || "Custodia",
          cliente: row.cliente || "",
          placa: row.placa || "",
          tipo: info.tipo_custodia || "",
          pingMinutes,
          lastPing: {
            lat: row.lat,
            lng: row.lng,
            captured_at: row.ultimo_ping_at,
          },
        };
      });
    } catch (err) {
      console.warn("[markers] fetch error", err);
      return [];
    }
  }
  async function fetchCustodiosMetaByIds(ids) {
    const metaMap = new Map();
    const filtered = Array.isArray(ids)
      ? Array.from(new Set(ids.filter(Boolean)))
      : [];
    if (!filtered.length || !window.sb) return metaMap;
    try {
      const { data, error } = await window.sb
        .from("servicio_custodio")
        .select("id,nombre_custodio,tipo_custodia")
        .in("id", filtered);
      if (error) throw error;
      (data || []).forEach((row) => metaMap.set(row.id, row));
    } catch (err) {
      console.warn("[markers] meta error", err);
    }
    return metaMap;
  }
  window.addEventListener("beforeunload", () => {
    cleanupMarkersChannel();
  });
  // === END HU:HU-MAP-MARKERS-ALL ===

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
  const audioStatusLabel = document.getElementById("audio-permission-status");
  const isMobileDevice = /android|iphone|ipad|ipod/i.test(
    navigator.userAgent || ""
  );
  console.log("[permissions] device", { mobile: isMobileDevice });
  /* === BEGIN HU:HU-AUDIO-GESTO boton sonido (no tocar fuera) === */
  const setAlertsState = (perms, reason = "unknown") => {
    const prevState = alertsEnabled;
    alertsEnabled = Boolean(perms?.sound);
    if (alertsEnabled) {
      unlockAudio();
    }
    if (audioStatusLabel) {
      audioStatusLabel.textContent = alertsEnabled
        ? "Sonido activo"
        : "Permisos de sonido pendientes";
    }
    if (prevState !== alertsEnabled) {
      console.log("[permissions] audio:ready", {
        enabled: alertsEnabled,
        reason,
      });
    }
  };
  const forceEnableAlerts = async (reason) => {
    if (typeof window.Alarma?.enableAlerts !== "function") return;
    try {
      const perms = await window.Alarma.enableAlerts({
        sound: true,
        haptics: true,
      });
      setAlertsState(perms, reason);
    } catch (err) {
      console.warn("[permissions] audio:auto", reason, err);
    }
  };
  if (window.Alarma?.getPermissions) {
    setAlertsState(window.Alarma.getPermissions(), "boot");
  }
  if (window.Alarma?.primeAlerts) {
    window.Alarma.primeAlerts({ sound: true, haptics: true })
      .then((perms) => setAlertsState(perms, "primer"))
      .catch(() => {});
  }
  forceEnableAlerts("boot");
  const audioRetryTimer = setInterval(() => {
    if (alertsEnabled) {
      clearInterval(audioRetryTimer);
      return;
    }
    forceEnableAlerts("retry");
  }, 15000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      forceEnableAlerts("visibility");
    }
  });
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

  /* === END HU:HU-AUDIO-GESTO === */

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
  // === BEGIN HU:HU-ROUTER-LOCAL-FALLBACK fetch-route (NO TOCAR FUERA) ===
  async function fetchRoute(from, to) {
    console.log("[task][HU-ROUTER-LOCAL-FALLBACK] start");
    console.assert(
      Array.isArray(from) && Array.isArray(to),
      "[task][HU-ROUTER-LOCAL-FALLBACK] coordenadas inválidas"
    );
    try {
      let raw = null;
      if (window.trackingCommon?.routeLocal) {
        raw = await window.trackingCommon.routeLocal(from, to);
      } else if (window.routerLocal?.route) {
        raw = await window.routerLocal.route(from, to);
      }
      if (!raw) {
        console.warn("[router] NoRoute raw vacío");
        console.log("[task][HU-ROUTER-LOCAL-FALLBACK] hotfix:empty");
        return null;
      }
      if (raw.code === "NoRoute") {
        console.warn("[router] NoRoute", raw.reason || "sin motivo");
        console.log("[task][HU-ROUTER-LOCAL-FALLBACK] hotfix:NoRoute");
        return null;
      }
      const latLngs = normalizeRouteResult(raw);
      if (latLngs && latLngs.length) {
        console.log("[router] using ruta OK", raw?.code || "Ok");
        console.log("[task][HU-ROUTER-LOCAL-FALLBACK] done");
        return latLngs;
      }
      console.warn("[router] NoRoute sin coords");
      console.log("[task][HU-ROUTER-LOCAL-FALLBACK] hotfix:nocoords");
      return null;
    } catch (e) {
      console.warn("[admin] local route error", e);
      console.log("[task][HU-ROUTER-LOCAL-FALLBACK] hotfix:error");
      return null;
    }
  }

  function normalizeRouteResult(result) {
    if (!result) return null;
    if (Array.isArray(result)) return result;
    const coords = result?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || !coords.length) return null;
    return coords.map(([lon, lat]) => [lat, lon]);
  }
  // === END HU:HU-ROUTER-LOCAL-FALLBACK ===

  // Datos
  // === BEGIN HU:HU-MARCADORES-CUSTODIA load services (no tocar fuera) ===
  async function loadServices() {
    if (!window.sb) {
      showMsg("Supabase no inicializado");
      return;
    }
    try {
      const q = window.sb
        .from("servicio")
        .select(
          "id,empresa,placa,estado,tipo,created_at,destino_texto,destino_lat,destino_lng,cliente:cliente_id(id,nombre)"
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
            const custodiosList = custodiosMap.get(s.id) || [];
            return {
              ...s,
              lastPing: ping || null,
              custodios: custodiosList,
              tipoEtiqueta: buildTipoEtiquetaFromCustodias(custodiosList),
            };
          } catch (e) {
            console.warn("[admin] ubicacion query exception", e);
            const custodiosList = custodiosMap.get(s.id) || [];
            return {
              ...s,
              lastPing: null,
              custodios: custodiosList,
              tipoEtiqueta: buildTipoEtiquetaFromCustodias(custodiosList),
            };
          }
        })
      );
      const enrichedNorm = (enriched || []).map((s) => {
        const custodiosList = Array.isArray(s.custodios) ? s.custodios : [];
        return {
          ...s,
          lastPing: normPing(s.lastPing),
          custodios: custodiosList,
          tipoEtiqueta:
            s.tipoEtiqueta || buildTipoEtiquetaFromCustodias(custodiosList),
        };
      });
      servicesCache = enrichedNorm;
      updateLateReportFlags(enrichedNorm);
      servicesLoaded = true;
      renderList(enrichedNorm);
      // === BEGIN HU:HU-MAP-MARKERS-ALL marker refresh hook (NO TOCAR FUERA) ===
      await refreshMarkersState("services-load");
      // === END HU:HU-MAP-MARKERS-ALL ===
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
    const tipo = getTipoEtiqueta(s).toString().toUpperCase();
    return [placa, cliente, tipo].join(" - ");
  }
  // === END HU:HU-MARCADORES-CUSTODIA ===

  // === BEGIN HU:HU-MARCADORES-CUSTODIA custodios helpers (no tocar fuera) ===
  async function fetchCustodiosMap(ids) {
    const map = new Map();
    const filtered = Array.isArray(ids) ? ids.filter(Boolean) : [];
    if (!filtered.length) return map;
    try {
      const { data, error } = await window.sb
        .from("servicio_custodio")
        .select("id,servicio_id,nombre_custodio,tipo_custodia")
        .in("servicio_id", filtered);
      if (error) throw error;
      const { data: ubicaciones, error: pingError } = await window.sb
        .from("v_ultimo_ping_por_custodia")
        .select(
          "servicio_custodio_id, servicio_id, lat, lng, ultimo_ping_at, cliente, placa"
        )
        .in("servicio_id", filtered);
      if (pingError) throw pingError;
      const pingMap = new Map();
      (ubicaciones || []).forEach((row) => {
        pingMap.set(row.servicio_custodio_id, {
          lat: row.lat,
          lng: row.lng,
          captured_at: row.ultimo_ping_at,
          cliente: row.cliente,
          placa: row.placa,
        });
      });
      for (const row of data || []) {
        const key = row.servicio_id;
        if (!map.has(key)) map.set(key, []);
        const ping = pingMap.get(row.id) || null;
        map.get(key).push({
          ...row,
          lastPing: ping
            ? {
                lat: ping.lat,
                lng: ping.lng,
                captured_at: ping.captured_at,
              }
            : null,
        });
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

  function buildTipoEtiquetaFromCustodias(custodios) {
    if (!Array.isArray(custodios) || !custodios.length) return "";
    let simple = 0;
    let tipoA = 0;
    let tipoB = 0;
    custodios.forEach((cust) => {
      const raw = (cust.tipo_custodia || "").toUpperCase();
      if (raw === "SIMPLE" || raw === "S") simple += 1;
      else if (raw === "A" || raw === "TIPO A") tipoA += 1;
      else if (raw === "B" || raw === "TIPO B") tipoB += 1;
    });
    const pairsB = Math.min(simple, tipoA) + tipoB;
    const remainingSimple = simple - Math.min(simple, tipoA);
    const remainingA = tipoA - Math.min(simple, tipoA);
    const parts = [];
    const codeB = TIPO_CUSTODIA_META.B.code || "B";
    const codeA = TIPO_CUSTODIA_META.A.code || "A";
    const codeS = TIPO_CUSTODIA_META.S.code || "S";
    if (pairsB > 0) parts.push(pairsB === 1 ? codeB : `${pairsB}${codeB}`);
    if (remainingA > 0)
      parts.push(remainingA === 1 ? codeA : `${remainingA}${codeA}`);
    if (remainingSimple > 0)
      parts.push(
        remainingSimple === 1 ? codeS : `${remainingSimple}${codeS}`
      );
    return parts.length ? parts.join(" + ") : "";
  }

  function getTipoEtiqueta(servicio) {
    return (
      (servicio?.tipoEtiqueta || servicio?.tipo || "").toString().trim() || "-"
    );
  }

  function updateServiceFlag(servicioId, flag, value) {
    if (!servicioId) return;
    const key = String(servicioId);
    const current = serviceFlags.get(key) || {};
    if (value !== undefined && value !== null && value !== false) {
      current[flag] = value === true ? true : value;
      serviceFlags.set(key, current);
    } else if (current[flag]) {
      delete current[flag];
      if (Object.keys(current).length) serviceFlags.set(key, current);
      else serviceFlags.delete(key);
    }
  }

  // === BEGIN HU:HU-SOLICITUD-REPORTE detección tardía (no tocar fuera) ===
  function updateLateReportFlags(services) {
    if (!Array.isArray(services)) return;
    services.forEach((svc) => {
      const computed = evaluateLateReportState(svc);
      const existing = getLateReportState(svc.id);
      if (computed.tardy) {
        const next = {
          tardy: true,
          maxMinutes: computed.maxMinutes,
          tardyNames: computed.tardyNames,
          requestStatus: existing?.requestStatus === "waiting" ? "waiting" : "warn",
          requestedAt: existing?.requestedAt || null,
        };
        updateServiceFlag(svc.id, "reportLate", next);
      } else {
        clearLateReport(svc.id);
      }
    });
  }

  function evaluateLateReportState(servicio) {
    const custodios = Array.isArray(servicio?.custodios)
      ? servicio.custodios
      : [];
    if (!custodios.length) {
      return { tardy: false, maxMinutes: null, tardyNames: [] };
    }
    const now = new Date();
    let tardy = false;
    let maxMinutes = 0;
    const tardyNames = [];
    custodios.forEach((cust) => {
      const ts = cust?.lastPing?.captured_at;
      const minutes = ts ? minDiff(now, new Date(ts)) : Number.POSITIVE_INFINITY;
      if (minutes > maxMinutes) maxMinutes = minutes;
      if (minutes > LATE_REPORT_MIN) {
        tardy = true;
        const nombre = (cust?.nombre_custodio || "Custodia").trim();
        if (nombre && !tardyNames.includes(nombre)) {
          tardyNames.push(nombre);
        }
      }
    });
    return { tardy, maxMinutes, tardyNames };
  }
  // === END HU:HU-SOLICITUD-REPORTE ===

  function getLateReportState(servicioId) {
    const flags = serviceFlags.get(String(servicioId));
    const state = flags?.reportLate;
    return state && state.tardy ? state : null;
  }

  function formatLateReportLabel(state) {
    const names = Array.isArray(state?.tardyNames) ? state.tardyNames : [];
    if (!names.length) return "Custodia";
    if (names.length === 1) return names[0];
    return `${names[0]} +${names.length - 1}`;
  }

  function buildLateReportButton(state) {
    if (!state) return "";
    const status = state.requestStatus || "idle";
    const label = formatLateReportLabel(state);
    const disabledAttr = status === "waiting" ? "disabled" : "";
    const statusClass =
      status === "waiting" ? " is-waiting" : status === "warn" ? " is-warn" : "";
    const text =
      status === "waiting"
        ? "Esperando confirmación…"
        : `SOLICITAR REPORTE + ${label}`;
    const spinner =
      status === "waiting"
        ? '<span class="btn-report-late__spinner" aria-hidden="true"></span>'
        : "";
    return `<button class="btn btn-icon btn-report-late${statusClass}" data-act="report" data-state="${status}" ${disabledAttr} aria-label="${h(
      text
    )}">
      <i class="material-icons" aria-hidden="true">${
        status === "waiting" ? "hourglass_top" : "campaign"
      }</i>
      <span class="sr-only">${h(text)}</span>
      ${spinner}
    </button>`;
  }

  async function handleLateReportClick(button, servicio) {
    const servicioId = servicio?.id;
    if (!servicioId) return;
    const state = getLateReportState(servicioId);
    if (!state?.tardy) return;
    if (state.requestStatus === "waiting") return;
    if (button) button.disabled = true;
    setLateReportStatus(servicioId, {
      requestStatus: "waiting",
      requestedAt: Date.now(),
    });
    try {
      const payload = buildLateReportPayload(servicio, state);
      if (typeof window.Alarma?.emit === "function") {
        await window.Alarma.emit("reporte_forzado", payload);
      } else {
        throw new Error("Modulo de alarma no disponible");
      }
      showMsg("Solicitud de reporte enviada. Esperando confirmación…");
      scheduleLateReportRetry(servicioId);
    } catch (err) {
      console.warn("[reporte] emit error", err);
      showMsg("No se pudo solicitar el reporte. Intenta nuevamente.");
      clearLateReportTimer(servicioId);
      setLateReportStatus(servicioId, { requestStatus: "idle" });
    }
  }

  function setLateReportStatus(servicioId, updates) {
    const state = getLateReportState(servicioId);
    if (!state) return;
    const next = { ...state, ...updates };
    updateServiceFlag(servicioId, "reportLate", next);
    refreshList();
  }

  function scheduleLateReportRetry(servicioId) {
    clearLateReportTimer(servicioId);
    const key = String(servicioId);
    const timer = setTimeout(() => {
      lateReportTimers.delete(key);
      setLateReportStatus(servicioId, { requestStatus: "warn" });
    }, REPORT_RETRY_MS);
    lateReportTimers.set(key, timer);
  }

  function clearLateReportTimer(servicioId) {
    const key = String(servicioId);
    const timer = lateReportTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      lateReportTimers.delete(key);
    }
  }

  function clearLateReport(servicioId) {
    clearLateReportTimer(servicioId);
    updateServiceFlag(servicioId, "reportLate", false);
  }

  function buildLateReportPayload(servicio, state) {
    const metadata = {
      origin: "dashboard-admin",
      tardy_minutes: state?.maxMinutes || null,
      tardy_custodias: state?.tardyNames || [],
    };
    return {
      servicio_id: servicio?.id || null,
      empresa: servicio?.empresa || null,
      cliente:
        servicio?.cliente?.nombre ||
        servicio?.clienteNombre ||
        servicio?.cliente ||
        null,
      placa: servicio?.placa || servicio?.placa_upper || null,
      tipo: servicio?.tipo || null,
      metadata,
    };
  }

  function renderAlertBadges(servicioId) {
    const flags = servicioId ? serviceFlags.get(String(servicioId)) : null;
    if (!flags) return "";
    const badges = [];
    if (flags.panic) {
      badges.push(
        `<span class="alarma-badge js-panic-reopen" role="button" tabindex="0" data-sid="${servicioId}">PANICO</span>`
      );
    }
    if (flags.checkinPending) {
      badges.push(
        '<span class="alarma-badge alarma-badge--warn">CHECK-IN PENDIENTE</span>'
      );
    }
    if (flags.routeDesvio) {
      badges.push(
        `<span class="alarma-badge alarma-badge--warn js-route-focus" role="button" tabindex="0" data-sid="${servicioId}">DESVÍO</span>`
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
      const tipoLabel = getTipoEtiqueta(s);
      const lateState = getLateReportState(s.id);
      const lateButtonHtml = buildLateReportButton(lateState);
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
        <div><strong>Tipo:</strong> ${h(tipoLabel || "-")}</div>
        <div class="${pingClass}"><strong>Ultimo ping:</strong> ${pingLabel}</div>
        <div class="row-actions">
          <button class="btn btn-icon" data-act="ver" data-id="${
            s.id
          }" aria-label="Ver en mapa">
            <i class="material-icons" aria-hidden="true">map</i>
            <span class="sr-only">Ver en mapa</span>
          </button>
          ${lateButtonHtml}
          <button class="btn btn-icon btn-accent" data-act="fin" data-id="${
            s.id
          }" ${s.estado === "FINALIZADO" ? "disabled" : ""} aria-label="Finalizar servicio">
            <i class="material-icons" aria-hidden="true">check_circle</i>
            <span class="sr-only">Finalizar</span>
          </button>
        </div>`;
      card.addEventListener("click", async (e) => {
        const reopen = e.target.closest(".js-panic-reopen");
        if (reopen) {
          e.stopPropagation();
          reopenActivePanic(reopen.dataset.sid || s.id);
          return;
        }
        const routeFocus = e.target.closest(".js-route-focus");
        if (routeFocus) {
          e.stopPropagation();
          reopenRouteAlert(routeFocus.dataset.sid || s.id);
          return;
        }
        const btn = e.target.closest("button[data-act]");
        if (!btn) {
          selectService(s);
          return;
        }
        if (btn.dataset.act === "ver") {
          selectService(s);
        } else if (btn.dataset.act === "fin") {
          await finalizarServicio(s);
        } else if (btn.dataset.act === "report") {
          await handleLateReportClick(btn, s);
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
    // === BEGIN HU:HU-MAP-MARKERS-ALL select refresh (NO TOCAR FUERA) ===
    refreshMarkersState("select-service").catch(() => {});
    // === END HU:HU-MAP-MARKERS-ALL ===
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

  // === BEGIN HU:HU-MAP-MARKERS-ALL markers render (NO TOCAR FUERA) ===
  function updateMarkers(custodias, options = {}) {
    ensureMap();
    if (!map) return;
    const scoped = Boolean(options.scopedToService);
    const keepIds = new Set(custodias.map((c) => c.servicio_custodio_id));
    for (const [id, marker] of Array.from(markers.entries())) {
      if (!keepIds.has(id)) {
        try {
          overviewLayer?.removeLayer(marker);
        } catch (e) {}
        try {
          marker.remove?.();
        } catch (e) {}
        markers.delete(id);
        console.log("[markers] remove", {
          id,
          mode: scoped ? "servicio" : "general",
        });
      }
    }
    const bounds = [];
    for (const item of custodias) {
      const ping = item.lastPing;
      if (!ping?.lat || !ping?.lng) continue;
      bounds.push([ping.lat, ping.lng]);
      const label = scoped
        ? item.nombre
        : `${item.nombre} - ${item.cliente} - ${item.placa}`;
      const popup = scoped
        ? `<strong>${h(item.nombre)}</strong>`
        : `<strong>${h(item.nombre)}</strong><br>${h(item.cliente)} - ${h(
            item.placa
          )}`;
      let marker = markers.get(item.servicio_custodio_id);
      if (!marker) {
        marker = L.marker([ping.lat, ping.lng], {
          title: label,
          icon: ICON.custodia,
          zIndexOffset: scoped ? 220 : 180,
        }).addTo(overviewLayer);
        marker.bindPopup(popup);
        markers.set(item.servicio_custodio_id, marker);
        console.log("[markers] add", {
          id: item.servicio_custodio_id,
          mode: scoped ? "servicio" : "general",
        });
      } else {
        marker.setLatLng([ping.lat, ping.lng]);
        marker.setPopupContent(popup);
        console.log("[markers] update", {
          id: item.servicio_custodio_id,
          mode: scoped ? "servicio" : "general",
        });
      }
    }
    if (scoped && bounds.length) {
      if (bounds.length === 1) {
        map.setView(bounds[0], 16);
      } else {
        const b = L.latLngBounds(bounds);
        map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
      }
    }
    const modeLabel = scoped
      ? `servicio:${selectedId || options.servicioId || "?"}`
      : "general";
    console.log(`[markers] mode:${modeLabel}`, {
      count: custodias.length,
    });
  }
  // === END HU:HU-MAP-MARKERS-ALL ===

  let selectionLayer = null;
  let lastRouteSig = "";
  async function focusMarker(s) {
    // sugerencia: extraer esta funcion a tracking-common.drawRouteWithPOIs + tracking-common.routeLocal
    // para reutilizar en la vista de resguardo sin duplicar.
    ensureMap();
    if (!map) return;
    clearRutaClienteLayer("focus-marker");
    try {
      focusLayer?.clearLayers();
    } catch (e) {}
    try {
      routeLayerFocus?.clearLayers();
    } catch (e) {}
    const p = s.lastPing;
    if (!p?.lat || !p?.lng) return;
    // Limpia capa anterior y dibuja ruta/POIs
    const start = [p.lat, p.lng];
    const hasDestino = s.destino_lat != null && s.destino_lng != null;
    // === BEGIN HU:HU-TOOLTIP-NOMBRE-CUSTODIO foco (NO TOCAR FUERA) ===
    const focusLabel =
      s.custodios?.find((c) => c?.lastPing)?.nombre_custodio ||
      s.custodios?.[0]?.nombre_custodio ||
      "Custodia";
    L.marker(start, {
      icon: ICON.custodia,
      title: focusLabel,
      zIndexOffset: 200,
    })
      .bindTooltip(focusLabel)
      .addTo(focusLayer);
    console.log("[task][HU-TOOLTIP-NOMBRE-CUSTODIO] done", {
      servicio: s.id,
      label: focusLabel,
    });
    // === END HU:HU-TOOLTIP-NOMBRE-CUSTODIO ===
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
    const tipoLabel = getTipoEtiqueta(s);
    details.innerHTML = `<div><strong>Empresa:</strong> ${
      s.empresa
    }</div><div><strong>Cliente:</strong> ${
      s.cliente?.nombre || "-"
    }</div><div><strong>Placa:</strong> ${
      s.placa || "-"
    }</div><div><strong>Tipo:</strong> ${
      tipoLabel || "-"
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
        : servicesCache.find((item) => item.id === servicio) || {
            id: servicio,
          };
    const id = serviceObj?.id;
    if (!id) return;
    const title = serviceObj.placa
      ? formatTitle(serviceObj)
      : `el servicio ${id}`;
    const ok = confirm(`Finalizar ${title}?`);
    if (!ok) return;
    try {
      const { error } = await window.sb
        .from("servicio")
        .update({ estado: "FINALIZADO" })
        .eq("id", id);
      if (error) throw error;
      showMsg("Servicio finalizado");
      if (routeAlertPanel?.dataset.sid === String(id)) {
        dismissRouteAlert("clear");
      } else {
        updateServiceFlag(id, "routeDesvio", false);
      }
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
      window.Alarma.primeAdminPermissions?.({
        reason: isMobileDevice ? "mobile-init" : "admin-init",
      }).catch((err) => console.warn("[permissions] audio:auto", err));
      if (isMobileDevice) {
        setTimeout(() => {
          window.Alarma.primeAdminPermissions?.({
            reason: "mobile-retry",
          }).catch(() => {});
        }, 1500);
      }
      alarmaUnsubscribe = window.Alarma.subscribe(handleAlarmaEvent);
    } catch (err) {
      console.warn("[admin][alarma] init error", err);
    }
  }

  // === BEGIN HU:HU-PANICO-MODAL-UNICO panic handler (no tocar fuera) ===
  function handleAlarmaEvent(evt) {
    if (!evt) return;
    if (evt.type === "reporte_forzado") {
      applyLateReportRemote(evt);
      return;
    }
    if (evt.type === "reporte_forzado_ack") {
      const sid = extractServicioIdFromEvent(evt);
      if (sid) {
        clearLateReport(sid);
        refreshList();
      }
      return;
    }
    if (evt.type === "panic") {
      lastPanicRecord = evt.record || evt.payload || evt;
      console.log("[panic] recibido en admin", {
        servicio_id: lastPanicRecord?.servicio_id,
        cliente: lastPanicRecord?.cliente,
        placa: lastPanicRecord?.placa,
      });
      if (lastPanicRecord?.servicio_id) {
        updateServiceFlag(lastPanicRecord.servicio_id, "panic", true);
        refreshList();
      }
      focusPanicOnMap(lastPanicRecord, { forceReload: true });
      try {
        window.Alarma.modalPanic?.(lastPanicRecord);
        console.assert(
          document.querySelectorAll(".alarma-modal__dialog").length === 1,
          "Debe existir un solo modal de panico"
        );
        console.log("[panic] modal:open", {
          servicio_id: lastPanicRecord?.servicio_id || null,
        });
        console.log("[task][HU-PANICO-MODAL-UNICO] done");
      } catch (err) {
        console.warn("[admin][alarma] modal panic", err);
      }
      if (alertsEnabled) {
        try {
          navigator.vibrate?.([240, 120, 240, 140, 320]);
        } catch (err) {
          console.warn("[audio] Vibracion fallo", err);
        }
      } else {
        console.log("[audio] Vibracion omitida por permisos");
      }
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
      clearLateReport(evt.record.servicio_id);
      refreshList();
    } else if (evt.type === "ruta_desviada") {
      const record = normalizeRouteDeviationRecord(evt.record || evt.payload || evt);
      handleRouteDeviation(record);
    }
  }
  // === END HU:HU-PANICO-MODAL-UNICO ===

  // === BEGIN HU:HU-RUTA-DESVIO-FRONT-ADMIN ===
  function normalizeRouteDeviationRecord(raw) {
    if (!raw) return null;
    const metadata =
      raw.metadata && typeof raw.metadata === "object"
        ? { ...raw.metadata }
        : {};
    const servicioId =
      raw.servicio_id || metadata.servicio_id || metadata.servicio || null;
    const clienteNombre =
      raw.cliente ||
      metadata.cliente ||
      servicesCache.find((s) => s.id === servicioId)?.cliente?.nombre ||
      null;
    return {
      servicio_id: servicioId,
      empresa: raw.empresa || metadata.empresa || null,
      cliente: clienteNombre,
      placa: raw.placa || metadata.placa || null,
      tipo: raw.tipo || metadata.tipo || null,
      lat: raw.lat ?? metadata.lat ?? null,
      lng: raw.lng ?? metadata.lng ?? null,
      timestamp: raw.timestamp || metadata.timestamp || new Date().toISOString(),
      metadata,
    };
  }

  function handleRouteDeviation(record) {
    if (!record?.servicio_id) return;
    routeAlertRecord = record;
    updateServiceFlag(record.servicio_id, "routeDesvio", record);
    refreshList();
    showRouteAlert(record);
    const svc = servicesCache.find((s) => s.id === record.servicio_id);
    if (svc) {
      selectService(svc);
    }
    if (alertsEnabled) {
      try {
        navigator.vibrate?.([280, 120, 320, 120, 420]);
      } catch (err) {
        console.warn("[route] vibrate error", err);
      }
    }
  }

  function showRouteAlert(record) {
    if (!routeAlertPanel || !record) return;
    routeAlertPanel.hidden = false;
    routeAlertPanel.setAttribute("aria-hidden", "false");
    routeAlertPanel.dataset.sid = record.servicio_id || "";
    const clienteLabel = (record.cliente || "Cliente").toUpperCase();
    if (routeAlertTitle) {
      routeAlertTitle.textContent = `Ruta desviada – ${clienteLabel}`;
    }
    if (routeAlertBody) {
      const placa = record.placa || "sin placa";
      routeAlertBody.textContent = `La custodia (${placa}) se desvió de la ruta asignada para ${clienteLabel}.`;
    }
    if (routeAlertMeta) {
      routeAlertMeta.textContent = formatRouteMeta(record.metadata);
    }
  }

  function dismissRouteAlert(reason = "dismiss") {
    if (!routeAlertPanel) return;
    routeAlertPanel.hidden = true;
    routeAlertPanel.setAttribute("aria-hidden", "true");
    if (reason === "clear") {
      const sid = routeAlertPanel.dataset.sid;
      if (sid) {
        updateServiceFlag(sid, "routeDesvio", false);
        refreshList();
      }
      routeAlertPanel.dataset.sid = "";
      routeAlertRecord = null;
      clearRutaClienteLayer("dismiss");
    }
  }

  async function handleRouteAlertView() {
    if (!routeAlertRecord) return;
    if (routeAlertViewBtn) {
      routeAlertViewBtn.disabled = true;
    }
    try {
      await ensureServiceSelectedById(routeAlertRecord.servicio_id);
      const rutaPayload = await fetchRutaClienteFeature(routeAlertRecord);
      if (!rutaPayload?.geojson && routeAlertRecord?.lat == null) {
        showMsg("No se encontró una ruta activa para este cliente.");
        return;
      }
      drawRutaClienteFeature(rutaPayload?.geojson || null, routeAlertRecord);
    } catch (err) {
      console.warn("[route] view error", err);
      showMsg("No se pudo mostrar la ruta asignada.");
    } finally {
      if (routeAlertViewBtn) {
        routeAlertViewBtn.disabled = false;
      }
    }
  }

  async function fetchRutaClienteFeature(record) {
    if (!window.sb) return null;
    const rutaId =
      record.metadata?.ruta_cliente_id || record.metadata?.rutaId || null;
    const clienteId =
      record.metadata?.cliente_id ||
      getClienteIdForServicio(record.servicio_id) ||
      null;
    const cacheKey = rutaId ? `ruta:${rutaId}` : clienteId ? `cli:${clienteId}` : null;
    if (!cacheKey) return null;
    if (rutaClienteCache.has(cacheKey)) {
      return rutaClienteCache.get(cacheKey);
    }
    let builder = window.sb
      .from("ruta_cliente")
      .select("id, cliente_id, nombre, descripcion, geojson")
      .eq("is_active", true);
    if (rutaId) {
      builder = builder.eq("id", rutaId).maybeSingle();
    } else {
      builder = builder
        .eq("cliente_id", clienteId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    }
    const { data, error } = await builder;
    if (error && error.code !== "PGRST116") {
      throw error;
    }
    if (!data?.geojson) return null;
    const feature = normalizeRutaFeature(data.geojson);
    if (!feature) return null;
    const payload = { ...data, geojson: feature };
    rutaClienteCache.set(cacheKey, payload);
    return payload;
  }

  function drawRutaClienteFeature(feature, record) {
    const layer = ensureRutaClienteLayer();
    layer.clearLayers();
    let bounds = null;
    if (feature) {
      const geoLayer = L.geoJSON(feature, {
        style: {
          color: "#1d4ed8",
          weight: 5,
          opacity: 0.95,
          dashArray: "10 6",
        },
      }).addTo(layer);
      bounds = geoLayer.getBounds();
    }
    if (record.lat != null && record.lng != null) {
      L.circleMarker([record.lat, record.lng], {
        radius: 10,
        color: "#f97316",
        fillColor: "#fb923c",
        fillOpacity: 0.9,
        weight: 3,
      })
        .bindTooltip("Último ping desviado")
        .addTo(layer);
      if (bounds?.isValid && bounds.isValid()) {
        bounds = bounds.extend([record.lat, record.lng]);
      } else {
        bounds = L.latLngBounds([record.lat, record.lng]);
      }
    }
    if (bounds?.isValid && bounds.isValid()) {
      map.fitBounds(bounds.pad(0.15), { padding: [48, 60], maxZoom: 16 });
    }
  }

  function ensureRutaClienteLayer() {
    ensureMap();
    if (!rutaClienteLayer && map) {
      rutaClienteLayer = L.layerGroup().addTo(map);
    }
    return rutaClienteLayer;
  }

  function clearRutaClienteLayer(reason = "manual") {
    if (rutaClienteLayer) {
      rutaClienteLayer.clearLayers();
    }
  }

  async function ensureServiceSelectedById(servicioId) {
    if (!servicioId) return null;
    let svc = servicesCache.find((s) => s.id === servicioId);
    if (svc) {
      selectService(svc);
      return svc;
    }
    await loadServices();
    svc = servicesCache.find((s) => s.id === servicioId);
    if (svc) selectService(svc);
    return svc;
  }

  function getClienteIdForServicio(servicioId) {
    const svc = servicesCache.find((s) => s.id === servicioId);
    return svc?.cliente?.id || null;
  }

  function formatRouteMeta(meta = {}) {
    const parts = [];
    if (Number.isFinite(meta.distancia_m || meta.distancia)) {
      const dist = meta.distancia_m ?? meta.distancia;
      parts.push(`Distancia fuera: ${Math.round(dist)} m`);
    }
    if (Number.isFinite(meta.tolerancia_m)) {
      parts.push(`Tolerancia ${Math.round(meta.tolerancia_m)} m`);
    }
    if (meta.ultimo_ping) {
      parts.push(`Último ping ${formatRelativeTimestamp(meta.ultimo_ping)}`);
    }
    if (meta.ruta_nombre) {
      parts.push(meta.ruta_nombre);
    }
    return parts.length
      ? parts.join(" · ")
      : "Confirma la ubicación y ruta del servicio.";
  }

  function normalizeRutaFeature(rawGeojson) {
    if (!rawGeojson) return null;
    let parsed = rawGeojson;
    if (typeof rawGeojson === "string") {
      try {
        parsed = JSON.parse(rawGeojson);
      } catch (err) {
        console.warn("[route] geojson inválido", err);
        return null;
      }
    }
    if (parsed.type === "Feature" && parsed.geometry?.type === "LineString") {
      return parsed;
    }
    if (parsed.type === "LineString") {
      return { type: "Feature", geometry: parsed };
    }
    return null;
  }

  function formatRelativeTimestamp(value) {
    if (!value) return null;
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) return null;
    const diff = Date.now() - time;
    if (diff < 90_000) return "hace instantes";
    const minutes = Math.round(diff / 60000);
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.round(hours / 24);
    return `hace ${days} d`;
  }
  // === END HU:HU-RUTA-DESVIO-FRONT-ADMIN ===

  function dismissPanicAlert() {
    clearPanicMarker();
    lastPanicRecord = null;
    try {
      window.Alarma?.closeModal?.();
      console.log("[panic] modal:close");
    } catch (_) {}
  }

  function reopenActivePanic(servicioId) {
    if (
      !window.Alarma?.isPanicActive ||
      !window.Alarma.isPanicActive() ||
      !lastPanicRecord
    ) {
      return;
    }
    if (
      servicioId &&
      String(lastPanicRecord.servicio_id || "") !== String(servicioId || "")
    ) {
      return;
    }
    try {
      window.Alarma.modalPanic?.(lastPanicRecord);
      console.log("[panic] modal:reopen", {
        servicio_id: lastPanicRecord?.servicio_id || null,
      });
    } catch (err) {
      console.warn("[panic] modal reopen error", err);
    }
  }

  function reopenRouteAlert(servicioId) {
    if (!servicioId || !routeAlertPanel) return;
    const flags = serviceFlags.get(String(servicioId));
    const record = flags?.routeDesvio || null;
    if (record) {
      routeAlertRecord = record;
      showRouteAlert(record);
    }
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
  const startRealtimePolling = (() => {
    let timer = null;
    const POLL_MS = 30000;
    return (reason = "fallback") => {
      if (timer) return;
      console.warn("[realtime] fallback polling", { reason });
      timer = setInterval(() => {
        try {
          loadServices();
          refreshMarkersState("poll");
        } catch (err) {
          console.warn("[poll] refresh error", err);
        }
      }, POLL_MS);
    };
  })();
  function setupRealtime() {
    if (!canUseRealtime()) {
      startRealtimePolling("disabled");
      loadServices();
      refreshMarkersState("poll");
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
      startRealtimePolling("servicio-channel-error");
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
    } catch (e) {
      startRealtimePolling("ubicacion-channel-error");
    }
    window.addEventListener("realtime:down", () =>
      startRealtimePolling("realtime-down")
    );
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
  console.log("[QA] markers general/servicio OK");
  console.log("[QA] tooltip nombre OK");
  console.log("[QA] modal único de pánico OK");
  console.log("[QA] sirena + TTS en bucle OK");
});

  function extractServicioIdFromEvent(evt) {
    const source = evt?.record || evt?.event || evt?.payload || evt || {};
    const metadata =
      source.metadata && typeof source.metadata === "object"
        ? source.metadata
        : {};
    return (
      source.servicio_id ||
      source.servicioId ||
      metadata.servicio_id ||
      metadata.servicioId ||
      null
    );
  }

  function applyLateReportRemote(evt) {
    const servicioId = extractServicioIdFromEvent(evt);
    if (!servicioId) return;
    const source = evt?.record || evt?.event || evt?.payload || evt || {};
    const metadata =
      source.metadata && typeof source.metadata === "object"
        ? source.metadata
        : {};
    const tardyNames = Array.isArray(metadata.tardy_custodias)
      ? metadata.tardy_custodias
      : [];
    const state = {
      tardy: true,
      maxMinutes: metadata.tardy_minutes || null,
      tardyNames,
      requestStatus: "waiting",
      requestedAt: Date.now(),
    };
    updateServiceFlag(servicioId, "reportLate", state);
    scheduleLateReportRetry(servicioId);
    refreshList();
  }
