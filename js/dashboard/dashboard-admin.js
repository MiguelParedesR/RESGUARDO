// Dashboard Admin — limpio y estable (Lista + Filtros/Mapa)
document.addEventListener('DOMContentLoaded', () => {
  const h = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  const snackbar = document.getElementById('app-snackbar');
  const showMsg = (message) => { try { snackbar?.MaterialSnackbar?.showSnackbar({ message }); } catch { alert(message); } };

  // Estado de mapa debe declararse antes de cualquier uso para evitar TDZ
  let map; const markers = new Map(); let selectedId = null;

  // Vistas: desktop muestra ambos paneles; mobile alterna
  const root = document.body;
  const isDesktop = () => window.matchMedia('(min-width: 1024px)').matches;
  function showPanel(name) {
    if (isDesktop()) { ensureMap(); requestAnimationFrame(() => { try { map?.invalidateSize?.(); } catch { } }); return; }
    const filtros = name === 'filtros';
    root.classList.toggle('view-filtros', filtros);
    root.classList.toggle('view-lista', !filtros);
    setTimeout(() => { try { map?.invalidateSize?.(); } catch { } }, 60);
  }
  document.getElementById('btn-toggle').addEventListener('click', () => showPanel('lista'));
  document.getElementById('btn-filtros').addEventListener('click', () => showPanel('filtros'));
  if (isDesktop()) { ensureMap(); } else { root.classList.add('view-lista'); }
  window.addEventListener('resize', () => { if (isDesktop()) { root.classList.remove('view-lista', 'view-filtros'); ensureMap(); requestAnimationFrame(() => { try { map?.invalidateSize?.(); } catch { } }); } });

  // Filtros
  const fEstado = document.getElementById('f-estado');
  const fEmpresa = document.getElementById('f-empresa');
  const fTexto = document.getElementById('f-texto');
  document.getElementById('btn-aplicar').addEventListener('click', () => { loadServices(); });
  document.getElementById('btn-reset').addEventListener('click', () => { fEstado.value = 'ACTIVO'; fEmpresa.value = 'TODAS'; fTexto.value = ''; loadServices(); });

  // UI refs
  const listado = document.getElementById('listado');
  const countLabel = document.getElementById('count-label');
  const mapTitle = document.getElementById('map-title');
  const metricPing = document.getElementById('metric-ping');
  const metricEstado = document.getElementById('metric-estado');
  const details = document.getElementById('details');

  // Mapa
  function initMap() {
    map = L.map('map-admin');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    map.setView([-12.0464, -77.0428], 12);
  }
  function ensureMap() { if (!map) { initMap(); } }

  // Utilidades
  const POLL_MS = 30000; const STALE_MIN = 5; const beeped = new Set();
  const fmtDT = (iso) => { try { return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima' }).format(new Date(iso)); } catch { return iso || ''; } };
  const minDiff = (a, b) => Math.round((a - b) / 60000);
  function beep() { try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01); o.start(); setTimeout(() => { g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15); o.stop(ctx.currentTime + 0.2); }, 160); } catch { } }
  async function fetchRoute(from, to) {
    try {
      // sugerencia: mover a tracking-common.routeLocal y eliminar duplicado
      if (window.trackingCommon?.routeLocal) return await window.trackingCommon.routeLocal(from, to);
      if (window.routerLocal?.route) return await window.routerLocal.route(from, to);
      return null;
    } catch (e) { console.warn('[admin] local route error', e); return null; }
  }

  // Datos
  async function loadServices() {
    if (!window.sb) { showMsg('Supabase no inicializado'); return; }
    try {
      const q = window.sb.from('servicio')
        .select('id,empresa,placa,estado,tipo,created_at,destino_texto,destino_lat,destino_lng,cliente:cliente_id(nombre)')
        .order('created_at', { ascending: false });
      if (fEstado.value !== 'TODOS') q.eq('estado', fEstado.value);
      if (fEmpresa.value !== 'TODAS') q.eq('empresa', fEmpresa.value);
      let { data, error } = await q; if (error) throw error;
      const texto = fTexto.value.trim().toUpperCase();
      if (texto) { data = (data || []).filter(s => (s.placa || '').toUpperCase().includes(texto) || (s.cliente?.nombre || '').toUpperCase().includes(texto)); }
      const enriched = await Promise.all((data || []).map(async s => {
        try {
          const { data: ping, error: pingErr } = await window.sb
            .from('ubicacion')
            .select('id,lat,lng')
            .eq('servicio_id', s.id)
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (pingErr) {
            console.warn('[admin] ubicacion query error', pingErr);
          }
          return { ...s, lastPing: ping || null };
        } catch (e) {
          console.warn('[admin] ubicacion query exception', e);
          return { ...s, lastPing: null };
        }
      }));
      renderList(enriched);
      updateMarkers(enriched.filter(x => x.estado === 'ACTIVO'));
      // Mantener seguimiento centrado en el admin: si hay seleccionado, actualiza detalles y ruta
      if (selectedId) {
        const cur = enriched.find(x => x.id === selectedId);
        if (cur) { showDetails(cur); try { await focusMarker(cur); } catch {} }
      }
    } catch (e) { console.error(e); showMsg('No se pudieron cargar servicios'); }
  }

  function renderList(services) {
    listado.innerHTML = ''; countLabel.textContent = services.length;
    if (!services.length) { listado.innerHTML = '<div class="card">Sin resultados.</div>'; return; }
    services.forEach(s => {
      const card = document.createElement('div'); card.className = 'card'; if (s.id === selectedId) card.classList.add('active');
      let pingLabel = '-', pingClass = 'ping-ok', alertNow = false;
      if (s.lastPing?.created_at) { const mins = minDiff(new Date(), new Date(s.lastPing.created_at)); pingLabel = `${mins} min`; if (mins >= STALE_MIN && s.estado === 'ACTIVO') { pingClass = 'ping-warn'; alertNow = true; } }
      else if (s.estado === 'ACTIVO') { pingLabel = 'sin datos'; pingClass = 'ping-warn'; alertNow = true; }
      if (alertNow) { if (!beeped.has(s.id)) { beep(); beeped.add(s.id); } } else { beeped.delete(s.id); }
      const tagClass = s.estado === 'FINALIZADO' ? 't-final' : (pingClass === 'ping-warn' ? 't-alerta' : 't-activo');
      card.innerHTML = `
        <div class="title"><div><strong>#${s.id}</strong> - ${h(s.placa || '-')}</div><span class="tag ${tagClass}">${h(s.estado)}</span></div>
        <div class="meta"><span class="pill">${h(s.empresa)}</span><span class="pill">${h(s.tipo || '-')}</span></div>
        <div><strong>Cliente:</strong> ${h(s.cliente?.nombre || '-')}</div>
        <div><strong>Destino:</strong> ${h(s.destino_texto || '-')}</div>
        <div class="${pingClass}"><strong>Último ping:</strong> ${pingLabel}</div>
        <div class="meta">Creado: ${fmtDT(s.created_at)}</div>
        <div class="row-actions">
          <button class="btn" data-act="ver" data-id="${s.id}">Ver en mapa</button>
          <button class="btn btn-accent" data-act="fin" data-id="${s.id}" ${s.estado === 'FINALIZADO' ? 'disabled' : ''}>Finalizar</button>
        </div>`;
      card.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) { selectService(s); return; }
        if (btn.dataset.act === 'ver') { selectService(s); }
        else if (btn.dataset.act === 'fin') { await finalizarServicio(s.id); }
      });
      listado.appendChild(card);
    });
  }

  function selectService(s) {
    selectedId = s.id; for (const el of listado.querySelectorAll('.card')) el.classList.remove('active');
    const me = [...listado.children].find(el => el.innerText.includes(`#${s.id}`)); me?.classList.add('active');
    if (!isDesktop()) showPanel('filtros');
    focusMarker(s); showDetails(s);
  }

  // Markers + fitBounds
  function updateMarkers(activos) {
    // sugerencia: este método comparte responsabilidades (gestión markers + layout bounds).
    // Conviene extraer markers a un gestor y dejar solo layout aquí o moverlo a tracking-common.
    ensureMap();
    if (!map) return;
    for (const id of Array.from(markers.keys())) { if (!activos.find(s => s.id === id)) { markers.get(id).remove(); markers.delete(id); } }
    const bounds = [];
    activos.forEach(s => { const p = s.lastPing; if (!p?.lat || !p?.lng) return; const label = `#${s.id} - ${h(s.placa || '')} - ${h(s.cliente?.nombre || '')}`; const popup = `<strong>Servicio #${s.id}</strong><br>${h(s.empresa)} - ${h(s.cliente?.nombre || '')}<br>${h(s.placa || '')}<br>Destino: ${h(s.destino_texto || '-')}`; if (!markers.has(s.id)) { const m = L.marker([p.lat, p.lng], { title: label }).addTo(map); m.bindPopup(popup); markers.set(s.id, m); } else { const m = markers.get(s.id); m.setLatLng([p.lat, p.lng]); m.setPopupContent(popup); } bounds.push([p.lat, p.lng]); });
    if (bounds.length) { const b = L.latLngBounds(bounds); map.fitBounds(b, { padding: [40, 40], maxZoom: 16 }); } else { map.setView([-12.0464, -77.0428], 12); }
  }

  let selectionLayer = null;
  let lastRouteSig = '';
  async function focusMarker(s) {
    // sugerencia: extraer esta función a tracking-common.drawRouteWithPOIs + tracking-common.routeLocal
    // para reutilizar en la vista de resguardo sin duplicar.
    ensureMap();
    if (!map) return;
    const p = s.lastPing;
    if (!p?.lat || !p?.lng) return;
    const label = `#${s.id} - ${h(s.placa || '')} - ${h(s.cliente?.nombre || '')}`;
    const popup = `<strong>Servicio #${s.id}</strong><br>${h(s.empresa)} - ${h(s.cliente?.nombre || '')}<br>${h(s.placa || '')}<br>Destino: ${h(s.destino_texto || '-')}`;
    let m = markers.get(s.id);
    if (!m) {
      m = L.marker([p.lat, p.lng], { title: label }).addTo(map);
      m.bindPopup(popup);
      markers.set(s.id, m);
    } else {
      m.setLatLng([p.lat, p.lng]);
      m.setPopupContent(popup);
    }
    // Limpia capa anterior y dibuja ruta/POIs
    try { if (selectionLayer) selectionLayer.remove(); } catch {}
    selectionLayer = L.layerGroup().addTo(map);
    const start = [p.lat, p.lng];
    const hasDestino = (s.destino_lat != null && s.destino_lng != null);
    const pinUser = L.divIcon({ className: 'pin-user', html: '&#128205;', iconSize: [24,24], iconAnchor: [12,24] });
    L.marker(start, { icon: pinUser, title: 'Partida/Actual' })
      .bindTooltip('Partida/Actual')
      .addTo(selectionLayer);
    if (hasDestino) {
      const dest = [s.destino_lat, s.destino_lng];
      const pinDest = L.divIcon({ className: 'pin-dest', html: '&#128204;', iconSize: [24,24], iconAnchor: [12,24] });
      L.marker(dest, { icon: pinDest, title: 'Destino' })
        .bindTooltip('Destino')
        .addTo(selectionLayer);
      const route = await fetchRoute(start, dest);
      if (route && route.length) {
        L.polyline(route, { color: '#1e88e5', weight: 4, opacity: 0.95 }).addTo(selectionLayer);
        const sig = String(route[0]) + '|' + String(route[route.length-1]) + '|' + route.length;
        if (sig !== lastRouteSig) { lastRouteSig = sig; beep(); }
        const b = L.latLngBounds(route);
        map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
      } else {
        L.polyline([start, dest], { color: '#455a64', weight: 3, opacity: 0.85, dashArray: '6,4' }).addTo(selectionLayer);
        const b = L.latLngBounds([start, dest]);
        map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
      }
    } else {
      map.setView(m.getLatLng(), 15);
    }
    try { m.openPopup(); } catch {}
  }
  function showDetails(s) { mapTitle.textContent = `Servicio #${s.id} - ${s.empresa}`; if (s.lastPing?.created_at) { const mins = minDiff(new Date(), new Date(s.lastPing.created_at)); metricPing.textContent = `${mins} min`; metricPing.className = mins >= STALE_MIN && s.estado === 'ACTIVO' ? 'ping-warn' : 'ping-ok'; } else { metricPing.textContent = s.estado === 'ACTIVO' ? 'sin datos' : '-'; metricPing.className = s.estado === 'ACTIVO' ? 'ping-warn' : ''; } metricEstado.textContent = s.estado; details.innerHTML = `<div><strong>Empresa:</strong> ${s.empresa}</div><div><strong>Cliente:</strong> ${s.cliente?.nombre || '-'}</div><div><strong>Placa:</strong> ${s.placa || '-'}</div><div><strong>Tipo:</strong> ${s.tipo || '-'}</div><div><strong>Destino:</strong> ${s.destino_texto || '-'}</div><div><strong>Creado:</strong> ${fmtDT(s.created_at)}</div><div><button id="btn-finalizar" class="mdl-button mdl-js-button mdl-button--raised mdl-button--accent" ${s.estado === 'FINALIZADO' ? 'disabled' : ''}>Finalizar servicio</button></div>`; document.getElementById('btn-finalizar')?.addEventListener('click', async () => { await finalizarServicio(s.id); }); }
  async function finalizarServicio(id) { const ok = confirm(`Finalizar el servicio #${id}?`); if (!ok) return; try { const { error } = await window.sb.from('servicio').update({ estado: 'FINALIZADO' }).eq('id', id); if (error) throw error; showMsg('Servicio finalizado'); await loadServices(); } catch (e) { console.error(e); showMsg('No se pudo finalizar el servicio'); } }

  // Auto refresh
  setInterval(loadServices, 30000); loadServices();
});
