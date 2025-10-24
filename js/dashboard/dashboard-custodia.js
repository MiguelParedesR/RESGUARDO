// dashboard-custodia.js – Registro de custodia con Autocomplete (solo Perú + proximidad) + Mapa + Selfie
// Persistencia en Supabase via RPCs (crear_servicio, agregar_custodio, guardar_selfie)

document.addEventListener('DOMContentLoaded', () => {
    const snackbar = document.getElementById('app-snackbar');
    const showMsg = (message) => {
        try {
            if (snackbar && snackbar.MaterialSnackbar) snackbar.MaterialSnackbar.showSnackbar({ message });
            else alert(message);
        } catch { alert(message); }
    };

    // UI
    const form = document.getElementById('form-custodia');
    const tipoEl = document.getElementById('tipo');
    const cantidadEl = document.getElementById('cantidad');
    const nombresEl = document.getElementById('nombres');
    const clienteEl = document.getElementById('cliente');
    const placaEl = document.getElementById('placa');
    const destinoEl = document.getElementById('destino');
    const sugList = document.getElementById('destino-suggestions');

    const btnAbrirMapa = document.getElementById('btn-abrir-mapa');
    const direccionEstado = document.getElementById('direccion-estado');

    // Cámara
    const btnIniciarCam = document.getElementById('btn-iniciar-cam');
    const btnTomarFoto = document.getElementById('btn-tomar-foto');
    const btnRepetir = document.getElementById('btn-repetir-foto');
    const camVideo = document.getElementById('cam-video');
    const camCanvas = document.getElementById('cam-canvas');
    const selfiePreview = document.getElementById('selfie-preview');
    const camEstado = document.getElementById('cam-estado');

    // Modal mapa
    const modalMapa = document.getElementById('modal-mapa');
    const mapSearchInput = document.getElementById('map-search-input');
    const mapSearchBtn = document.getElementById('map-search-btn');
    const mapAceptar = document.getElementById('map-aceptar');
    const mapCerrar = document.getElementById('map-cerrar');
    const mapContainerId = 'map-container';

    // Estado
    let mediaStream = null;
    let selfieDataUrl = null;
    let destinoCoords = null; // {lat, lng}
    let map = null;
    let mapMarker = null;
    let mapReady = false;
    let acIndex = -1;
    let lastQuery = '';

    // Proximidad (para priorizar resultados cerca del usuario)
    let userLat = null;
    let userLng = null;

    // Intento obtener posición al cargar (no bloqueante)
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => { userLat = pos.coords.latitude; userLng = pos.coords.longitude; },
            () => { },
            { enableHighAccuracy: true, maximumAge: 60_000, timeout: 10_000 }
        );
    }

    // Defaults por tipo
    function aplicarDefaultsPorTipo() {
        const t = tipoEl.value;
        if (t === 'Simple') cantidadEl.value = cantidadEl.value || 1;
        if (t === 'Tipo A') cantidadEl.value = cantidadEl.value || 1;
        if (t === 'Tipo B') cantidadEl.value = cantidadEl.value || 2;
    }
    tipoEl.addEventListener('change', aplicarDefaultsPorTipo);
    aplicarDefaultsPorTipo();

    // Normalizaciones
    placaEl.addEventListener('input', () => {
        placaEl.value = placaEl.value.toUpperCase().replace(/\s+/g, '');
    });

    // ===== Autocomplete (LocationIQ) – SOLO PERÚ + sesgo por proximidad =====
    const locKey = (window.APP_CONFIG && window.APP_CONFIG.LOCATIONIQ_KEY) || null;
    const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

    // Bounding box de Perú aproximado: W,S,E,N => -81.33,-18.35,-68.65,-0.03
    const PERU_VIEWBOX = '-81.33,-18.35,-68.65,-0.03';
    const COMMON_PARAMS = `countrycodes=pe&viewbox=${encodeURIComponent(PERU_VIEWBOX)}&bounded=1&accept-language=es&normalizeaddress=1`;

    function buildAutocompleteUrl(q) {
        // Algunos planes de LocationIQ permiten sesgo por lat/lon en autocomplete.
        // Si no se soporta, la API simplemente ignorará estos parámetros sin fallar.
        const prox = (userLat != null && userLng != null) ? `&lat=${encodeURIComponent(userLat)}&lon=${encodeURIComponent(userLng)}` : '';
        return `https://us1.locationiq.com/v1/autocomplete?key=${encodeURIComponent(locKey)}&q=${encodeURIComponent(q)}&limit=6&${COMMON_PARAMS}${prox}`;
    }

    async function fetchAutocomplete(query) {
        if (!locKey) {
            direccionEstado.textContent = 'Configura LOCATIONIQ_KEY en config.js';
            direccionEstado.style.color = '#ff6f00';
            return [];
        }
        try {
            const res = await fetch(buildAutocompleteUrl(query));
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return await res.json();
        } catch (e) {
            console.error(e);
            return [];
        }
    }

    function renderSuggestions(items) {
        sugList.innerHTML = '';
        acIndex = -1;
        if (!items || !items.length) { sugList.classList.remove('visible'); return; }
        for (const it of items) {
            const li = document.createElement('li');
            li.textContent = it.display_name || it.address_name || it.name;
            li.dataset.lat = it.lat; li.dataset.lng = it.lon;
            li.addEventListener('click', () => selectSuggestion(li));
            sugList.appendChild(li);
        }
        sugList.classList.add('visible');
    }

    function clearSuggestions() {
        sugList.innerHTML = '';
        sugList.classList.remove('visible');
        acIndex = -1;
    }

    function selectSuggestion(li) {
        destinoEl.value = li.textContent;
        destinoCoords = { lat: parseFloat(li.dataset.lat), lng: parseFloat(li.dataset.lng) };
        direccionEstado.textContent = 'Dirección establecida por autocompletar.';
        direccionEstado.style.color = '#2e7d32';
        clearSuggestions();
    }

    const onDestinoInput = debounce(async () => {
        const q = destinoEl.value.trim();
        if (!q || q === lastQuery) { if (!q) clearSuggestions(); return; }
        lastQuery = q;
        const items = await fetchAutocomplete(q);
        renderSuggestions(items);
    }, 250);

    destinoEl.addEventListener('input', onDestinoInput);
    destinoEl.addEventListener('focus', () => { if (sugList.children.length) sugList.classList.add('visible'); });
    document.addEventListener('click', (e) => { if (!e.target.closest('.destino-wrapper')) clearSuggestions(); });
    destinoEl.addEventListener('keydown', (e) => {
        const items = Array.from(sugList.querySelectorAll('li'));
        if (!items.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault(); acIndex = (acIndex + 1) % items.length;
            items.forEach((li, i) => li.classList.toggle('active', i === acIndex));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault(); acIndex = (acIndex - 1 + items.length) % items.length;
            items.forEach((li, i) => li.classList.toggle('active', i === acIndex));
        } else if (e.key === 'Enter') {
            if (acIndex >= 0) { e.preventDefault(); selectSuggestion(items[acIndex]); }
        } else if (e.key === 'Escape') { clearSuggestions(); }
    });

    // ===== Modal MAPA (Leaflet + reverse) =====
    function openModal() {
        modalMapa.classList.add('open');
        // intentar refrescar proximidad por si el usuario concedió permisos recién
        if (navigator.geolocation && (userLat == null || userLng == null)) {
            navigator.geolocation.getCurrentPosition(
                (pos) => { userLat = pos.coords.latitude; userLng = pos.coords.longitude; },
                () => { },
                { enableHighAccuracy: true, maximumAge: 60_000, timeout: 10_000 }
            );
        }
        setTimeout(() => {
            initMapIfNeeded();
            try { map.invalidateSize(); } catch { }
            mapSearchInput.focus();
        }, 150);
    }
    function closeModal() { modalMapa.classList.remove('open'); }

    btnAbrirMapa.addEventListener('click', openModal);
    mapCerrar.addEventListener('click', closeModal);
    mapAceptar.addEventListener('click', () => {
        if (!destinoCoords) { showMsg('Selecciona un punto en el mapa o busca una dirección.'); return; }
        closeModal();
    });

    function initMapIfNeeded() {
        if (mapReady) { setTimeout(() => map.invalidateSize(), 50); return; }
        map = L.map(mapContainerId);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19, attribution: '&copy; OpenStreetMap'
        }).addTo(map);

        const setDefault = () => map.setView([-12.0464, -77.0428], 12); // Lima
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 14),
                () => setDefault()
            );
        } else { setDefault(); }

        map.on('click', async (e) => {
            setMarker(e.latlng);
            await reverseGeocode(e.latlng.lat, e.latlng.lng);
        });

        mapReady = true;
        setTimeout(() => map.invalidateSize(), 150);
    }

    function setMarker(latlng) {
        destinoCoords = { lat: latlng.lat, lng: latlng.lng };
        if (!mapMarker) {
            mapMarker = L.marker(latlng, { draggable: true }).addTo(map);
            mapMarker.on('dragend', async () => {
                const p = mapMarker.getLatLng();
                destinoCoords = { lat: p.lat, lng: p.lng };
                await reverseGeocode(p.lat, p.lng);
            });
        } else {
            mapMarker.setLatLng(latlng);
        }
    }

    async function reverseGeocode(lat, lng) {
        if (!locKey) {
            direccionEstado.textContent = 'Configura LOCATIONIQ_KEY en config.js';
            direccionEstado.style.color = '#ff6f00';
            return;
        }
        try {
            const url = `https://us1.locationiq.com/v1/reverse?key=${encodeURIComponent(locKey)}&lat=${lat}&lon=${lng}&format=json&accept-language=es`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            const label = data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            destinoEl.value = label;
            direccionEstado.textContent = 'Dirección establecida desde el mapa.';
            direccionEstado.style.color = '#2e7d32';
        } catch (e) {
            console.error(e);
            destinoEl.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            direccionEstado.textContent = 'No se pudo obtener dirección, se usará coordenada.';
            direccionEstado.style.color = '#ff6f00';
        }
    }

    // Búsqueda en mapa (también restringida a Perú + proximidad si disponible)
    mapSearchBtn.addEventListener('click', async () => {
        const q = mapSearchInput.value.trim();
        if (!q) return;

        const items = await fetchAutocomplete(q);
        if (items && items[0]) {
            const lat = parseFloat(items[0].lat), lng = parseFloat(items[0].lon);
            map.setView([lat, lng], 16);
            setMarker({ lat, lng });
            destinoEl.value = items[0].display_name || q;
            destinoCoords = { lat, lng };
            direccionEstado.textContent = 'Dirección establecida desde búsqueda en mapa.';
            direccionEstado.style.color = '#2e7d32';
        } else {
            showMsg('Sin resultados en Perú para esa búsqueda.');
        }
    });

    // ===== Cámara =====
    btnIniciarCam.addEventListener('click', async () => {
        try {
            btnIniciarCam.disabled = true;
            camEstado.textContent = 'Solicitando permisos...';
            mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
            camVideo.srcObject = mediaStream;
            camVideo.style.display = 'block';
            selfiePreview.style.display = 'none';
            btnTomarFoto.disabled = false;
            btnRepetir.disabled = true;
            camEstado.textContent = 'Cámara lista';
        } catch (err) {
            console.error(err);
            camEstado.textContent = 'No se pudo acceder a la cámara';
            btnIniciarCam.disabled = false;
        }
    });

    btnTomarFoto.addEventListener('click', () => {
        if (!mediaStream) { showMsg('Inicia la cámara primero'); return; }
        const w = camVideo.videoWidth || 640, h = camVideo.videoHeight || 480;
        camCanvas.width = w; camCanvas.height = h;
        const ctx = camCanvas.getContext('2d');
        ctx.drawImage(camVideo, 0, 0, w, h);
        selfieDataUrl = camCanvas.toDataURL('image/jpeg', 0.85);
        selfiePreview.src = selfieDataUrl;
        selfiePreview.style.display = 'block';
        camVideo.style.display = 'none';
        btnTomarFoto.disabled = true;
        btnRepetir.disabled = false;
        camEstado.textContent = 'Selfie capturada';
    });

    btnRepetir.addEventListener('click', () => {
        if (!mediaStream) return;
        selfieDataUrl = null;
        selfiePreview.style.display = 'none';
        camVideo.style.display = 'block';
        btnTomarFoto.disabled = false;
        btnRepetir.disabled = true;
        camEstado.textContent = 'Listo para tomar otra';
    });

    async function detenerCamara() {
        try { if (mediaStream) mediaStream.getTracks().forEach(t => t.stop()); } catch { }
        mediaStream = null;
    }
    window.addEventListener('beforeunload', detenerCamara);

    // ===== Guardar en Supabase (servicio + custodios + selfie por cada custodio) =====
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const tipo = tipoEl.value;
        const cantidad = parseInt(cantidadEl.value, 10);
        const nombres = (nombresEl.value || '').split('\n').map(s => s.trim()).filter(Boolean);
        const cliente = (clienteEl.value || '').toUpperCase().trim();
        const placa = (placaEl.value || '').toUpperCase().replace(/\s+/g, '');
        const destinoTexto = (destinoEl.value || '').trim();
        const empresa = (sessionStorage.getItem('auth_empresa') || '').toUpperCase();

        if (!empresa || !['ALVICEM', 'KARPAR'].includes(empresa)) return showMsg('Empresa inválida. Reingresa por login de CUSTODIA.');
        if (!cantidad || cantidad < 1) return showMsg('Cantidad inválida');
        if (nombres.length !== cantidad) return showMsg(`La cantidad (${cantidad}) debe coincidir con los nombres (${nombres.length}).`);
        if (!selfieDataUrl) return showMsg('Debes capturar la selfie.');
        if (!destinoTexto) return showMsg('Ingresa la dirección destino.');
        if (!placa) return showMsg('Ingresa la placa.');
        if (!window.sb) { showMsg('Supabase no está inicializado'); return; }

        try {
            // 1) Crear servicio
            const { data: servicio_id, error: errSvc } = await window.sb.rpc('crear_servicio', {
                p_empresa: empresa,
                p_cliente_nombre: cliente,
                p_tipo: tipo,
                p_placa: placa,
                p_destino_texto: destinoTexto,
                p_destino_lat: destinoCoords?.lat ?? null,
                p_destino_lng: destinoCoords?.lng ?? null
            });
            if (errSvc) { console.error(errSvc); return showMsg('Error al crear servicio'); }
            if (!servicio_id) { return showMsg('No se recibió ID de servicio'); }

            // 2) Crear custodios + selfie a cada uno
            const base64Payload = selfieDataUrl.split(',')[1];
            for (const nombre of nombres) {
                const { data: cId, error: errC } = await window.sb.rpc('agregar_custodio', {
                    p_servicio_id: servicio_id,
                    p_nombre: nombre,
                    p_tipo_custodia: tipo
                });
                if (errC) { console.error(errC); return showMsg('Error al agregar custodios'); }

                const { error: errSelfie } = await window.sb.rpc('guardar_selfie', {
                    p_servicio_custodio_id: cId,
                    p_mime_type: 'image/jpeg',
                    p_base64: base64Payload
                });
                if (errSelfie) { console.error(errSelfie); return showMsg('Error al guardar selfie'); }
            }

            // Guardamos en sesión para el módulo de seguimiento
            sessionStorage.setItem('servicio_id_actual', servicio_id);

            showMsg('Servicio registrado en Supabase ✅');
            await detenerCamara();
            form.reset();
            selfiePreview.style.display = 'none'; camVideo.style.display = 'none';
            btnTomarFoto.disabled = true; btnRepetir.disabled = true; btnIniciarCam.disabled = false;
            destinoCoords = null; direccionEstado.textContent = 'Registro listo.'; direccionEstado.style.color = '';
            aplicarDefaultsPorTipo(); clearSuggestions();

        } catch (err) {
            console.error(err);
            showMsg('Error inesperado al guardar en Supabase');
        }
    });

    // Limpiar
    document.getElementById('btn-limpiar').addEventListener('click', async () => {
        form.reset(); aplicarDefaultsPorTipo();
        selfiePreview.style.display = 'none'; camVideo.style.display = 'none';
        btnTomarFoto.disabled = true; btnRepetir.disabled = true; btnIniciarCam.disabled = false;
        destinoCoords = null; direccionEstado.textContent = 'Formulario limpio.'; direccionEstado.style.color = '';
        clearSuggestions(); await detenerCamara();
    });
});
