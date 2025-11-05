// mapa.js - Seguimiento en tiempo real del resguardo
// Requiere: window.sb (config.js) y Leaflet cargado en la pagina.
// La pagina debe tener: <div id="map-track"></div>, <span id="distancia-label"></span>, <button id="btn-finalizar"></button>

document.addEventListener('DOMContentLoaded', () => {
    const servicioId = sessionStorage.getItem('servicio_id_actual');
    if (!servicioId) {
        console.warn('[mapa] servicio_id_actual no encontrado en sessionStorage');
        return;
    }
    if (!window.sb) {
        console.warn('[mapa] Supabase no inicializado (config.js)');
        return;
    }

    // Referencias de UI
    const mapContainerId = 'map-track';
    const distanciaLabel = document.getElementById('distancia-label');
    const btnFinalizar = document.getElementById('btn-finalizar');
    const estadoTextoEl = document.getElementById('estado-texto');
    const destinoTextoEl = document.getElementById('destino-texto');
    const panicBtn = document.getElementById('alarma-panic-btn');

    // Estado global
    const hasAlarma = typeof window.Alarma === 'object';
    const hasPushKey = Boolean(window.APP_CONFIG?.WEB_PUSH_PUBLIC_KEY);
    const empresaActual = (sessionStorage.getItem('auth_empresa') || '').toUpperCase();
    let servicioInfo = null;
    let map = null;
    let markerYo = null;
    let markerDestino = null;
    let destino = null;
    let lastSent = 0;
    let panicConfirming = false;
    let panicConfirmTimer = null;
    let panicLabelEl = panicBtn ? panicBtn.querySelector('.alarma-panic-btn__label') : null;
    const panicLabelDefault = panicLabelEl ? panicLabelEl.textContent : (panicBtn?.textContent || '');

    const SEND_EVERY_MS = 30_000;
    const ARRIVE_M = 50;
    const REDIRECT_DELAY = 2000;
    const DASHBOARD_URL = '/html/dashboard/custodia-registros.html';

    const showMsg = (message) => {
        const snackbar = document.getElementById('app-snackbar');
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

    async function cargarServicio() {
        try {
            const { data, error } = await window.sb
                .from('servicio')
                .select('id, empresa, placa, tipo, destino_lat, destino_lng, destino_texto, estado, cliente:cliente_id(nombre)')
                .eq('id', servicioId)
                .single();

            if (error) { throw error; }
            if (!data) { throw new Error('Servicio no encontrado'); }

            servicioInfo = data;
            destino = null;

            if (typeof data.destino_lat === 'number' && typeof data.destino_lng === 'number') {
                destino = {
                    lat: data.destino_lat,
                    lng: data.destino_lng,
                    texto: data.destino_texto || 'Destino'
                };
            }

            if (destinoTextoEl) destinoTextoEl.textContent = destino?.texto || '-';
            if (estadoTextoEl) {
                const estado = data.estado || 'EN CURSO';
                estadoTextoEl.textContent = estado;
                estadoTextoEl.style.color = estado === 'FINALIZADO' ? '#2e7d32' : '#f57c00';
            }

            initMap();
        } catch (err) {
            console.error('[mapa] cargarServicio error', err);
            showMsg('No se pudo cargar el servicio');
        }
    }

    function initMap() {
        if (!document.getElementById(mapContainerId)) {
            console.error('[mapa] Contenedor del mapa no encontrado:', mapContainerId);
            return;
        }

        const options = {
            preferCanvas: true,
            zoomAnimation: false,
            markerZoomAnimation: false,
            wheelDebounceTime: 40
        };
        map = L.map(mapContainerId, options);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap'
        }).addTo(map);

        if (destino) {
            markerDestino = L.marker([destino.lat, destino.lng], { title: 'Destino' }).addTo(map);
            map.setView([destino.lat, destino.lng], 14);
        } else {
            map.setView([-12.0464, -77.0428], 12); // Lima
        }

        setupPanicButton();
        iniciarTracking();
        setTimeout(() => { map.invalidateSize(); }, 250);
    }

    function setPanicLabel(text) {
        if (!panicBtn) return;
        if (panicLabelEl) panicLabelEl.textContent = text;
        else panicBtn.textContent = text;
    }

    function resetPanicConfirm() {
        panicConfirming = false;
        if (!panicBtn) return;
        panicBtn.classList.remove('is-confirm');
        if (panicConfirmTimer) {
            clearTimeout(panicConfirmTimer);
            panicConfirmTimer = null;
        }
        setPanicLabel(panicLabelDefault);
    }

    function setupPanicButton() {
        if (!panicBtn || !hasAlarma) return;
        panicBtn.disabled = true;
        panicBtn.addEventListener('click', async () => {
            if (panicBtn.disabled) {
                showMsg('Esperando ubicacion GPS...');
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
                showMsg('Necesitamos tu ubicacion actual para enviar la alerta.');
                panicBtn.disabled = true;
                return;
            }
            panicBtn.disabled = true;
            try { navigator.vibrate?.([260, 140, 260]); } catch { }
            let direccion = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
            if (typeof window.Alarma?.reverseGeocode === 'function') {
                try { direccion = await window.Alarma.reverseGeocode(coords.lat, coords.lng); }
                catch (err) { console.warn('[alarma] reverseGeocode', err); }
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
                showMsg('Alerta de panico enviada.');
                try { navigator.vibrate?.([200, 120, 200, 120, 260]); } catch { }
            } catch (err) {
                console.error('[alarma] emit panic', err);
                showMsg('No se pudo enviar la alerta. Se reintentara automaticamente.');
            } finally {
                panicBtn.disabled = false;
                resetPanicConfirm();
            }
        });
    }

    function iniciarTracking() {
        if (!navigator.geolocation) {
            console.error('[mapa] Geolocalizacion no soportada');
            return;
        }
        const pinUser = L.divIcon({ className: 'pin-user', html: '&#128205;', iconSize: [24, 24], iconAnchor: [12, 24] });
        const watchId = navigator.geolocation.watchPosition(
            pos => onPos(pos.coords.latitude, pos.coords.longitude, pinUser, pos.coords),
            err => {
                console.warn('[mapa] geolocalizacion (watch) error', err);
                onInterval();
                const fallback = setInterval(onInterval, 30_000);
                function onInterval() {
                    navigator.geolocation.getCurrentPosition(
                        p => onPos(p.coords.latitude, p.coords.longitude, pinUser, p.coords),
                        () => {},
                        { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
                    );
                }
                window.addEventListener('beforeunload', () => clearInterval(fallback), { once: true });
            },
            { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
        );

        window.addEventListener('beforeunload', () => {
            try { navigator.geolocation.clearWatch(watchId); } catch { }
        });
    }

    async function onPos(lat, lng, pinUser, coords = null) {
        if (!map) return;
        if (!markerYo) {
            markerYo = L.marker([lat, lng], { title: 'Ubicacion actual', icon: pinUser }).addTo(map);
            markerYo.bindPopup('Ubicacion actual');
            if (!destino) map.setView([lat, lng], 14);
        } else {
            markerYo.setLatLng([lat, lng]);
        }

        if (panicBtn && hasAlarma) {
            panicBtn.disabled = false;
            resetPanicConfirm();
        }

        if (hasAlarma && typeof window.Alarma?.setLocation === 'function') {
            try { window.Alarma.setLocation(lat, lng, { accuracy: coords?.accuracy ?? null }); }
            catch (err) { console.warn('[alarma] setLocation', err); }
        }

        if (destino && distanciaLabel) {
            const d = Math.round(distanciaM(lat, lng, destino.lat, destino.lng));
            distanciaLabel.textContent = `${d} m`;
            if (btnFinalizar) btnFinalizar.disabled = d > ARRIVE_M;
        }

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
            } catch (err) {
                console.error('[mapa] registrar_ubicacion excepcion', err);
            }
        }
    }

    if (btnFinalizar) {
        btnFinalizar.addEventListener('click', async () => {
            let ok = true;
            if (destino && markerYo) {
                const posActual = markerYo.getLatLng();
                const d = Math.round(distanciaM(posActual.lat, posActual.lng, destino.lat, destino.lng));
                ok = d <= ARRIVE_M || confirm(`Aun estas a ${d} m del destino. Finalizar de todos modos?`);
            } else {
                ok = confirm('No se pudo verificar distancia. Finalizar de todos modos?');
            }
            if (!ok) return;
            try {
                const { error } = await window.sb
                    .from('servicio')
                    .update({ estado: 'FINALIZADO' })
                    .eq('id', servicioId);
                if (error) throw error;
                if (estadoTextoEl) {
                    estadoTextoEl.textContent = 'FINALIZADO';
                    estadoTextoEl.style.color = '#2e7d32';
                }
                showMsg('Servicio finalizado correctamente.');
                setTimeout(() => { location.href = DASHBOARD_URL; }, REDIRECT_DELAY);
            } catch (err) {
                console.error('[mapa] finalizar servicio error', err);
                showMsg('No se pudo finalizar el servicio');
            }
        });
    }

    cargarServicio();
});

// Exponer helper opcional para otros modulos
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
            btn.style.position = 'absolute';
            btn.style.right = '12px';
            btn.style.top = '12px';
            btn.style.zIndex = 5003;
            mapEl.parentElement?.appendChild(btn);
            btn.addEventListener('click', () => {
                window.__autoFollow = true;
                showFollowControl(false);
            });
        }
        btn.style.display = show ? 'inline-flex' : 'none';
    } catch { }
}
