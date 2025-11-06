// tracking-common.js
// Sugerencia de módulo compartido para unificar lógica de mapas/rutas entre
// dashboard-admin (autoridad) y la vista de resguardo (solo visualización).
// Objetivo: NO acoplar a frameworks; exponer helpers puros basados en Leaflet.

(function () {
  // Devuelve un L.Map inicializado con OSM
  function initLeafletMap(targetId, center = [-12.0464, -77.0428], zoom = 12) {
    const map = L.map(targetId);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    map.setView(center, zoom);
    return map;
  }

  // Iconos estándar (gratuitos) para start/destino
  function buildIcons() {
    const pinUser = L.divIcon({
      className: "pin-user",
      html: "&#128205;",
      iconSize: [24, 24],
      iconAnchor: [12, 24],
    }); // 📍
    const pinDest = L.divIcon({
      className: "pin-dest",
      html: "&#128204;",
      iconSize: [24, 24],
      iconAnchor: [12, 24],
    }); // 📌
    return { pinUser, pinDest };
  }

  // Dibuja POIs y ruta en un layerGroup (lo limpia si existe)
  function drawRouteWithPOIs(map, layer, start, dest, routeLatLngs) {
    try {
      if (layer) layer.clearLayers();
    } catch {}
    const { pinUser, pinDest } = buildIcons();
    const lg = layer || L.layerGroup().addTo(map);
    L.marker(start, { icon: pinUser, title: "Partida/Actual" })
      .bindTooltip("Partida/Actual")
      .addTo(lg);
    if (dest)
      L.marker(dest, { icon: pinDest, title: "Destino" })
        .bindTooltip("Destino")
        .addTo(lg);
    if (routeLatLngs && routeLatLngs.length) {
      L.polyline(routeLatLngs, {
        color: "#1e88e5",
        weight: 4,
        opacity: 0.95,
      }).addTo(lg);
      map.fitBounds(L.latLngBounds(routeLatLngs), {
        padding: [40, 40],
        maxZoom: 16,
      });
    } else if (dest) {
      L.polyline([start, dest], {
        color: "#455a64",
        weight: 3,
        opacity: 0.85,
        dashArray: "6,4",
      }).addTo(lg);
      map.fitBounds(L.latLngBounds([start, dest]), {
        padding: [40, 40],
        maxZoom: 16,
      });
    } else {
      map.setView(start, 15);
    }
    return lg;
  }

  // Wrapper de ruteo local (OSRM/GraphHopper en localhost) usando router-local.js
  async function routeLocal(start, dest) {
    if (!window.routerLocal || typeof window.routerLocal.route !== "function")
      return null;
    return window.routerLocal.route(start, dest);
  }

  // Beep UX simple
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.value = 0.0001;
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
      o.start();
      setTimeout(() => {
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
        o.stop(ctx.currentTime + 0.2);
      }, 160);
    } catch {}
  }

  // Exponer helpers
  window.trackingCommon = {
    initLeafletMap,
    buildIcons,
    drawRouteWithPOIs,
    routeLocal,
    beep,
  };
})();
