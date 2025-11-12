// mapa.js - Seguimiento en tiempo real del resguardo
// Requiere: window.sb (config.js) y Leaflet cargado en la pagina.
// La pagina debe tener: <div id="map-track"></div>, <span id="distancia-label"></span>, <button id="btn-finalizar"></button>

document.addEventListener("DOMContentLoaded", async () => {
  const SEND_EVERY_MS = 30_000;
  const ARRIVE_M = 50;
  const REDIRECT_DELAY = 2000;
  const DASHBOARD_URL = "/html/dashboard/custodia-registros.html";

  const showMsg = (message) => {
    const snackbar = document.getElementById("app-snackbar");
    try {
      if (snackbar && snackbar.MaterialSnackbar) {
        snackbar.MaterialSnackbar.showSnackbar({ message });
      } else {
        alert(message);
      }
    } catch {
      alert(message);
    }
  };

  const servicioId = sessionStorage.getItem("servicio_id_actual");
  if (!servicioId) {
    showMsg("Ingresa desde Mis servicios y usa SEGUIR para abrir el mapa.");
    location.replace(DASHBOARD_URL);
    return;
  }
  if (!window.sb) {
    showMsg("Supabase no inicializado");
    return;
  }

  const custSession = window.CustodiaSession?.load();
  if (custSession) {
    console.log("[session] resume", {
      servicio_id: custSession.servicio_id,
      servicio_custodio_id: custSession.servicio_custodio_id,
    });
  }
  if (!custSession || custSession.servicio_id !== servicioId) {
    showMsg("La sesion caduco. Vuelve a SEGUIR el servicio para continuar.");
    location.replace(DASHBOARD_URL);
    return;
  }
  const servicioCustodioId = custSession.servicio_custodio_id;
  if (!servicioCustodioId) {
    showMsg("Selecciona SEGUIR para asignar un custodio antes de continuar.");
    location.replace(DASHBOARD_URL);
    return;
  }
  try {
      const ownerOk = await verifyMapOwner(servicioCustodioId, custSession.custodia_id);
    if (!ownerOk) {
      showMsg("Ya no eres el titular del servicio. Vuelve a Mis Servicios y selecciona SEGUIR.");
      window.CustodiaSession?.clear?.();
      location.replace(DASHBOARD_URL);
      return;
    }
  } catch (err) {
    console.error("[mapa][owner-guard]", err);
    showMsg("No se pudo verificar tu acceso. Intenta nuevamente.");
    location.replace(DASHBOARD_URL);
    return;
  }
  const custodioNombre = custSession.nombre_custodio || "Custodia";
  const custodioTipo = custSession.tipo_custodia || "";
  const custodiaIdActual = custSession.custodia_id || null;
  const extendSession = () => {
    try {
      window.CustodiaSession?.touch();
    } catch {}
  };
  const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
  let sessionTouchTimer = null;
  const startSessionTouchLoop = () => {
    extendSession();
    if (sessionTouchTimer) clearInterval(sessionTouchTimer);
    sessionTouchTimer = setInterval(extendSession, SESSION_TOUCH_INTERVAL_MS);
  };
  startSessionTouchLoop();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      extendSession();
    }
  });

  // === BEGIN HU:HU-FIX-PGRST203 registrar-ubicacion (NO TOCAR FUERA) ===
  const buildRegistrarUbicacionPayload = ({
    servicioId: servicioIdArg,
    lat,
    lng,
    servicioCustodioId: scId,
  }) => {
    console.assert(
      typeof servicioIdArg === "string",
      "[task][HU-FIX-PGRST203] servicioId inválido"
    );
    console.assert(
      typeof lat === "number" && typeof lng === "number",
      "[task][HU-FIX-PGRST203] lat/lng inválidos"
    );
    const body = {
      p_servicio_id: servicioIdArg,
      p_lat: lat,
      p_lng: lng,
    };
    if (scId) body.p_servicio_custodio_id = scId;
    return body;
  };

  async function registrarUbicacionSeguro({
    servicioId: servicioIdArg,
    lat,
    lng,
    servicioCustodioId: scId,
  }) {
    const payload = buildRegistrarUbicacionPayload({
      servicioId: servicioIdArg,
      lat,
      lng,
      servicioCustodioId: scId,
    });
    console.log("[task][HU-FIX-PGRST203] start", payload);
    try {
      const { data, error, status } = await window.sb.rpc(
        "registrar_ubicacion",
        payload
      );
      if (error) {
        console.error(
          "[mapa][rpc ubicacion]",
          status || error?.status || "error",
          error
        );
        return { ok: false, error };
      }
      console.log("[task][HU-FIX-PGRST203] done", status || 200);
      return { ok: true, data };
    } catch (err) {
      console.error("[mapa][rpc ubicacion] exception", err);
      return { ok: false, error: err };
    }
  }
  // === END HU:HU-FIX-PGRST203 ===

  // Referencias de UI
  const mapContainerId = "map-track";
  const distanciaLabel = document.getElementById("distancia-label");
  const btnFinalizar = document.getElementById("btn-finalizar");
  const estadoTextoEl = document.getElementById("estado-texto");
  const destinoTextoEl = document.getElementById("destino-texto");
  const panicBtn = document.getElementById("alarma-panic-btn");
  const btnCustodias = document.getElementById("btn-custodias-mobile");
  const custodiosSidebar = document.getElementById("custodios-sidebar");
  const custodiosListEl = document.getElementById("custodios-list");
  const custodiosCloseBtn = document.getElementById("custodios-close");
  const custodiosOverlay = document.getElementById("custodios-overlay");

  // Estado global
  const hasAlarma = typeof window.Alarma === "object";
  const hasPushKey = Boolean(window.APP_CONFIG?.WEB_PUSH_PUBLIC_KEY);
  // === BEGIN HU:HU-MAPA-CARRITO Mapa-resguardo: icono carrito (NO TOCAR FUERA) ===
  const ICON = {
    carrito: L.icon({
      iconUrl: "/assets/icons/custodia-current.svg",
      iconRetinaUrl: "/assets/icons/custodia-current.svg",
      iconSize: [30, 30],
      iconAnchor: [15, 28],
      popupAnchor: [0, -28],
    }),
  };
  let markerYoKey = null;
  const buildMarkerKey = () =>
    servicioCustodioId ? `sc-${servicioCustodioId}` : `svc-${servicioId}`;
  // === END HU:HU-MAPA-CARRITO ===
  /* === BEGIN HU:HU-CHECKIN-15M mapa timers (NO TOCAR FUERA) === */
  const CHECKIN_INTERVAL_MS = 15 * 60 * 1000;
  let checkinTimerId = null;
  let checkinSubStop = null;
  let lastCheckinAt = null;
  let localCheckinAttempt = 0;
  /* === END HU:HU-CHECKIN-15M === */
  // === BEGIN HU:HU-CHECKIN-15M mapa init (NO TOCAR FUERA) ===
  if (hasAlarma) {
    try {
      window.Alarma.initCustodia();
      window.Alarma.requestNotifications?.({ reason: "mapa-resguardo" });
      if (typeof window.Alarma.enableAlerts === "function") {
        Promise.resolve(
          window.Alarma.enableAlerts({ sound: true, haptics: true })
        ).catch(() => {});
      }
      window.Alarma.preloadCheckinAudio?.();
      console.log("[task][HU-CHECKIN-15M] mapa init ok");
    } catch (err) {
      console.warn("[alarma] initCustodia mapa error", err);
    }
  }
  // === END HU:HU-CHECKIN-15M ===
  const empresaActual = (
    sessionStorage.getItem("auth_empresa") || ""
  ).toUpperCase();
  let servicioInfo = null;
  let map = null;
  let markerYo = null;
  let markerDestino = null;
  let destino = null;
  // === BEGIN HU:HU-RUTA-TRAZADO Ruta Partida-Destino (NO TOCAR FUERA) ===
  const ROUTE_LOCAL_BASE =
    window.APP_CONFIG?.OSRM_LOCAL_URL?.replace(/\/+$/, "") ||
    "http://127.0.0.1:5000";
  const ROUTE_USE_LOCAL = window.APP_CONFIG?.OSRM_LOCAL === true;
  const ROUTE_PUBLIC_BASE = "https://router.project-osrm.org";
  const ROUTE_THROTTLE_MS = 12_000;
  let routeLayer = null;
  let routeAbortController = null;
  let routeFetchInFlight = null;
  let lastRouteHash = "";
  let lastRouteFetchAt = 0;
  let routeAutoFitDone = false;
  let routeToastShown = false;
  let routeLocalDown = !ROUTE_USE_LOCAL;
  // === END HU:HU-RUTA-TRAZADO ===
  let lastSent = 0;
  let servicioChannel = null;
  let finishModal = null;
  const custodiosCache = { data: [], fetchedAt: 0 };
  let geoPermissionLogged = false;

  function distanciaM(lat1, lng1, lat2, lng2) {
    const R = 6371000; // metros
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLng = (lng2 - lng1) * toRad;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) *
        Math.cos(lat2 * toRad) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function verifyMapOwner(scId, custodiaId) {
    if (!scId || !custodiaId) return false;
    const { data, error } = await window.sb
      .from("servicio_custodio")
      .select("custodia_id")
      .eq("id", scId)
      .maybeSingle();
    if (error) throw error;
    return data?.custodia_id === custodiaId;
  }

  async function ensureGeoPermission(tag) {
    if (!window.PermHelper?.ensureGeoPermission) return null;
    try {
      const status = await window.PermHelper.ensureGeoPermission({
        enableHighAccuracy: true,
        timeout: 20_000,
      });
      if (status) {
        console.log("[perm] geo:" + status, { tag });
      }
      return status;
    } catch (err) {
      console.warn("[perm] geo helper", err);
      return null;
    }
  }

  async function refreshCustodiosList(force = false) {
    if (!custodiosListEl) return;
    const now = Date.now();
    if (
      !force &&
      custodiosCache.data.length &&
      now - custodiosCache.fetchedAt < 60 * 1000
    ) {
      renderCustodiosList(custodiosCache.data);
      return;
    }
    custodiosListEl.innerHTML =
      "<p class='cust-empty'>Cargando custodias...</p>";
    try {
      const { data, error } = await window.sb
        .from("servicio_custodio")
        .select(
          "id, nombre_custodio, tipo_custodia, custodia_id, created_at, custodia:custodia_id(nombre, empresa, empresa_otro)"
        )
        .eq("servicio_id", servicioId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      custodiosCache.data = data || [];
      custodiosCache.fetchedAt = Date.now();
      renderCustodiosList(custodiosCache.data);
    } catch (err) {
      console.warn("[mapa] custodios list", err);
      custodiosListEl.innerHTML =
        "<p class='cust-empty'>No se pudo cargar el listado de custodios.</p>";
    }
  }

  function renderCustodiosList(list) {
    if (!custodiosListEl) return;
    custodiosListEl.innerHTML = "";
    if (!list?.length) {
      custodiosListEl.innerHTML =
        "<p class='cust-empty'>Este servicio aún no tiene custodias registradas.</p>";
      return;
    }
    list.forEach((item) => {
      const row = document.createElement("div");
      row.className = "cust-row";
      const info = document.createElement("div");
      info.className = "cust-info";
      const nombre =
        item.nombre_custodio ||
        item.custodia?.nombre ||
        "Sin nombre asignado";
      const empresa =
        item.custodia?.empresa ||
        item.custodia?.empresa_otro ||
        "Empresa sin asignar";
      info.innerHTML = `
        <p class="cust-name">${nombre}</p>
        <p class="cust-meta">${item.tipo_custodia || "Sin tipo"} · ${empresa}</p>
        <p class="cust-meta">Registrado: ${formatRelativeTime(
          item.created_at
        )}</p>
      `;
      const badge = document.createElement("span");
      let badgeClass = "chip pend";
      let badgeText = "Pendiente";
      if (item.custodia_id) {
        badgeClass = "chip ok";
        badgeText = "Titular";
      }
      if (custodiaIdActual && item.custodia_id === custodiaIdActual) {
        badgeClass = "chip owner";
        badgeText = "Tu registro";
      }
      badge.className = badgeClass;
      badge.textContent = badgeText;
      row.appendChild(info);
      row.appendChild(badge);
      custodiosListEl.appendChild(row);
    });
  }

  function openCustodiosSidebar(forceRefresh = false) {
    if (!custodiosSidebar) return;
    custodiosSidebar.classList.add("is-open");
    custodiosSidebar.setAttribute("aria-hidden", "false");
    if (custodiosOverlay) {
      custodiosOverlay.hidden = false;
      custodiosOverlay.classList.add("is-visible");
    }
    refreshCustodiosList(forceRefresh);
  }

  function closeCustodiosSidebar() {
    if (custodiosSidebar) {
      custodiosSidebar.classList.remove("is-open");
      custodiosSidebar.setAttribute("aria-hidden", "true");
    }
    if (custodiosOverlay) {
      custodiosOverlay.classList.remove("is-visible");
      custodiosOverlay.hidden = true;
    }
  }

  btnCustodias?.addEventListener("click", () => {
    openCustodiosSidebar(true);
  });
  custodiosCloseBtn?.addEventListener("click", () => closeCustodiosSidebar());
  custodiosOverlay?.addEventListener("click", () => closeCustodiosSidebar());

  function formatRelativeTime(value) {
    if (!value) return "Sin registro";
    const diff = Date.now() - new Date(value).getTime();
    if (diff < 90_000) return "Hace instantes";
    const minutes = Math.round(diff / 60000);
    if (minutes < 60) return `Hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `Hace ${hours} h`;
    const days = Math.round(hours / 24);
    return `Hace ${days} d`;
  }

  async function cargarServicio() {
    try {
      const { data, error } = await window.sb
        .from("servicio")
        .select(
          "id, empresa, placa, tipo, destino_lat, destino_lng, destino_texto, estado, last_checkin_at, cliente:cliente_id(nombre)"
        )
        .eq("id", servicioId)
        .single();

      if (error) {
        throw error;
      }
      if (!data) {
        throw new Error("Servicio no encontrado");
      }

      servicioInfo = data;
      lastCheckinAt = data.last_checkin_at
        ? Date.parse(data.last_checkin_at)
        : null;
      localCheckinAttempt = 0;
      destino = null;
      clearRouteLayer("destino-reset");

      if (
        typeof data.destino_lat === "number" &&
        typeof data.destino_lng === "number"
      ) {
        destino = {
          lat: data.destino_lat,
          lng: data.destino_lng,
          texto: data.destino_texto || "Destino",
        };
      }

      if (destinoTextoEl) destinoTextoEl.textContent = destino?.texto || "-";
      handleServicioUpdate(data);
      await refreshCustodiosList(true);

      initMap();
      subscribeServicio();
      initCheckinMonitoring();
    } catch (err) {
      console.error("[mapa] cargarServicio error", err);
      showMsg("No se pudo cargar el servicio");
    }
  }

  function initMap() {
    if (!document.getElementById(mapContainerId)) {
      console.error(
        "[mapa] Contenedor del mapa no encontrado:",
        mapContainerId
      );
      return;
    }

    const options = {
      preferCanvas: true,
      zoomAnimation: false,
      markerZoomAnimation: false,
      wheelDebounceTime: 40,
    };
    map = L.map(mapContainerId, options);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);

    if (destino) {
      markerDestino = L.marker([destino.lat, destino.lng], {
        title: "Destino",
      }).addTo(map);
      map.setView([destino.lat, destino.lng], 14);
    } else {
      map.setView([-12.0464, -77.0428], 12); // Lima
    }
    // === BEGIN HU:HU-RUTA-TRAZADO Ruta Partida-Destino (NO TOCAR FUERA) ===
    map.on("movestart", () => {
      routeAutoFitDone = true;
    });
    // === END HU:HU-RUTA-TRAZADO ===

    setupPanicButton();
    iniciarTracking();
    setTimeout(() => {
      map.invalidateSize();
    }, 250);
  }

  function setupPanicButton() {
    if (!panicBtn || !hasAlarma) return;
    panicBtn.disabled = true;
    panicBtn.addEventListener("click", async () => {
      if (panicBtn.disabled) {
        showMsg("Esperando ubicacion GPS...");
        return;
      }
      const coords = markerYo?.getLatLng();
      if (!coords) {
        showMsg("Necesitamos tu ubicacion actual para enviar la alerta.");
        return;
      }
      panicBtn.disabled = true;
      try {
        navigator.vibrate?.([260, 140, 260]);
      } catch {}
      let direccion = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
      if (typeof window.Alarma?.reverseGeocode === "function") {
        try {
          direccion = await window.Alarma.reverseGeocode(
            coords.lat,
            coords.lng
          );
        } catch (err) {
          console.warn("[alarma] reverseGeocode", err);
        }
      }
      try {
        await window.Alarma.emit("panic", {
          servicio_id: servicioId,
          servicio_custodio_id: servicioCustodioId,
          empresa: servicioInfo?.empresa || empresaActual || null,
          cliente: servicioInfo?.cliente?.nombre || null,
          placa: servicioInfo?.placa || null,
          tipo: servicioInfo?.tipo || null,
          lat: coords.lat,
          lng: coords.lng,
          direccion,
          timestamp: new Date().toISOString(),
          metadata: { origen: "mapa-resguardo" },
        });
        showMsg("Alerta de panico enviada.");
        try {
          navigator.vibrate?.([200, 120, 200, 120, 260]);
        } catch {}
      } catch (err) {
        console.error("[alarma] emit panic", err);
        showMsg("No se pudo enviar la alerta. Se reintentara automaticamente.");
      } finally {
        panicBtn.disabled = false;
      }
    });
  }

  async function iniciarTracking() {
    if (!navigator.geolocation) {
      console.error("[mapa] Geolocalizacion no soportada");
      return;
    }
    // === BEGIN HU:HU-MAPA-CARRITO Mapa-resguardo: icono carrito (NO TOCAR FUERA) ===
    const pinUser = ICON.carrito;
    // === END HU:HU-MAPA-CARRITO ===
    await ensureGeoPermission("tracking-start");
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!geoPermissionLogged) {
          geoPermissionLogged = true;
          console.log("[permissions] geo:granted");
        }
        onPos(pos.coords.latitude, pos.coords.longitude, pinUser, pos.coords);
      },
      (err) => {
        if (!geoPermissionLogged) {
          geoPermissionLogged = true;
          console.warn("[permissions] geo:denied", err?.code || err?.message || err);
        }
        console.warn("[mapa] geolocalizacion (watch) error", err);
        onInterval();
        const fallback = setInterval(onInterval, 30_000);
        function onInterval() {
          navigator.geolocation.getCurrentPosition(
            (p) => {
              if (!geoPermissionLogged) {
                geoPermissionLogged = true;
                console.log("[permissions] geo:granted");
              }
              onPos(p.coords.latitude, p.coords.longitude, pinUser, p.coords);
            },
            (geoErr) => {
              console.warn("[permissions] geo:denied", geoErr?.code || geoErr?.message || geoErr);
            },
            { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
          );
        }
        window.addEventListener("beforeunload", () => clearInterval(fallback), {
          once: true,
        });
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
    );

    window.addEventListener("beforeunload", () => {
      try {
        navigator.geolocation.clearWatch(watchId);
      } catch {}
      cleanupChannels();
    });
  }

  function subscribeServicio() {
    if (!window.sb?.channel) return;
    cleanupServicioChannel();
    try {
      servicioChannel = window.sb
        .channel(`svc-finish-${servicioId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "servicio",
            filter: `id=eq.${servicioId}`,
          },
          (payload) => handleServicioUpdate(payload.new)
        )
        .subscribe();
    } catch (err) {
      console.warn("[mapa] no se pudo suscribir a servicio", err);
    }
  }

  function cleanupServicioChannel() {
    if (servicioChannel && window.sb?.removeChannel) {
      try {
        window.sb.removeChannel(servicioChannel);
      } catch {}
    }
    servicioChannel = null;
  }

  function cleanupChannels() {
    cleanupServicioChannel();
    // === BEGIN HU:HU-RUTA-TRAZADO Ruta Partida-Destino (NO TOCAR FUERA) ===
    clearRouteLayer("channels-cleanup");
    // === END HU:HU-RUTA-TRAZADO ===
  }

  // === BEGIN HU:HU-RUTA-TRAZADO Ruta Partida-Destino (NO TOCAR FUERA) ===
  function clearRouteLayer(reason = "manual") {
    if (routeAbortController) {
      try {
        routeAbortController.abort();
      } catch {}
      routeAbortController = null;
    }
    if (routeLayer && map) {
      try {
        map.removeLayer(routeLayer);
      } catch {}
    }
    routeLayer = null;
    if (reason === "destino-reset") {
      lastRouteHash = "";
      routeAutoFitDone = false;
    }
  }

  function notifyRouteDown() {
    if (routeToastShown) return;
    routeToastShown = true;
    showMsg("Ruta no disponible (OSRM desconectado)");
  }

  function buildRouteHash(lat, lng) {
    if (!destino) return "";
    return `${lat.toFixed(4)},${lng.toFixed(
      4
    )}|${destino.lat.toFixed(4)},${destino.lng.toFixed(4)}`;
  }

  async function ensureRoute(lat, lng) {
    if (!destino || !map) return;
    const now = Date.now();
    if (now - lastRouteFetchAt < ROUTE_THROTTLE_MS) return;
    const routeHash = buildRouteHash(lat, lng);
    if (routeHash && routeHash === lastRouteHash && routeLayer) {
      return;
    }
    lastRouteFetchAt = now;
    if (routeFetchInFlight) return;
    const params = `${lng},${lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson&steps=false`;
    const fetchRoute = async (baseUrl, timeoutMs = 4500) => {
      const controller = new AbortController();
      routeAbortController = controller;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const url = `${baseUrl}/route/v1/driving/${params}`;
      const res = await fetch(url, {
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      const route = payload?.routes?.[0];
      if (!route?.geometry) throw new Error("Ruta sin geometria");
      return route;
    };

    routeFetchInFlight = (async () => {
      let route = null;
      if (!routeLocalDown) {
        try {
          route = await fetchRoute(ROUTE_LOCAL_BASE);
          console.log("[routeOSRM] local ok", {
            distance: route.distance,
            duration: route.duration,
          });
        } catch (localErr) {
          routeLocalDown = true;
          console.warn("[routeOSRM] local failed -> trying public", localErr);
        }
      }
      if (!route) {
        try {
          route = await fetchRoute(ROUTE_PUBLIC_BASE, 8000);
          console.log("[routeOSRM] public ok", {
            distance: route.distance,
            duration: route.duration,
          });
        } catch (publicErr) {
          console.warn("[routeOSRM] public failed -> route disabled", publicErr);
          notifyRouteDown();
          return;
        }
      }
      if (!route?.geometry) return;
      lastRouteHash = routeHash;
      applyRouteGeometry(route);
    })()
      .catch((err) => {
        console.warn("[routeOSRM] fetch sequence error", err);
      })
      .finally(() => {
        routeFetchInFlight = null;
        routeAbortController = null;
      });
  }

  function applyRouteGeometry(route) {
    if (!map || !route?.geometry) return;
    if (routeLayer) {
      try {
        map.removeLayer(routeLayer);
      } catch {}
    }
    const feature = { type: "Feature", geometry: route.geometry };
    routeLayer = L.geoJSON(feature, {
      style: {
        color: "#ff5722",
        weight: 5,
        opacity: 0.85,
      },
    }).addTo(map);
    if (!routeAutoFitDone) {
      const bounds = routeLayer.getBounds();
      if (bounds?.isValid && bounds.isValid()) {
        map.fitBounds(bounds.pad(0.15), {
          padding: [60, 80],
        });
      }
      routeAutoFitDone = true;
    }
  }
  // === END HU:HU-RUTA-TRAZADO ===

  /* === BEGIN HU:HU-CHECKIN-15M mapa fallback (NO TOCAR FUERA) === */
  function whenCheckinApiReady(cb, attempt = 0) {
    if (
      typeof window.Alarma?.openCheckinPrompt === "function" &&
      typeof window.Alarma?.subscribe === "function"
    ) {
      cb();
      return;
    }
    if (attempt > 20) return;
    setTimeout(() => whenCheckinApiReady(cb, attempt + 1), 1000);
  }

  function initCheckinMonitoring(reason = "init") {
    whenCheckinApiReady(() => {
      if (servicioInfo?.estado === "FINALIZADO") return;
      if (!checkinSubStop) {
        try {
          checkinSubStop = window.Alarma.subscribe(handleCheckinEvent);
        } catch (err) {
          console.warn("[session][checkin] no se pudo suscribir", err);
        }
      }
      scheduleLocalCheckin(reason);
    });
  }

  function handleCheckinEvent(evt) {
    if (!evt) return;
    const record = evt.record || evt.payload || {};
    const evtServicioId =
      record.servicio_id || record.servicioId || evt.servicio_id;
    if (evtServicioId && String(evtServicioId) !== servicioId) return;
    if (evt.type === "checkin_ok") {
      lastCheckinAt = Date.now();
      localCheckinAttempt = 0;
      scheduleLocalCheckin("checkin_ok");
      return;
    }
    if (evt.type === "checkin") {
      const attempt =
        Number(record.metadata?.attempt || record.metadata?.intento) || 1;
      localCheckinAttempt = Math.max(localCheckinAttempt, attempt);
      lastCheckinAt = Date.now();
      scheduleLocalCheckin("push");
    }
  }

  function scheduleLocalCheckin(reason) {
    if (
      !hasAlarma ||
      typeof window.Alarma?.openCheckinPrompt !== "function" ||
      servicioInfo?.estado === "FINALIZADO"
    ) {
      return;
    }
    clearLocalCheckinTimer("reschedule");
    const delay = computeCheckinDelay();
    if (delay <= 0) {
      triggerLocalCheckin("timer");
      return;
    }
    checkinTimerId = setTimeout(() => {
      checkinTimerId = null;
      triggerLocalCheckin("timer");
    }, delay);
    console.log("[session][checkin] temporizador activo", { reason, delay });
  }

  function computeCheckinDelay() {
    if (!lastCheckinAt) return CHECKIN_INTERVAL_MS;
    const elapsed = Date.now() - lastCheckinAt;
    const remaining = CHECKIN_INTERVAL_MS - elapsed;
    return remaining > 0 ? remaining : 0;
  }

  function triggerLocalCheckin(source) {
    if (servicioInfo?.estado === "FINALIZADO") {
      return;
    }
    lastCheckinAt = Date.now();
    if (document.body.classList.contains("alarma-checkin-open")) {
      scheduleLocalCheckin("panel-open");
      return;
    }
    const attempt = Math.min(localCheckinAttempt + 1, 3);
    localCheckinAttempt = attempt;
    const payload = buildLocalCheckinPayload(attempt);
    whenCheckinApiReady(() => {
      try {
        window.Alarma.openCheckinPrompt(payload);
        console.log("[session][checkin] disparo local", { source, attempt });
        scheduleLocalCheckin("loop");
      } catch (err) {
        console.warn("[session][checkin] no se pudo abrir modal", err);
        scheduleLocalCheckin("retry");
      }
    });
  }

  function buildLocalCheckinPayload(attempt) {
    return {
      servicio_id: servicioId,
      empresa: servicioInfo?.empresa || empresaActual || "",
      cliente: servicioInfo?.cliente?.nombre || custSession?.cliente || "",
      placa:
        servicioInfo?.placa ||
        servicioInfo?.placa_upper ||
        custSession?.placa ||
        "S/N",
      tipo: servicioInfo?.tipo || custSession?.tipo_custodia || "",
      metadata: {
        channel: "checkin-local",
        attempt,
      },
    };
  }

  function clearLocalCheckinTimer(reason) {
    if (!checkinTimerId) return;
    clearTimeout(checkinTimerId);
    checkinTimerId = null;
    if (reason) {
      console.log("[session][checkin] temporizador reset", { reason });
    }
  }

  function cleanupCheckinMonitoring(reason = "cleanup") {
    clearLocalCheckinTimer(reason);
    if (checkinSubStop) {
      try {
        checkinSubStop();
      } catch (_) {}
      checkinSubStop = null;
    }
    try {
      window.Alarma?.stopCheckinAudio?.(reason);
      window.Alarma?.closeCheckinPrompt?.(reason);
    } catch (err) {
      console.warn("[session][checkin] cleanup error", err);
    }
    if (reason && reason.includes("finalizado")) {
      console.log("[checkin] servicio finalizado", { reason });
    }
  }
  /* === END HU:HU-CHECKIN-15M === */

  function handleServicioUpdate(row) {
    if (!row) return;
    servicioInfo = { ...(servicioInfo || {}), ...row };
    if (estadoTextoEl && row.estado) {
      estadoTextoEl.textContent = row.estado;
      estadoTextoEl.style.color =
        row.estado === "FINALIZADO" ? "#2e7d32" : "#f57c00";
    }
    if (row.destino_texto && destinoTextoEl) {
      destinoTextoEl.textContent = row.destino_texto;
    }
    if (Object.prototype.hasOwnProperty.call(row, "last_checkin_at")) {
      lastCheckinAt = row.last_checkin_at
        ? Date.parse(row.last_checkin_at)
        : null;
      scheduleLocalCheckin("db-update");
    }
    if (row.estado === "FINALIZADO") {
      cleanupCheckinMonitoring("servicio-finalizado");
      // === BEGIN HU:HU-RUTA-TRAZADO Ruta Partida-Destino (NO TOCAR FUERA) ===
      clearRouteLayer("servicio-finalizado");
      // === END HU:HU-RUTA-TRAZADO ===
    }
    if (row.finished_at) {
      if (row.finished_by_sc_id === servicioCustodioId) {
        window.CustodiaSession?.clear?.();
        return;
      }
      showFinishModal(row.finished_by_sc_id);
    }
  }

  async function showFinishModal(byCustodioId) {
    window.CustodiaSession?.clear?.();
    cleanupCheckinMonitoring("finalizado-remoto");
    if (finishModal) return;
    let nombre = "otro custodio";
    if (byCustodioId) {
      try {
        const { data } = await window.sb
          .from("servicio_custodio")
          .select("nombre_custodio")
          .eq("id", byCustodioId)
          .maybeSingle();
        // === BEGIN HU:HU-CUSTODIA-UPDATE-FIX (NO TOCAR FUERA) ===
        console.log("[custodia-read]", {
          scope: "mapa/showFinishModal",
          servicio_custodio_id: byCustodioId,
          found: Boolean(data?.nombre_custodio),
        });
        // === END HU:HU-CUSTODIA-UPDATE-FIX ===
        if (data?.nombre_custodio) nombre = data.nombre_custodio;
      } catch (err) {
        console.warn("[mapa] no se pudo obtener custodio finalizador", err);
        // === BEGIN HU:HU-CUSTODIA-UPDATE-FIX (NO TOCAR FUERA) ===
        console.warn("[error]", {
          scope: "mapa/showFinishModal",
          message: err?.message || "unknown",
        });
        // === END HU:HU-CUSTODIA-UPDATE-FIX ===
      }
    }
    finishModal = document.createElement("div");
    finishModal.style.position = "fixed";
    finishModal.style.inset = "0";
    finishModal.style.background = "rgba(0,0,0,.55)";
    finishModal.style.display = "flex";
    finishModal.style.alignItems = "center";
    finishModal.style.justifyContent = "center";
    finishModal.style.zIndex = "6000";
    finishModal.innerHTML = `
      <div style="background:#fff;padding:24px;border-radius:14px;max-width:420px;width:90%;text-align:center;box-shadow:0 18px 40px rgba(0,0,0,.35);">
        <h3 style="margin-top:0;">Servicio finalizado</h3>
        <p style="margin:16px 0;">SERVICIO FUE FINALIZADO POR <strong>${nombre.toUpperCase()}</strong></p>
        <button id="finish-return" class="mdl-button mdl-js-button mdl-button--raised mdl-button--accent">RETORNAR A LA PANTALLA PRINCIPAL</button>
      </div>
    `;
    document.body.appendChild(finishModal);
    document.getElementById("finish-return")?.addEventListener("click", () => {
      location.replace("/html/dashboard/custodia-registros.html");
    });
  }

  async function onPos(lat, lng, pinUser, coords = null) {
    if (!map) return;
    extendSession();
    // === BEGIN HU:HU-MAPA-CARRITO Mapa-resguardo: icono carrito (NO TOCAR FUERA) ===
    const desiredKey = buildMarkerKey();
    if (!markerYo || markerYoKey !== desiredKey) {
      if (markerYo) {
        try {
          map.removeLayer(markerYo);
        } catch {}
      }
      markerYo = L.marker([lat, lng], {
        title: custodioNombre,
        icon: ICON.carrito,
      }).addTo(map);
      markerYoKey = desiredKey;
      if (custodioNombre) {
        markerYo.bindTooltip(custodioNombre, {
          direction: "top",
          offset: [0, -18],
          permanent: true,
          className: "custodia-marker-tooltip",
        });
      }
      console.log("[mapa][icon] set carrito", {
        servicio_custodio_id: servicioCustodioId,
        servicio_id: servicioId,
      });
      if (!destino) map.setView([lat, lng], 14);
    } else {
      markerYo.setLatLng([lat, lng]);
    }
    // === END HU:HU-MAPA-CARRITO ===
    // === BEGIN HU:HU-RUTA-TRAZADO Ruta Partida-Destino (NO TOCAR FUERA) ===
    if (destino) {
      ensureRoute(lat, lng);
    }
    // === END HU:HU-RUTA-TRAZADO ===

    if (panicBtn && hasAlarma) {
      panicBtn.disabled = false;
    }

    if (hasAlarma && typeof window.Alarma?.setLocation === "function") {
      try {
        window.Alarma.setLocation(lat, lng, {
          accuracy: coords?.accuracy ?? null,
        });
      } catch (err) {
        console.warn("[alarma] setLocation", err);
      }
    }

    if (destino && distanciaLabel) {
      const d = Math.round(distanciaM(lat, lng, destino.lat, destino.lng));
      distanciaLabel.textContent = `${d} m`;
      if (btnFinalizar) btnFinalizar.disabled = d > ARRIVE_M;
    }

    const now = Date.now();
    if (now - lastSent > SEND_EVERY_MS) {
      lastSent = now;
      registrarUbicacionSeguro({
        servicioId,
        lat,
        lng,
        servicioCustodioId,
      });
    }
  }

  if (btnFinalizar) {
    btnFinalizar.addEventListener("click", async () => {
      extendSession();
      let ok = true;
      if (destino && markerYo) {
        const posActual = markerYo.getLatLng();
        const d = Math.round(
          distanciaM(posActual.lat, posActual.lng, destino.lat, destino.lng)
        );
        ok =
          d <= ARRIVE_M ||
          confirm(`Aun estas a ${d} m del destino. Finalizar de todos modos?`);
      } else {
        ok = confirm(
          "No se pudo verificar distancia. Finalizar de todos modos?"
        );
      }
      if (!ok) return;
      try {
        const finishedAt = new Date().toISOString();
        const { error } = await window.sb
          .from("servicio")
          .update({
            estado: "FINALIZADO",
            finished_at: finishedAt,
            finished_by_sc_id: servicioCustodioId,
          })
          .eq("id", servicioId);
        if (error) throw error;
        if (estadoTextoEl) {
          estadoTextoEl.textContent = "FINALIZADO";
          estadoTextoEl.style.color = "#2e7d32";
        }
        try {
          await window.Alarma?.emit?.("finalize", {
            servicio_id: servicioId,
            servicio_custodio_id: servicioCustodioId,
            empresa: servicioInfo?.empresa || empresaActual || null,
            cliente: servicioInfo?.cliente?.nombre || null,
            placa: servicioInfo?.placa || servicioInfo?.placa_upper || null,
            tipo: servicioInfo?.tipo || null,
            metadata: { origen: "mapa-resguardo" },
          });
        } catch (err) {
          console.warn("[alarma] emit finalize", err);
        }
        window.CustodiaSession?.clear?.();
        showMsg("Servicio finalizado correctamente.");
        btnFinalizar.disabled = true;
        cleanupCheckinMonitoring("finalizado-manual");
        setTimeout(() => {
          location.href = DASHBOARD_URL;
        }, REDIRECT_DELAY);
      } catch (err) {
        console.error("[mapa] finalizar servicio error", err);
        showMsg("No se pudo finalizar el servicio");
      }
    });
  }

  window.addEventListener("beforeunload", () => {
    cleanupChannels();
    cleanupCheckinMonitoring("unload");
    if (sessionTouchTimer) {
      clearInterval(sessionTouchTimer);
      sessionTouchTimer = null;
    }
  });
  cargarServicio();
});

// Exponer helper opcional para otros modulos
function showFollowControl(show) {
  try {
    const mapEl = document.getElementById("map-track");
    if (!mapEl) return;
    let btn = document.getElementById("follow-toggle");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "follow-toggle";
      btn.className = "mdl-button mdl-js-button mdl-button--raised";
      btn.textContent = "Seguir";
      btn.style.position = "absolute";
      btn.style.right = "12px";
      btn.style.top = "12px";
      btn.style.zIndex = 5003;
      mapEl.parentElement?.appendChild(btn);
      btn.addEventListener("click", () => {
        window.__autoFollow = true;
        showFollowControl(false);
      });
    }
    btn.style.display = show ? "inline-flex" : "none";
  } catch {}
}
