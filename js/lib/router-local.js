// router-local.js — Adaptador OSRM/GraphHopper con fallback automático
// Archivo recreado por HU-NO-REVERSIONES para corregir errores de ruteo local

(function () {
  const OSRM_LOCAL = "http://127.0.0.1:5000";
  const OSRM_REMOTE = "https://router.project-osrm.org";
  const OSRM_STORAGE_KEY = "router.osrmBase";
  const OSRM_LOCAL_DOWN = "router.osrmLocalDown";
  const LOCAL_FAIL_THRESHOLD = 3;

  const cfg = {
    provider: "osrm",
    osrmBase: OSRM_LOCAL,
    ghBase: "http://127.0.0.1:8989",
  };
  let localFailStreak = 0;

  // === BEGIN HU:HU-ROUTER-LOCAL-FALLBACK bootstrap (NO TOCAR FUERA) ===
  console.log("[task][HU-ROUTER-LOCAL-FALLBACK] start");
  console.assert(
    typeof AbortController === "function",
    "[task][HU-ROUTER-LOCAL-FALLBACK] AbortController no disponible"
  );

  (function resolveInitialBase() {
    try {
      if (window.ROUTER_OSRM_BASE) {
        cfg.osrmBase = String(window.ROUTER_OSRM_BASE);
        return;
      }
    } catch {}
    try {
      const stored = localStorage.getItem(OSRM_STORAGE_KEY);
      if (stored) {
        cfg.osrmBase = stored;
        return;
      }
    } catch {}
    const isLocalHost = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
    if (!isLocalHost && /127\.0\.0\.1/.test(cfg.osrmBase)) {
      cfg.osrmBase = OSRM_REMOTE;
    }
  })();
  // === END HU:HU-ROUTER-LOCAL-FALLBACK ===

  function rememberOSRMBase(url) {
    try {
      localStorage.setItem(OSRM_STORAGE_KEY, url);
    } catch {}
    cfg.osrmBase = url;
  }

  function shouldSkipLocal() {
    try {
      return sessionStorage.getItem(OSRM_LOCAL_DOWN) === "1";
    } catch {
      return false;
    }
  }

  function markLocalDown(reason) {
    localFailStreak += 1;
    console.warn("[router] local failed → fallback remote", reason);
    if (localFailStreak >= LOCAL_FAIL_THRESHOLD) {
      try {
        sessionStorage.setItem(OSRM_LOCAL_DOWN, "1");
      } catch {}
    }
  }

  function markLocalHealthy() {
    localFailStreak = 0;
    try {
      sessionStorage.removeItem(OSRM_LOCAL_DOWN);
    } catch {}
  }

  function buildNoRoute(reason) {
    const arr = [];
    arr.code = "NoRoute";
    arr.routes = [];
    arr.waypoints = [];
    arr.reason = reason || null;
    console.warn("[router] NoRoute", reason);
    return arr;
  }

  function normalizeOSRMLatLngs(json) {
    const coords = json?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || !coords.length) {
      return buildNoRoute("empty-route");
    }
    const line = coords.map(([lon, lat]) => [lat, lon]);
    line.code = json?.code || "Ok";
    line.routes = json?.routes || [];
    line.waypoints = json?.waypoints || [];
    return line;
  }

  function normalizeGraphHopper(json) {
    const coords = json?.paths?.[0]?.points?.coordinates;
    if (!Array.isArray(coords) || !coords.length) {
      return buildNoRoute("gh-empty");
    }
    const line = coords.map(([lon, lat]) => [lat, lon]);
    line.code = "Ok";
    line.routes = json?.paths || [];
    line.waypoints = [];
    return line;
  }

  async function fetchWithTimeout(url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  async function routeOSRM(from, to) {
    if (!Array.isArray(from) || !Array.isArray(to)) {
      return buildNoRoute("coords-invalid");
    }
    const coordsSegment = `${from[1]},${from[0]};${to[1]},${to[0]}`;
    const path = `/route/v1/driving/${coordsSegment}?overview=full&geometries=geojson`;
    const skipLocal = shouldSkipLocal();
    if (!skipLocal) {
      try {
        const base = cfg.osrmBase || OSRM_LOCAL;
        const res = await fetchWithTimeout(`${base}${path}`, 1200);
        if (!res.ok) throw new Error(`local status ${res.status}`);
        const json = await res.json();
        markLocalHealthy();
        console.log("[router] local OK", base);
        return normalizeOSRMLatLngs(json);
      } catch (err) {
        markLocalDown(err?.message || err);
      }
    } else {
      console.log("[router] local saltado (flag)");
    }

    try {
      const res = await fetchWithTimeout(`${OSRM_REMOTE}${path}`, 6000);
      if (!res.ok) throw new Error(`remote status ${res.status}`);
      const json = await res.json();
      console.log("[router] remote OK", OSRM_REMOTE);
      return normalizeOSRMLatLngs(json);
    } catch (err) {
      if (err?.name === "AbortError") {
        console.warn("[router] remote timeout", err);
      } else {
        console.error("[router] remote failed", err);
      }
      return buildNoRoute(err?.message || "remote-error");
    }
  }

  async function routeGraphHopper(from, to) {
    if (!Array.isArray(from) || !Array.isArray(to)) {
      return buildNoRoute("coords-invalid");
    }
    const url = `${cfg.ghBase}/route?point=${from[0]},${from[1]}&point=${to[0]},${to[1]}&profile=car&points_encoded=false`;
    try {
      const res = await fetchWithTimeout(url, 2500);
      if (!res.ok) throw new Error(`GraphHopper ${res.status}`);
      const json = await res.json();
      console.log("[router] graphhopper OK", cfg.ghBase);
      return normalizeGraphHopper(json);
    } catch (err) {
      console.error("[router] graphhopper failed", err);
      return buildNoRoute(err?.message || "graphhopper-error");
    }
  }

  async function route(fromLatLng, toLatLng) {
    if (cfg.provider === "graphhopper") {
      return routeGraphHopper(fromLatLng, toLatLng);
    }
    return routeOSRM(fromLatLng, toLatLng);
  }

  function setProvider(p) {
    if (p === "osrm" || p === "graphhopper") cfg.provider = p;
  }
  function setOSRMBase(u) {
    if (typeof u !== "string" || !u.trim()) return;
    rememberOSRMBase(u);
  }
  function setGraphHopperBase(u) {
    if (typeof u !== "string" || !u.trim()) return;
    cfg.ghBase = u;
  }

  window.routerLocal = {
    route,
    setProvider,
    setOSRMBase,
    setGraphHopperBase,
    cfg,
  };
  console.log("[task][HU-ROUTER-LOCAL-FALLBACK] done");
})();
