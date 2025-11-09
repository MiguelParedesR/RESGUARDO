// mapa.js - Seguimiento en tiempo real del resguardo
// Requiere: window.sb (config.js) y Leaflet cargado en la pagina.
// La pagina debe tener: <div id="map-track"></div>, <span id="distancia-label"></span>, <button id="btn-finalizar"></button>

document.addEventListener("DOMContentLoaded", () => {
  const servicioId = sessionStorage.getItem("servicio_id_actual");
  if (!servicioId) {
    console.warn("[mapa] servicio_id_actual no encontrado en sessionStorage");
    return;
  }
  if (!window.sb) {
    console.warn("[mapa] Supabase no inicializado (config.js)");
    return;
  }

  const custSession = window.CustodiaSession?.load();
  if (!custSession || custSession.servicio_id !== servicioId) {
    alert(
      "Necesitas seleccionar un custodio usando la opcion SEGUIR antes de abrir el seguimiento."
    );
    location.replace("/html/dashboard/custodia-registros.html");
    return;
  }
  const servicioCustodioId = custSession.servicio_custodio_id;
  if (!servicioCustodioId) {
    alert(
      "No se detecto custodio asignado al servicio. Vuelve a seleccionar SEGUIR antes de continuar."
    );
    location.replace("/html/dashboard/custodia-registros.html");
    return;
  }
  const custodioNombre = custSession.nombre_custodio || "Custodia";
  const custodioTipo = custSession.tipo_custodia || "";
  const extendSession = () => {
    try {
      window.CustodiaSession?.touch();
    } catch {}
  };

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

  // Estado global
  const hasAlarma = typeof window.Alarma === "object";
  const hasPushKey = Boolean(window.APP_CONFIG?.WEB_PUSH_PUBLIC_KEY);
  const empresaActual = (
    sessionStorage.getItem("auth_empresa") || ""
  ).toUpperCase();
  let servicioInfo = null;
  let map = null;
  let markerYo = null;
  let markerDestino = null;
  let destino = null;
  let lastSent = 0;
  let servicioChannel = null;
  let finishModal = null;

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

  async function cargarServicio() {
    try {
      const { data, error } = await window.sb
        .from("servicio")
        .select(
          "id, empresa, placa, tipo, destino_lat, destino_lng, destino_texto, estado, cliente:cliente_id(nombre)"
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
      destino = null;

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

      initMap();
      subscribeServicio();
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

  function iniciarTracking() {
    if (!navigator.geolocation) {
      console.error("[mapa] Geolocalizacion no soportada");
      return;
    }
    const pinUser = L.divIcon({
      className: "pin-user",
      html: "&#128205;",
      iconSize: [24, 24],
      iconAnchor: [12, 24],
    });
    const watchId = navigator.geolocation.watchPosition(
      (pos) =>
        onPos(pos.coords.latitude, pos.coords.longitude, pinUser, pos.coords),
      (err) => {
        console.warn("[mapa] geolocalizacion (watch) error", err);
        onInterval();
        const fallback = setInterval(onInterval, 30_000);
        function onInterval() {
          navigator.geolocation.getCurrentPosition(
            (p) =>
              onPos(p.coords.latitude, p.coords.longitude, pinUser, p.coords),
            () => {},
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
  }

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
    if (finishModal) return;
    let nombre = "otro custodio";
    if (byCustodioId) {
      try {
        const { data } = await window.sb
          .from("servicio_custodio")
          .select("nombre_custodio")
          .eq("id", byCustodioId)
          .maybeSingle();
        if (data?.nombre_custodio) nombre = data.nombre_custodio;
      } catch (err) {
        console.warn("[mapa] no se pudo obtener custodio finalizador", err);
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
    if (!markerYo) {
      markerYo = L.marker([lat, lng], {
        title: "Ubicacion actual",
        icon: pinUser,
      }).addTo(map);
      markerYo.bindPopup("Ubicacion actual");
      if (!destino) map.setView([lat, lng], 14);
    } else {
      markerYo.setLatLng([lat, lng]);
    }

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
        setTimeout(() => {
          location.href = DASHBOARD_URL;
        }, REDIRECT_DELAY);
      } catch (err) {
        console.error("[mapa] finalizar servicio error", err);
        showMsg("No se pudo finalizar el servicio");
      }
    });
  }

  window.addEventListener("beforeunload", cleanupChannels);
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
