// mapa.js â€“ Seguimiento en tiempo real del resguardo
// Requiere: window.sb (config.js) y Leaflet cargado en la pÃ¡gina.
// La pÃ¡gina debe tener: <div id="map-track"></div>, <span id="distancia-label"></span>, <button id="btn-finalizar"></button>

document.addEventListener('DOMContentLoaded', () => {
    const servicioId = sessionStorage.getItem('servicio_id_actual');
    if (!servicioId) {
        console.warn('[mapa] No hay servicio_id_actual en sessionStorage');
        return;
    }
    if (!window.sb) {
        console.warn('[mapa] Supabase no inicializado (config.js)');
        return;
    }

    // UI
    const mapElId = 'map-track';
    const mapEl = document.getElementById(mapElId);
    if (!mapEl) {
        console.warn(`[mapa] No existe #${mapElId} en el DOM`);
        return;
    }
    const distanciaLabel = document.getElementById('distancia-label');
    const btnFinalizar = document.getElementById('btn-finalizar');
    const estadoTextoEl = document.getElementById('estado-texto');   // opcional en el panel
    const destinoTextoEl = document.getElementById('destino-texto'); // opcional en el panel
    const panicBtn = document.getElementById('alarma-panic-btn');
    const empresaActual = (sessionStorage.getItem('auth_empresa') || '').toUpperCase();
    const hasAlarma = typeof window.Alarma === 'object';
    const hasPushKey = Boolean(window.APP_CONFIG?.WEB_PUSH_PUBLIC_KEY);
    let servicioInfo = null;
    let panicLabelEl = null;
    let panicLabelDefault = '';
    let panicConfirming = false;
    let panicConfirmTimer = null;

    // Snackbar (MDL) con fallback a alert
    const snackbar = document.getElementById('app-snackbar');
    const showMsg = (message) => {
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

    // Estado de tracking
    let map, markerYo, markerDestino;
    let destino = null;        // { lat, lng, texto }
    let lastSent = 0;          // throttle para registrar_ubicacion
    const SEND_EVERY_MS = 30_000; // 30s
    const ARRIVE_M = 50;          // umbral de llegada (metros)
    const REDIRECT_DELAY = 2000;  // 2s
    const DASHBOARD_URL = '/html/dashboard/custodia-registros.html';
    // Ruteo local (OSRM/GraphHopper en 127.0.0.1). Requiere js/lib/router-local.js
    let routeLayer = null, poiLayer = null, lastRouteSig = '';
    function beep() { try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01); o.start(); setTimeout(() => { g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15); o.stop(ctx.currentTime + 0.2); }, 160); } catch { } }

    // Haversine (m)
    function distanciaM(lat1, lon1, lat2, lon2) {
        const R = 6371e3;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // Carga datos del servicio para pintar destino y estado inicial
    async function cargarServicio() {
        const { data, error } = await window.sb
            .from('servicio')
            .select('id, empresa, placa, tipo, destino_lat, destino_lng, destino_texto, estado, cliente:cliente_id(nombre)')
            .eq('id', servicioId)
            .single();

        if (error) { console.error('[mapa] error servicio', error); return; }
        if (!data) { console.error('[mapa] servicio no encontrado'); return; }

        servicioInfo = data;
        if (panicBtn) panicBtn.disabled = true;

        if (data.destino_lat && data.destino_lng) {
            destino = { lat: data.destino_lat, lng: data.destino_lng, texto: data.destino_texto || 'Destino' };
        }

        // Poblar panel informativo si existe
        if (destinoTextoEl) destinoTextoEl.textContent = destino?.texto || 'â€”';
        if (estadoTextoEl) {
            estadoTextoEl.textContent = (data.estado || 'EN CURSO');
            estadoTextoEl.style.color = (data.estado === 'FINALIZADO') ? '#2e7d32' : '#f57c00';
        }

        initMap();
    }

    function initMap() {
        const options = { preferCanvas: true, zoomAnimation: false, markerZoomAnimation: false, wheelDebounceTime: 40 };
        map = L.map(mapElId, options);
        const tl = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19, attribution: '&copy; OpenStreetMap', updateWhenIdle: true, updateWhenZooming: false, keepBuffer: 3, crossOrigin: true
        }).addTo(map);

        window.__autoFollow = true; map.on("dragstart", () => { window.__autoFollow = false; showFollowControl(true); }); map.on("zoomstart", () => { window.__autoFollow = false; showFollowControl(true); });
        if (destino) {
            const pinDest = L.divIcon({
                className: 'pin-dest',
                html: '📌',
                iconSize: [24, 24],
                iconAnchor: [12, 24]
            });
            markerDestino = L.marker([destino.lat, destino.lng], { title: 'Destino', icon: pinDest }).addTo(map);
            try {
                markerDestino.setIcon(L.divIcon({
                    className: 'pin-dest',
                    html: '&#128204;',
                    iconSize: [24, 24],
                    iconAnchor: [12, 24]
                }));
            } catch { }

            try {
                markerDestino.setIcon(L.icon({
                    iconUrl: '/assets/icons/pin-destination.svg',
                    iconRetinaUrl: '/assets/icons/pin-destination.svg',
                    iconSize: [30, 30],
                    iconAnchor: [15, 28],
                    popupAnchor: [0, -28]
                }));
            } catch { }

            map.setView([destino.lat, destino.lng], 14);
        } else {
            map.setView([-12.0464, -77.0428], 12); // Lima
        }

        poiLayer = L.layerGroup().addTo(map);
        routeLayer = L.layerGroup().addTo(map);

        setupPanicButton();
        iniciarTracking();
        // Ruta inicial y refresco periódico
        setTimeout(updateRouteFromMarkers, 2000);
        setInterval(updateRouteFromMarkers, 10000);
    }

    function setPanicLabel(text) {
        if (!panicBtn) return;
        if (panicLabelEl) panicLabelEl.textContent = text;
        else panicBtn.textContent = text;
    }

    function resetPanicConfirm() {
        panicConfirming = false;
        if (panicBtn) {
            panicBtn.classList.remove('is-confirm');
            if (panicConfirmTimer) { clearTimeout(panicConfirmTimer); panicConfirmTimer = null; }
            if (panicLabelDefault) setPanicLabel(panicLabelDefault);
        }
    }

    function setupPanicButton() {
        if (!panicBtn || !hasAlarma) return;
        if (panicBtn.dataset.bound === '1') return;
        panicBtn.dataset.bound = '1';
        panicLabelEl = panicBtn.querySelector('.alarma-panic-btn__label');
        panicLabelDefault = panicLabelEl ? panicLabelEl.textContent : panicBtn.textContent;
        panicBtn.disabled = true;
        panicBtn.addEventListener('click', async () => {
            if (panicBtn.disabled) {
                showMsg('Esperando ubicación GPS…');
                return;
            }
            if (!panicConfirming) {
                panicConfirming = true;
                panicBtn.classList.add('is-confirm');
                setPanicLabel('Confirmar alerta');
                try { navigator.vibrate?.([140, 80, 140]); } catch { }
                panicConfirmTimer = setTimeout(() => resetPanicConfirm(), 4000);
                return;
            }
            resetPanicConfirm();
            const coords = markerYo?.getLatLng();
            if (!coords) {
                showMsg('Necesitamos tu ubicación actual para enviar la alerta.');
                panicBtn.disabled = true;
                return;
            }
            panicBtn.disabled = true;
            try { navigator.vibrate?.([260, 140, 260]); } catch { }
            let direccion = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
            if (typeof window.Alarma?.reverseGeocode === 'function') {
                try { direccion = await window.Alarma.reverseGeocode(coords.lat, coords.lng); } catch (err) { console.warn('[alarma] reverseGeocode', err); }
            }
            try {
                await window.Alarma.emit('panic', {
                    servicio_id: servicioId,
                    empresa: servicioInfo?.empresa || empresaActual || null,
                    cliente: servicioInfo?.cliente?.nombre || null,
                    placa: servicioInfo?.placa || null,
                    tipo: servicioInfo?.tipo || null,
                    lat: coords.lat,
                    lng: coords.lng,
                    direccion,
                    timestamp: new Date().toISOString(),
                    meta: { origen: 'mapa-resguardo' }
                });
                showMsg('Alerta de pánico enviada.');
                try { navigator.vibrate?.([200, 120, 200, 120, 260]); } catch { }
            } catch (err) {
                console.error('[alarma] emit panic', err);
                showMsg('No se pudo enviar la alerta. Se reintentará automáticamente.');
            } finally {
                panicBtn.disabled = false;
                resetPanicConfirm();
            }
        });
    }

    async function updateRouteFromMarkers() {
        // sugerencia: reemplazar esta lógica por tracking-common.drawRouteWithPOIs + trackingStore
        // así esta vista solo consume el mismo flujo de datos que el admin.
        try {
            if (!destino || !markerYo || !routeLayer || !poiLayer) return;
            const p = markerYo.getLatLng();
            let latlngs = null;
            // sugerencia: usar trackingCommon.routeLocal cuando esté disponible
            if (window.trackingCommon?.routeLocal) latlngs = await window.trackingCommon.routeLocal([p.lat, p.lng], [destino.lat, destino.lng]);
            else if (window.routerLocal?.route) latlngs = await window.routerLocal.route([p.lat, p.lng], [destino.lat, destino.lng]);
            if (!Array.isArray(latlngs)) latlngs = [];
            try { routeLayer.clearLayers(); } catch { }
            try { poiLayer.clearLayers(); } catch { }
            L.circleMarker([p.lat, p.lng], { radius: 8, color: '#1976d2', weight: 2, fillColor: '#1976d2', fillOpacity: 0.85 }).addTo(poiLayer).bindTooltip('Partida/Actual');
            L.circleMarker([destino.lat, destino.lng], { radius: 9, color: '#e91e63', weight: 2, fillColor: '#e91e63', fillOpacity: 0.9 }).addTo(poiLayer).bindTooltip('Destino');
            if (latlngs.length) {
                L.polyline(latlngs, { color: '#1e88e5', weight: 5, opacity: 0.95 }).addTo(routeLayer);
                const sig = String(latlngs[0]) + '|' + String(latlngs[latlngs.length - 1]) + '|' + latlngs.length;
                if (sig !== lastRouteSig) { lastRouteSig = sig; beep(); }
            } else {
                L.polyline([[p.lat, p.lng], [destino.lat, destino.lng]], { color: '#455a64', weight: 3, opacity: 0.85, dashArray: '6,4' }).addTo(routeLayer);
            }
        } catch { }
    }

    function iniciarTracking() {
        if (!navigator.geolocation) {
            console.error('[mapa] GeolocalizaciÃ³n no soportada');
            return;
        }

        const pinUser = L.divIcon({ className: 'pin-user', html: '&#128205;', iconSize: [24, 24], iconAnchor: [12, 24] });
        const watchId = navigator.geolocation.watchPosition(
            pos => onPos(pos.coords.latitude, pos.coords.longitude, pinUser, pos.coords),
            err => {
                console.warn('[mapa] watchPosition error, fallback interval', err);
                onInterval();
                setInterval(onInterval, 30_000);
                function onInterval() {
                    navigator.geolocation.getCurrentPosition(
                        p => onPos(p.coords.latitude, p.coords.longitude, pinUser, p.coords),
                        e => console.error('[mapa] getCurrentPosition error', e)
                    );
                }
            },
            { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
        );

        window.addEventListener('beforeunload', () => {
            try { navigator.geolocation.clearWatch(watchId); } catch { }
        });
    }

    async function onPos(lat, lng, pinUser, coords = null) {
        // Pintar/actualizar mi ubicaciÃ³n
        if (!markerYo) {
            markerYo = L.marker([lat, lng], { title: 'UbicaciÃ³n actual' }).addTo(map);
            markerYo.bindPopup('Ubicaci\u00f3n actual');
            try { if (!markerYo.options.icon) { markerYo.setIcon(L.divIcon({ className: 'pin-user', html: '&#128205;', iconSize: [24, 24], iconAnchor: [12, 24] })); } } catch { }
            if (!destino) map.setView([lat, lng], 14);
        } else {
            markerYo.setLatLng([lat, lng]);
        }
        try {
            if (!markerYo.options || !markerYo.options.icon) {
                markerYo.setIcon(L.divIcon({ className: 'pin-user', html: '&#128205;', iconSize: [24, 24], iconAnchor: [12, 24] }));
            }
        } catch { }

        try { markerYo.setIcon(L.icon({ iconUrl: '/assets/icons/custodia-current.svg', iconRetinaUrl: '/assets/icons/custodia-current.svg', iconSize: [32, 32], iconAnchor: [16, 28], popupAnchor: [0, -28] })); } catch { }\r\n        if (panicBtn && hasAlarma) {\r\n            panicBtn.disabled = false;\r\n            resetPanicConfirm();\r\n        }\r\n        if (hasAlarma && typeof window.Alarma?.setLocation === 'function') {\r\n            try { window.Alarma.setLocation(lat, lng, { accuracy: coords?.accuracy ?? null }); } catch (err) { console.warn('[alarma] setLocation', err); }\r\n        }\r\n        // Distancia al destino
        if (destino) {
            const d = Math.round(distanciaM(lat, lng, destino.lat, destino.lng));
            if (distanciaLabel) distanciaLabel.textContent = `${d} m`;
            if (btnFinalizar) btnFinalizar.disabled = d > ARRIVE_M; // habilita si estÃ¡ a <= 50 m
        }

        // Fit/follow: encuadre inicial y seguimiento suave
        try {
            if (destino && markerYo && !window.__fitOnce) {
                const b = L.latLngBounds([markerYo.getLatLng(), [destino.lat, destino.lng]]);
                map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
                window.__fitOnce = true;
            } else if (markerYo && window.__autoFollow !== false) {
                map.panTo(markerYo.getLatLng(), { animate: true });
            }
        } catch { }
        // Enviar a Supabase cada 30s
        const now = Date.now();
        if (now - lastSent > SEND_EVERY_MS) {
            lastSent = now;
            try {
                const { error } = await window.sb.rpc('registrar_ubicacion', {
                    p_servicio_id: servicioId,
                    p_lat: lat,
                    p_lng: lng
                });
                if (error) console.error('[mapa] registrar_ubicacion error', error);
            } catch (e) {
                console.error('[mapa] registrar_ubicacion excepciÃ³n', e);
            }
        }
    }

    // Finalizar servicio + redirecciÃ³n al dashboard
    if (btnFinalizar) {
        btnFinalizar.addEventListener('click', async () => {
            let ok = true;

            // VerificaciÃ³n de distancia si es posible
            if (destino && markerYo) {
                const p = markerYo.getLatLng();
                const d = Math.round(distanciaM(p.lat, p.lng, destino.lat, destino.lng));
                ok = d <= ARRIVE_M || confirm(`AÃºn estÃ¡s a ${d} m del destino. Â¿Finalizar de todos modos?`);
            } else {
                ok = confirm('No se pudo verificar distancia. Â¿Finalizar de todos modos?');
            }
            if (!ok) return;

            try {
                const { error } = await window.sb
                    .from('servicio')
                    .update({ estado: 'FINALIZADO' })
                    .eq('id', servicioId);

                if (error) {
                    console.error('[mapa] finalizar error', error);
                    showMsg('No se pudo finalizar el servicio');
                    return;
                }

                // Actualizar UI del panel si existe
                if (estadoTextoEl) {
                    estadoTextoEl.textContent = 'FINALIZADO';
                    estadoTextoEl.style.color = '#2e7d32';
                }

                showMsg('Servicio finalizado correctamente âœ…');
                setTimeout(() => {
                    location.href = DASHBOARD_URL;
                }, REDIRECT_DELAY);

            } catch (e) {
                console.error(e);
                showMsg('Error al finalizar el servicio');
            }
        });
    }

    // Init
    cargarServicio();
});




// Follow toggle control button on map container
function showFollowControl(show) {
    try {
        const mapEl = document.getElementById('map-track');
        if (!mapEl) return;
        let btn = document.getElementById('follow-toggle');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'follow-toggle';
            btn.className = 'mdl-button mdl-js-button mdl-button--raised';
            btn.textContent = 'Seguir';
            btn.style.position = 'absolute'; btn.style.right = '12px'; btn.style.top = '12px'; btn.style.zIndex = 5003;
            mapEl.parentElement.appendChild(btn);
            btn.addEventListener('click', () => { window.__autoFollow = true; showFollowControl(false); });
        }
        btn.style.display = show ? 'inline-flex' : 'none';
    } catch { }
}
