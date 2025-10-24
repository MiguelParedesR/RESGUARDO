// dashboard-admin.js – Sidebar + Mapa + Supabase + Alertas

document.addEventListener('DOMContentLoaded', () => {
    const snackbar = document.getElementById('app-snackbar');
    const showMsg = (message) => {
        try { snackbar?.MaterialSnackbar?.showSnackbar({ message }); } catch { alert(message); }
    };

    // Toggle sidebar (móvil)
    document.getElementById('btn-toggle').addEventListener('click', () => {
        document.body.classList.toggle('sidebar-open');
    });

    // Filtros
    const fEstado = document.getElementById('f-estado');
    const fEmpresa = document.getElementById('f-empresa');
    const fTexto = document.getElementById('f-texto');
    document.getElementById('btn-aplicar').addEventListener('click', loadServices);
    document.getElementById('btn-reset').addEventListener('click', () => {
        fEstado.value = 'ACTIVO'; fEmpresa.value = 'TODAS'; fTexto.value = ''; loadServices();
    });

    // Contenedores
    const listado = document.getElementById('listado');
    const mapTitle = document.getElementById('map-title');
    const metricPing = document.getElementById('metric-ping');
    const metricEstado = document.getElementById('metric-estado');
    const details = document.getElementById('details');
    const btnFinalizar = document.getElementById('btn-finalizar');

    // Map
    let map;
    const markers = new Map(); // id -> marker
    let selectedId = null;

    function initMap() {
        map = L.map('map-admin');
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19, attribution: '&copy; OpenStreetMap'
        }).addTo(map);
        map.setView([-12.0464, -77.0428], 12); // Lima
    }
    initMap();

    // Config
    const POLL_MS = 30_000;
    const STALE_MIN = 5;
    const beeped = new Set();

    const fmtDT = (iso) => {
        try {
            const d = new Date(iso);
            return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima' }).format(d);
        } catch { return iso || ''; }
    };
    const minDiff = (a, b) => Math.round((a - b) / 60000);

    function beep() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = 'sine'; o.frequency.value = 880;
            o.connect(g); g.connect(ctx.destination);
            g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
            o.start(); setTimeout(() => { g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15); o.stop(ctx.currentTime + 0.2); }, 160);
        } catch { }
    }

    // Cargar servicios
    async function loadServices() {
        if (!window.sb) { showMsg('Supabase no inicializado'); return; }

        try {
            const q = window.sb.from('servicio')
                .select('id,empresa,placa,estado,tipo,created_at,destino_texto,cliente:cliente_id(nombre)')
                .order('created_at', { ascending: false });

            const estado = fEstado.value;
            if (estado !== 'TODOS') q.eq('estado', estado);

            const emp = fEmpresa.value;
            if (emp !== 'TODAS') q.eq('empresa', emp);

            const texto = fTexto.value.trim().toUpperCase();
            let { data, error } = await q;
            if (error) throw error;

            // Filtro textual local (cliente/placa)
            if (texto) {
                data = data.filter(s =>
                    (s.placa || '').toUpperCase().includes(texto) ||
                    (s.cliente?.nombre || '').toUpperCase().includes(texto)
                );
            }

            // Adjuntar último ping
            const enriched = await Promise.all((data || []).map(async s => {
                const { data: ping } = await window.sb
                    .from('ubicacion')
                    .select('lat,lng,created_at')
                    .eq('servicio_id', s.id)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                return { ...s, lastPing: ping || null };
            }));

            renderList(enriched);
            updateMarkers(enriched.filter(x => x.estado === 'ACTIVO'));

            // Si hay uno seleccionado, refrescar panel
            if (selectedId) {
                const current = enriched.find(x => x.id === selectedId);
                if (current) showDetails(current);
            }

        } catch (e) {
            console.error(e);
            showMsg('No se pudieron cargar servicios');
        }
    }

    // Render sidebar
    function renderList(services) {
        listado.innerHTML = '';
        if (!services.length) {
            listado.innerHTML = `<div class="card">Sin resultados.</div>`;
            return;
        }

        services.forEach(s => {
            const card = document.createElement('div');
            card.className = 'card';
            if (s.id === selectedId) card.classList.add('active');

            // Ping
            let pingLabel = '—', pingClass = 'ping-ok', alertNow = false;
            if (s.lastPing?.created_at) {
                const mins = minDiff(new Date(), new Date(s.lastPing.created_at));
                pingLabel = `${mins} min`;
                if (mins >= STALE_MIN && s.estado === 'ACTIVO') { pingClass = 'ping-warn'; alertNow = true; }
            } else if (s.estado === 'ACTIVO') {
                pingLabel = 'sin datos'; pingClass = 'ping-warn'; alertNow = true;
            }

            // Beep
            if (alertNow) { if (!beeped.has(s.id)) { beep(); beeped.add(s.id); } }
            else { beeped.delete(s.id); }

            const tagClass = s.estado === 'FINALIZADO' ? 't-final' : (pingClass === 'ping-warn' ? 't-alerta' : 't-activo');

            card.innerHTML = `
        <div class="title">
          <div><strong>#${s.id}</strong> · ${s.placa || '—'}</div>
          <span class="tag ${tagClass}">${s.estado}</span>
        </div>
        <div class="meta">
          <span class="pill">${s.empresa}</span>
          <span class="pill">${s.tipo || '—'}</span>
        </div>
        <div><strong>Cliente:</strong> ${s.cliente?.nombre || '—'}</div>
        <div><strong>Destino:</strong> ${s.destino_texto || '—'}</div>
        <div class="${pingClass}"><strong>Último ping:</strong> ${pingLabel}</div>
        <div class="meta">Creado: ${fmtDT(s.created_at)}</div>
        <div class="row-actions">
          <button class="btn" data-act="ver" data-id="${s.id}">Ver en mapa</button>
          <button class="btn btn-accent" data-act="fin" data-id="${s.id}" ${s.estado === 'FINALIZADO' ? 'disabled' : ''}>Finalizar</button>
        </div>
      `;

            card.addEventListener('click', async (e) => {
                const btn = e.target.closest('button[data-act]');
                if (!btn) { selectService(s); return; }
                const act = btn.dataset.act;
                if (act === 'ver') { selectService(s); }
                else if (act === 'fin') { await finalizarServicio(s.id); }
            });

            listado.appendChild(card);
        });
    }

    function selectService(s) {
        selectedId = s.id;
        // Marcar activo
        for (const el of listado.querySelectorAll('.card')) el.classList.remove('active');
        const me = Array.from(listado.children).find(c => c.querySelector('[data-id]')?.dataset.id == s.id || c.textContent.includes(`#${s.id}`));
        if (me) me.classList.add('active');

        // Mostrar en mapa y detalles
        focusMarker(s);
        showDetails(s);

        // En móvil, cerrar lista para ver el mapa completo
        if (window.innerWidth < 840) {
            document.body.classList.remove('sidebar-open');
        }
    }

    // Markers (solo activos)
    function updateMarkers(activos) {
        // Remove missing
        for (const id of Array.from(markers.keys())) {
            if (!activos.find(s => s.id === id)) { markers.get(id).remove(); markers.delete(id); }
        }
        // Upsert
        activos.forEach(s => {
            const p = s.lastPing;
            if (!p?.lat || !p?.lng) return;
            const label = `#${s.id} · ${s.placa || ''} · ${s.cliente?.nombre || ''}`;
            if (!markers.has(s.id)) {
                const m = L.marker([p.lat, p.lng], { title: label }).addTo(map);
                m.bindPopup(`<strong>Servicio #${s.id}</strong><br>${s.empresa} · ${s.cliente?.nombre || ''}<br>${s.placa || ''}`);
                markers.set(s.id, m);
            } else {
                const m = markers.get(s.id);
                m.setLatLng([p.lat, p.lng]);
                m.setPopupContent(`<strong>Servicio #${s.id}</strong><br>${s.empresa} · ${s.cliente?.nombre || ''}<br>${s.placa || ''}`);
            }
        });
    }

    function focusMarker(s) {
        const m = markers.get(s.id);
        if (m) { map.setView(m.getLatLng(), 15); m.openPopup(); }
    }

    function showDetails(s) {
        mapTitle.textContent = `Servicio #${s.id} – ${s.empresa}`;
        metricEstado.textContent = s.estado;
        if (s.lastPing?.created_at) {
            const mins = minDiff(new Date(), new Date(s.lastPing.created_at));
            metricPing.textContent = `${mins} min`;
            metricPing.className = mins >= STALE_MIN && s.estado === 'ACTIVO' ? 'ping-warn' : 'ping-ok';
        } else {
            metricPing.textContent = s.estado === 'ACTIVO' ? 'sin datos' : '—';
            metricPing.className = s.estado === 'ACTIVO' ? 'ping-warn' : '';
        }

        details.innerHTML = `
      <div><strong>Empresa:</strong> ${s.empresa}</div>
      <div><strong>Cliente:</strong> ${s.cliente?.nombre || '—'}</div>
      <div><strong>Placa:</strong> ${s.placa || '—'}</div>
      <div><strong>Tipo:</strong> ${s.tipo || '—'}</div>
      <div><strong>Destino:</strong> ${s.destino_texto || '—'}</div>
      <div><strong>Creado:</strong> ${fmtDT(s.created_at)}</div>
      <div><button id="btn-finalizar" class="mdl-button mdl-js-button mdl-button--raised mdl-button--accent" ${s.estado === 'FINALIZADO' ? 'disabled' : ''}>Finalizar servicio</button></div>
    `;
        // Reasignar handler al botón recién pintado
        const btn = document.getElementById('btn-finalizar');
        if (btn) {
            btn.addEventListener('click', async () => { await finalizarServicio(s.id); });
        }
    }

    async function finalizarServicio(id) {
        const ok = confirm(`¿Finalizar el servicio #${id}?`);
        if (!ok) return;
        try {
            const { error } = await window.sb.from('servicio').update({ estado: 'FINALIZADO' }).eq('id', id);
            if (error) throw error;
            showMsg('Servicio finalizado');
            await loadServices();
        } catch (e) {
            console.error(e);
            showMsg('No se pudo finalizar el servicio');
        }
    }

    // Auto-refresh
    setInterval(loadServices, POLL_MS);
    loadServices();
});
