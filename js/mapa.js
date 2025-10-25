// mapa.js – Seguimiento en tiempo real del resguardo
// Requiere: window.sb (config.js) y Leaflet cargado en la página.
// La página debe tener: <div id="map-track"></div>, <span id="distancia-label"></span>, <button id="btn-finalizar"></button>

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
    const DASHBOARD_URL = '/html/dashboard/dashboard-custodia.html';
    const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';
    let routeLayer = null;
    let poiLayer = null;

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
            .select('id, destino_lat, destino_lng, destino_texto, estado')
            .eq('id', servicioId)
            .single();

        if (error) { console.error('[mapa] error servicio', error); return; }
        if (!data) { console.error('[mapa] servicio no encontrado'); return; }

        if (data.destino_lat && data.destino_lng) {
            destino = { lat: data.destino_lat, lng: data.destino_lng, texto: data.destino_texto || 'Destino' };
        }

        // Poblar panel informativo si existe
        if (destinoTextoEl) destinoTextoEl.textContent = destino?.texto || '—';
        if (estadoTextoEl) {
            estadoTextoEl.textContent = (data.estado || 'EN CURSO');
            estadoTextoEl.style.color = (data.estado === 'FINALIZADO') ? '#2e7d32' : '#f57c00';
        }

        initMap();
    }

    function initMap() {
        map = L.map(mapElId);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19, attribution: '&copy; OpenStreetMap'
        }).addTo(map);

        if (destino) {
            markerDestino = L.marker([destino.lat, destino.lng], { title: 'Destino' }).addTo(map);
            markerDestino.bindPopup(destino.texto || 'Destino');
            map.setView([destino.lat, destino.lng], 14);
        } else {
            map.setView([-12.0464, -77.0428], 12); // Lima
        }
        poiLayer = L.layerGroup().addTo(map);
        routeLayer = L.layerGroup().addTo(map);

        iniciarTracking();
        // Ruta inicial y refresco periódico
        setTimeout(updateRouteFromMarkers, 2000);
        setInterval(updateRouteFromMarkers, 10000);
    }

    async function updateRouteFromMarkers() {
        try {
            if (!destino || !markerYo || !routeLayer || !poiLayer) return;
            const p = markerYo.getLatLng();
            const url = `${OSRM_URL}/${p.lng},${p.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson`;
            const resp = await fetch(url);
            if (!resp.ok) return;
            const j = await resp.json();
            const coords = j?.routes?.[0]?.geometry?.coordinates || [];
            const latlngs = coords.map(([LNG, LAT]) => [LAT, LNG]);
            try { routeLayer.clearLayers(); } catch {}
            try { poiLayer.clearLayers(); } catch {}
            L.circleMarker([p.lat, p.lng], { radius: 8, color: '#1976d2', weight: 2, fillColor: '#1976d2', fillOpacity: 0.85 }).addTo(poiLayer).bindTooltip('Partida/Actual');
            L.circleMarker([destino.lat, destino.lng], { radius: 9, color: '#e91e63', weight: 2, fillColor: '#e91e63', fillOpacity: 0.9 }).addTo(poiLayer).bindTooltip('Destino');
            if (latlngs.length) {
                L.polyline(latlngs, { color: '#1e88e5', weight: 5, opacity: 0.95 }).addTo(routeLayer);
            } else {
                L.polyline([[p.lat, p.lng], [destino.lat, destino.lng]], { color: '#455a64', weight: 3, opacity: 0.85, dashArray: '6,4' }).addTo(routeLayer);
            }
        } catch {}
    }

    function iniciarTracking() {
        if (!navigator.geolocation) {
            console.error('[mapa] Geolocalización no soportada');
            return;
        }

        const watchId = navigator.geolocation.watchPosition(
            pos => onPos(pos.coords.latitude, pos.coords.longitude),
            err => {
                console.warn('[mapa] watchPosition error, fallback interval', err);
                onInterval();
                setInterval(onInterval, 30_000);
                function onInterval() {
                    navigator.geolocation.getCurrentPosition(
                        p => onPos(p.coords.latitude, p.coords.longitude),
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

    async function onPos(lat, lng) {
        // Pintar/actualizar mi ubicación
        if (!markerYo) {
            markerYo = L.marker([lat, lng], { title: 'Ubicación actual' }).addTo(map);
            markerYo.bindPopup('Ubicación actual');
            if (!destino) map.setView([lat, lng], 14);
        } else {
            markerYo.setLatLng([lat, lng]);
        }

        // Distancia al destino
        if (destino) {
            const d = Math.round(distanciaM(lat, lng, destino.lat, destino.lng));
            if (distanciaLabel) distanciaLabel.textContent = `${d} m`;
            if (btnFinalizar) btnFinalizar.disabled = d > ARRIVE_M; // habilita si está a <= 50 m
        }

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
                console.error('[mapa] registrar_ubicacion excepción', e);
            }
        }
    }

    // Finalizar servicio + redirección al dashboard
    if (btnFinalizar) {
        btnFinalizar.addEventListener('click', async () => {
            let ok = true;

            // Verificación de distancia si es posible
            if (destino && markerYo) {
                const p = markerYo.getLatLng();
                const d = Math.round(distanciaM(p.lat, p.lng, destino.lat, destino.lng));
                ok = d <= ARRIVE_M || confirm(`Aún estás a ${d} m del destino. ¿Finalizar de todos modos?`);
            } else {
                ok = confirm('No se pudo verificar distancia. ¿Finalizar de todos modos?');
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

                showMsg('Servicio finalizado correctamente ✅');
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
