// router-local.js — Adaptador de ruteo local (OSRM/GraphHopper)
// Objetivo: ejecutar ruteo 100% local contra instancias en 127.0.0.1
// Soporta:
//  - OSRM:  http://127.0.0.1:5000/route/v1/driving/{lon1},{lat1};{lon2},{lat2}?overview=full&geometries=geojson
//  - GraphHopper: http://127.0.0.1:8989/route?point=lat,lon&point=lat,lon&profile=car&points_encoded=false


(function () {
  const defaultOSRM = 'https://router.project-osrm.org';
  const isLocalHost = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
  const cfg = {
    provider: 'osrm',
    osrmBase: isLocalHost ? 'http://127.0.0.1:5000' : defaultOSRM,
    ghBase: 'http://127.0.0.1:8989',
  };
  try {
    const ls = localStorage.getItem('router.osrmBase');
    if (ls) cfg.osrmBase = ls;
    if (window.ROUTER_OSRM_BASE) cfg.osrmBase = String(window.ROUTER_OSRM_BASE);
  } catch {}

  async function routeOSRM(from, to) {
    const build = (base) => `${base}/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
    let url = build(cfg.osrmBase);
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('OSRM ' + r.status);
      const j = await r.json();
      const coords = j?.routes?.[0]?.geometry?.coordinates || [];
      return coords.map(([lon, lat]) => [lat, lon]);
    } catch (e) {
      // Fallback to public OSRM if local blocked by CSP o falla
      if (cfg.osrmBase.indexOf('127.0.0.1') >= 0 || cfg.osrmBase.indexOf('localhost') >= 0) {
        const r2 = await fetch(build(defaultOSRM));
        if (!r2.ok) throw e;
        const j2 = await r2.json();
        const coords2 = j2?.routes?.[0]?.geometry?.coordinates || [];
        return coords2.map(([lon, lat]) => [lat, lon]);
      }
      throw e;
    }
  }

  async function routeGraphHopper(from, to) {
    const url = `${cfg.ghBase}/route?point=${from[0]},${from[1]}&point=${to[0]},${to[1]}&profile=car&points_encoded=false`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('GraphHopper ' + r.status);
    const j = await r.json();
    const coords = j?.paths?.[0]?.points?.coordinates || [];
    return coords.map(([lon, lat]) => [lat, lon]);
  }

  async function route(fromLatLng, toLatLng) {
    if (!Array.isArray(fromLatLng) || !Array.isArray(toLatLng)) return null;
    if (cfg.provider === 'graphhopper') return routeGraphHopper(fromLatLng, toLatLng);
    return routeOSRM(fromLatLng, toLatLng);
  }

  function setProvider(p) { if (p === 'osrm' || p === 'graphhopper') cfg.provider = p; }
  function setOSRMBase(u) { cfg.osrmBase = String(u); }
  function setGraphHopperBase(u) { cfg.ghBase = String(u); }

  window.routerLocal = { route, setProvider, setOSRMBase, setGraphHopperBase, cfg };
})();
