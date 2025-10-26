// dashboard-custodia.js — Registro por custodio (bloques) + Autocomplete + Mapa + Selfie por bloque

document.addEventListener('DOMContentLoaded', () => {
  const snackbar = document.getElementById('app-snackbar');
  const showMsg = (message, timeout = 2500) => {
    try { if (snackbar?.MaterialSnackbar) snackbar.MaterialSnackbar.showSnackbar({ message, timeout }); else alert(message); }
    catch { alert(message); }
  };

  const empresa = (sessionStorage.getItem('auth_empresa') || '').toUpperCase();
  if (!empresa) { location.replace('/html/login/login.html'); return; }
  if (!window.sb) { showMsg('Supabase no inicializado'); return; }

  // UI refs
  const form = document.getElementById('form-custodia');
  const tipoEl = document.getElementById('tipo');
  const clienteEl = document.getElementById('cliente');
  const placaEl = document.getElementById('placa');
  const destinoEl = document.getElementById('destino');
  const sugList = document.getElementById('destino-suggestions');
  const btnAbrirMapa = document.getElementById('btn-abrir-mapa');
  const direccionEstado = document.getElementById('direccion-estado');
  const custContainer = document.getElementById('custodios-container');
  // Modal servicio activo
  const modalAct = document.getElementById('modal-servicio-activo');
  const mactCliente = document.getElementById('mact-cliente');
  const mactDestino = document.getElementById('mact-destino');
  const mactList = document.getElementById('mact-custodios');
  const mBtnJoin = document.getElementById('mact-join');
  const mBtnVer = document.getElementById('mact-ver');
  const mBtnNuevo = document.getElementById('mact-nuevo');
  const mBtnCancel = document.getElementById('mact-cancel');

  // Modal mapa
  const modalMapa = document.getElementById('modal-mapa');
  const mapSearchInput = document.getElementById('map-search-input');
  const mapSearchBtn = document.getElementById('map-search-btn');
  const mapAceptar = document.getElementById('map-aceptar');
  const mapCerrar = document.getElementById('map-cerrar');
  const mapContainerId = 'map-container';

  // Estado global
  let destinoCoords = null; // {lat,lng}
  let map = null, mapMarker = null, mapReady = false;
  let acIndex = -1, lastQuery = '';
  let userLat = null, userLng = null; // proximidad
  let currentTipo = 'Simple';
  let custodiosUI = []; // [{ kind, root, nameInput, video, canvas, img, btnStart, btnShot, btnReset, status, stream, selfieDataUrl }]
  let activeSvc = null; // servicio activo detectado por placa
  let activeCustodios = []; // custodios del servicio activo
  let forceNew = false; // si el usuario elige "Nuevo"

  // Geo temprana
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => { userLat = pos.coords.latitude; userLng = pos.coords.longitude; },
      () => {},
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 10000 }
    );
  }

  // Normalización placa
  placaEl.addEventListener('input', () => { placaEl.value = placaEl.value.toUpperCase().replace(/\s+/g, ''); });
  placaEl.addEventListener('blur', async () => {
    try {
      const up = (placaEl.value || '').toUpperCase().replace(/\s+/g, '');
      if (!up) return; await detectServicioActivo(up, true);
    } catch { showMsg('Error al consultar placa'); }
  });

  // Render dinámico de bloques
  function kindsForTipo(t) { if (t === 'Tipo B') return ['cabina', 'vehiculo']; if (t === 'Tipo A') return ['vehiculo']; return ['cabina']; }
  function labelForKind(k) { return k === 'vehiculo' ? 'Custodia en Vehículo' : 'Custodia en Cabina'; }
  function tipoForKind(k) { return k === 'vehiculo' ? 'Tipo A' : 'Simple'; }
  function stopStream(ui) { try { ui.stream?.getTracks().forEach(t => t.stop()); } catch {} ui.stream = null; }

  function renderCustodios() {
    // detener cámaras anteriores
    try { custodiosUI.forEach(stopStream); } catch {}
    custodiosUI = [];
    custContainer.innerHTML = '';
    const kinds = kindsForTipo(currentTipo);
    for (const kind of kinds) {
      const sec = document.createElement('section'); sec.className = 'custodio-block'; sec.dataset.kind = kind;
      sec.innerHTML = `
        <h3>${labelForKind(kind)}</h3>
        <div class="mdl-textfield mdl-js-textfield mdl-textfield--floating-label">
          <input class="mdl-textfield__input" type="text" placeholder="Nombre del custodio">
          <label class="mdl-textfield__label">Nombre del custodio</label>
        </div>
        <div class="camera-area">
          <video playsinline autoplay muted></video>
          <img alt="Selfie" />
          <canvas style="display:none"></canvas>
          <div class="camera-actions">
            <button type="button" class="btn-iniciar mdl-button mdl-js-button">Iniciar cámara</button>
            <button type="button" class="btn-tomar mdl-button mdl-js-button" disabled>Tomar selfie</button>
            <button type="button" class="btn-repetir mdl-button mdl-js-button" disabled>Repetir</button>
          </div>
          <div class="cam-estado"></div>
        </div>`;
      const nameInput = sec.querySelector('input[type="text"]');
      const video = sec.querySelector('video');
      const img = sec.querySelector('img');
      const canvas = sec.querySelector('canvas');
      const btnStart = sec.querySelector('.btn-iniciar');
      const btnShot = sec.querySelector('.btn-tomar');
      const btnReset = sec.querySelector('.btn-repetir');
      const status = sec.querySelector('.cam-estado');
      const ui = { kind, root: sec, nameInput, video, img, canvas, btnStart, btnShot, btnReset, status, stream: null, selfieDataUrl: null };

      btnStart.addEventListener('click', async () => {
        try {
          btnStart.disabled = true; status.textContent = 'Solicitando permisos...';
          ui.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:'user' }, audio:false });
          video.srcObject = ui.stream; video.style.display='block'; img.style.display='none';
          btnShot.disabled = false; btnReset.disabled = true; status.textContent = 'Cámara lista';
        } catch (e) { status.textContent = 'No se pudo acceder a la cámara'; btnStart.disabled = false; }
      });
      btnShot.addEventListener('click', () => {
        if (!ui.stream) { showMsg('Inicia la cámara primero'); return; }
        const w = video.videoWidth||640, h = video.videoHeight||480;
        canvas.width=w; canvas.height=h; const ctx = canvas.getContext('2d'); ctx.drawImage(video,0,0,w,h);
        ui.selfieDataUrl = canvas.toDataURL('image/jpeg',0.85);
        img.src = ui.selfieDataUrl; img.style.display='block'; video.style.display='none'; btnShot.disabled=true; btnReset.disabled=false; status.textContent='Selfie capturada';
      });
      btnReset.addEventListener('click', () => { if (!ui.stream) return; ui.selfieDataUrl=null; img.style.display='none'; video.style.display='block'; btnShot.disabled=false; btnReset.disabled=true; status.textContent='Listo para otra'; });

      custodiosUI.push(ui);
      custContainer.appendChild(sec);
    }
  }

  tipoEl.addEventListener('change', () => { currentTipo = tipoEl.value; renderCustodios(); });
  currentTipo = tipoEl.value; renderCustodios();

  // ===== Autocomplete (LocationIQ) PERÚ + proximidad =====
  const locKey = (window.APP_CONFIG && window.APP_CONFIG.LOCATIONIQ_KEY) || null;
  const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const PERU_VIEWBOX = '-81.33,-18.35,-68.65,-0.03';
  const COMMON_PARAMS = `countrycodes=pe&viewbox=${encodeURIComponent(PERU_VIEWBOX)}&bounded=1&accept-language=es&normalizeaddress=1`;
  function buildAutocompleteUrl(q) { const prox = (userLat != null && userLng != null) ? `&lat=${encodeURIComponent(userLat)}&lon=${encodeURIComponent(userLng)}` : ''; return `https://us1.locationiq.com/v1/autocomplete?key=${encodeURIComponent(locKey)}&q=${encodeURIComponent(q)}&limit=6&${COMMON_PARAMS}${prox}`; }
  async function fetchAutocomplete(query) { if (!locKey) { direccionEstado.textContent = 'Configura LOCATIONIQ_KEY en config.js'; direccionEstado.style.color = '#ff6f00'; return []; } try { const res = await fetch(buildAutocompleteUrl(query)); if (!res.ok) throw new Error('HTTP ' + res.status); return await res.json(); } catch (e) { console.error(e); return []; } }
  function renderSuggestions(items) { sugList.innerHTML = ''; acIndex = -1; if (!items || !items.length) { sugList.classList.remove('visible'); return; } for (const it of items) { const li = document.createElement('li'); li.textContent = it.display_name || it.address_name || it.name; li.dataset.lat = it.lat; li.dataset.lng = it.lon; li.addEventListener('click', () => selectSuggestion(li)); sugList.appendChild(li); } sugList.classList.add('visible'); }
  function clearSuggestions() { sugList.innerHTML = ''; sugList.classList.remove('visible'); acIndex = -1; }
  function selectSuggestion(li) { destinoEl.value = li.textContent; destinoCoords = { lat: parseFloat(li.dataset.lat), lng: parseFloat(li.dataset.lng) }; direccionEstado.textContent = 'Dirección establecida por autocompletar.'; direccionEstado.style.color = '#2e7d32'; clearSuggestions(); }
  const onDestinoInput = debounce(async () => { const q = destinoEl.value.trim(); if (!q || q === lastQuery) { if (!q) clearSuggestions(); return; } lastQuery = q; const items = await fetchAutocomplete(q); renderSuggestions(items); }, 250);
  destinoEl.addEventListener('input', onDestinoInput);
  destinoEl.addEventListener('focus', () => { if (sugList.children.length) sugList.classList.add('visible'); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.destino-wrapper')) clearSuggestions(); });
  destinoEl.addEventListener('keydown', (e) => { const items = Array.from(sugList.querySelectorAll('li')); if (!items.length) return; if (e.key === 'ArrowDown') { e.preventDefault(); acIndex = (acIndex + 1) % items.length; items.forEach((li, i) => li.classList.toggle('active', i === acIndex)); } else if (e.key === 'ArrowUp') { e.preventDefault(); acIndex = (acIndex - 1 + items.length) % items.length; items.forEach((li, i) => li.classList.toggle('active', i === acIndex)); } else if (e.key === 'Enter') { if (acIndex >= 0) { e.preventDefault(); selectSuggestion(items[acIndex]); } } else if (e.key === 'Escape') { clearSuggestions(); } });

  // ===== Modal MAPA (Leaflet + reverse) =====
  function openModal() { modalMapa.classList.add('open'); if (navigator.geolocation && (userLat == null || userLng == null)) { navigator.geolocation.getCurrentPosition((pos) => { userLat = pos.coords.latitude; userLng = pos.coords.longitude; }, () => {}, { enableHighAccuracy: true, maximumAge: 60000, timeout: 10000 }); } setTimeout(() => { initMapIfNeeded(); try { map.invalidateSize(); } catch {} mapSearchInput.focus(); }, 150); }
  function closeModal() { modalMapa.classList.remove('open'); }
  btnAbrirMapa.addEventListener('click', openModal);
  mapCerrar.addEventListener('click', closeModal);
  mapAceptar.addEventListener('click', () => { if (!destinoCoords) { showMsg('Selecciona un punto en el mapa o busca una dirección.'); return; } closeModal(); });
  function initMapIfNeeded() { if (mapReady) { setTimeout(() => map.invalidateSize(), 50); return; } map = L.map(mapContainerId); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map); const setDefault = () => map.setView([-12.0464, -77.0428], 12); if (navigator.geolocation) { navigator.geolocation.getCurrentPosition((pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 14), () => setDefault()); } else { setDefault(); } map.on('click', async (e) => { setMarker(e.latlng); await reverseGeocode(e.latlng.lat, e.latlng.lng); }); mapReady = true; setTimeout(() => map.invalidateSize(), 150); }
  function setMarker(latlng) { destinoCoords = { lat: latlng.lat, lng: latlng.lng }; if (!mapMarker) { mapMarker = L.marker(latlng, { draggable: true }).addTo(map); mapMarker.on('dragend', async () => { const p = mapMarker.getLatLng(); destinoCoords = { lat: p.lat, lng: p.lng }; await reverseGeocode(p.lat, p.lng); }); } else { mapMarker.setLatLng(latlng); } }
  async function reverseGeocode(lat, lng) { if (!locKey) { direccionEstado.textContent = 'Configura LOCATIONIQ_KEY en config.js'; direccionEstado.style.color = '#ff6f00'; return; } try { const url = `https://us1.locationiq.com/v1/reverse?key=${encodeURIComponent(locKey)}&lat=${lat}&lon=${lng}&format=json&accept-language=es`; const res = await fetch(url); if (!res.ok) throw new Error('HTTP ' + res.status); const data = await res.json(); const label = data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`; destinoEl.value = label; direccionEstado.textContent = 'Dirección establecida desde el mapa.'; direccionEstado.style.color = '#2e7d32'; } catch (e) { console.error(e); destinoEl.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`; direccionEstado.textContent = 'No se pudo obtener dirección, se usará coordenada.'; direccionEstado.style.color = '#ff6f00'; } }
  mapSearchBtn.addEventListener('click', async () => { const q = mapSearchInput.value.trim(); if (!q) return; const items = await fetchAutocomplete(q); if (items && items[0]) { const lat = parseFloat(items[0].lat), lng = parseFloat(items[0].lon); map.setView([lat, lng], 16); setMarker({ lat, lng }); destinoEl.value = items[0].display_name || q; destinoCoords = { lat, lng }; direccionEstado.textContent = 'Dirección establecida desde búsqueda en mapa.'; direccionEstado.style.color = '#2e7d32'; } else { showMsg('Sin resultados en Perú para esa búsqueda.'); } });

  // ===== Envío: crear/unirse por placa + empresa =====
  function isPlacaOk(p) { return /^[A-Z0-9-]{5,10}$/.test(p); }
  function bloquesCompletos() { return custodiosUI.filter(b => (b.nameInput.value || '').trim() && b.selfieDataUrl); }
  function mapKindToTipo(k) { return tipoForKind(k); }
  async function findActiveService(empresa, placaUpper) {
    // intenta por placa_upper, si falla, usa placa
    let q = window.sb.from('servicio').select('id, empresa, placa, tipo, estado, destino_texto, cliente:cliente_id(nombre)').eq('empresa', empresa).eq('placa_upper', placaUpper).eq('estado', 'ACTIVO').order('created_at', { ascending: false }).limit(1);
    let { data, error } = await q;
    if (error) {
      // fallback
      const r = await window.sb.from('servicio').select('id, empresa, placa, tipo, estado, destino_texto, cliente:cliente_id(nombre)').eq('empresa', empresa).eq('placa', placaUpper).eq('estado', 'ACTIVO').order('created_at', { ascending: false }).limit(1);
      data = r.data; error = r.error;
    }
    if (error) throw error; return (data && data[0]) || null;
  }
  async function getCustodios(servicioId) { const { data, error } = await window.sb.from('servicio_custodio').select('id, nombre, selfie_url, tipo_custodia').eq('servicio_id', servicioId); if (error) throw error; return data || []; }
  function isCompleto(c) { return Boolean((c?.nombre || '').trim()) && Boolean(c?.selfie_url); }
  function kindFromTipoCustodia(t) { return (t === 'Tipo A') ? 'vehiculo' : 'cabina'; }

  async function detectServicioActivo(placaUpper, showModal) {
    activeSvc = await findActiveService(empresa, placaUpper);
    if (!activeSvc) { modalAct?.classList.remove('show'); return null; }
    activeCustodios = await getCustodios(activeSvc.id);
    if (!showModal) return activeSvc;
    // Poblar modal
    mactCliente.textContent = activeSvc.cliente?.nombre || '-';
    mactDestino.textContent = activeSvc.destino_texto || '-';
    mactList.innerHTML = '';
    (activeCustodios||[]).forEach(c => {
      const row = document.createElement('div'); row.className = 'mini-item';
      const nm = document.createElement('span'); nm.textContent = (c.nombre || '(Sin nombre)');
      const right = document.createElement('span');
      const chipKind = document.createElement('span'); chipKind.className = 'chip kind'; chipKind.textContent = (c.tipo_custodia === 'Tipo A') ? 'Vehículo' : 'Cabina';
      const chipState = document.createElement('span'); chipState.className = 'chip ' + (isCompleto(c) ? 'ok' : 'pend'); chipState.textContent = isCompleto(c) ? 'Completo' : 'Pendiente';
      right.appendChild(chipKind); right.appendChild(document.createTextNode(' ')); right.appendChild(chipState);
      row.appendChild(nm); row.appendChild(right); mactList.appendChild(row);
    });
    modalAct.classList.add('show');
    return activeSvc;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const cliente = (clienteEl.value || '').toUpperCase().trim();
      const placa = (placaEl.value || '').toUpperCase().replace(/\s+/g, '');
      const destinoTexto = (destinoEl.value || '').trim();
      const bloques = bloquesCompletos();
      if (!cliente) return showMsg('Ingresa el cliente');
      if (!placa || !isPlacaOk(placa)) return showMsg('Ingresa la placa (A-Z, 0-9, -)');
      if (!destinoTexto) return showMsg('Ingresa la dirección destino');
      if (!bloques.length) return showMsg('Completa al menos un custodio (nombre + selfie)');

      const tGlobal = tipoEl.value;
      const expectedKinds = kindsForTipo(tGlobal);
      const existing = await findActiveService(empresa, placa);
      if (existing && !forceNew) {
        // mostrar modal y detener envío hasta que elija
        await detectServicioActivo(placa, true);
        return;
      }
      if (existing) {
        const custs = await getCustodios(existing.id);
        const completeKinds = new Set(custs.filter(isCompleto).map(c => kindFromTipoCustodia(c.tipo_custodia)));
        const incompleteMap = new Map();
        for (const c of custs) { const k = kindFromTipoCustodia(c.tipo_custodia); if (!isCompleto(c)) incompleteMap.set(k, c); }

        const actions = [];
        for (const b of bloques) {
          const k = b.kind; if (!expectedKinds.includes(k)) continue;
          const inc = incompleteMap.get(k);
          if (inc) { actions.push({ mode:'update', id: inc.id, nombre: b.nameInput.value.trim(), selfie: b.selfieDataUrl }); }
          else if (!completeKinds.has(k)) { actions.push({ mode:'create', k, nombre: b.nameInput.value.trim(), selfie: b.selfieDataUrl }); }
        }
        if (!actions.length) {
          const ok = confirm(`La placa ya está registrada para este servicio: ${existing.cliente?.nombre || ''} – ${existing.destino_texto || ''}. Ir al mapa ahora?`);
          if (ok) { sessionStorage.setItem('servicio_id_actual', existing.id); location.href = '/html/dashboard/mapa-resguardo.html'; }
          return;
        }
        for (const a of actions) {
          if (a.mode === 'update') {
            const { error: e1 } = await window.sb.from('servicio_custodio').update({ nombre: a.nombre }).eq('id', a.id); if (e1) throw e1;
            const base64 = a.selfie.split(',')[1]; const { error: e2 } = await window.sb.rpc('guardar_selfie', { p_servicio_custodio_id: a.id, p_mime_type: 'image/jpeg', p_base64: base64 }); if (e2) throw e2;
          } else {
            const tipo_custodia = mapKindToTipo(a.k);
            const { data: cId, error: e3 } = await window.sb.rpc('agregar_custodio', { p_servicio_id: existing.id, p_nombre: a.nombre, p_tipo_custodia: tipo_custodia }); if (e3) throw e3;
            const base64 = a.selfie.split(',')[1]; const { error: e4 } = await window.sb.rpc('guardar_selfie', { p_servicio_custodio_id: cId, p_mime_type: 'image/jpeg', p_base64: base64 }); if (e4) throw e4;
          }
        }
        showMsg('Registro de custodio completado ✅'); sessionStorage.setItem('servicio_id_actual', existing.id); location.href = '/html/dashboard/mapa-resguardo.html'; return;
      }

      // Crear servicio nuevo
      const { data: servicio_id, error: errSvc } = await window.sb.rpc('crear_servicio', { p_empresa: empresa, p_cliente_nombre: cliente, p_tipo: tGlobal, p_placa: placa, p_destino_texto: destinoTexto, p_destino_lat: destinoCoords?.lat ?? null, p_destino_lng: destinoCoords?.lng ?? null });
      if (errSvc) { console.error(errSvc); return showMsg('Error al crear servicio'); }
      if (!servicio_id) return showMsg('No se recibió ID de servicio');
      for (const b of bloques) {
        const tipo_custodia = tipoForKind(b.kind);
        const { data: cId, error: errC } = await window.sb.rpc('agregar_custodio', { p_servicio_id: servicio_id, p_nombre: b.nameInput.value.trim(), p_tipo_custodia: tipo_custodia });
        if (errC) { console.error(errC); return showMsg('Error al agregar custodio'); }
        const base64 = b.selfieDataUrl.split(',')[1]; const { error: errS } = await window.sb.rpc('guardar_selfie', { p_servicio_custodio_id: cId, p_mime_type: 'image/jpeg', p_base64: base64 });
        if (errS) { console.error(errS); return showMsg('Error al guardar selfie'); }
      }
      showMsg('Servicio registrado en Supabase ✅'); sessionStorage.setItem('servicio_id_actual', servicio_id); location.href = '/html/dashboard/mapa-resguardo.html';
    } catch (err) { console.error(err); showMsg('Error en el registro'); }
  });

  // Limpiar
  document.getElementById('btn-limpiar')?.addEventListener('click', () => {
    try { custodiosUI.forEach(ui => { stopStream(ui); ui.nameInput.value = ''; ui.selfieDataUrl = null; ui.img.style.display='none'; ui.video.style.display='none'; ui.btnStart.disabled=false; ui.btnShot.disabled=true; ui.btnReset.disabled=true; ui.status.textContent=''; }); } catch {}
    form.reset(); currentTipo = tipoEl.value; renderCustodios();
    clearSuggestions(); destinoCoords = null; direccionEstado.textContent = 'Formulario limpio.'; direccionEstado.style.color = '';
  });

  // Acciones del modal
  mBtnCancel?.addEventListener('click', () => { modalAct.classList.remove('show'); forceNew = false; });
  mBtnVer?.addEventListener('click', () => { if (!activeSvc) return; sessionStorage.setItem('servicio_id_actual', activeSvc.id); location.href = '/html/dashboard/mapa-resguardo.html'; });
  mBtnNuevo?.addEventListener('click', () => { forceNew = true; modalAct.classList.remove('show'); showMsg('Registrar nuevo servicio'); });
  mBtnJoin?.addEventListener('click', async () => {
    try {
      if (!activeSvc) return; modalAct.classList.remove('show');
      const custs = activeCustodios || await getCustodios(activeSvc.id);
      const tGlobal = tipoEl.value; const expectedKinds = kindsForTipo(tGlobal);
      const completeKinds = new Set(custs.filter(isCompleto).map(c => kindFromTipoCustodia(c.tipo_custodia)));
      const incompleteMap = new Map(); for (const c of custs) { const k = kindFromTipoCustodia(c.tipo_custodia); if (!isCompleto(c)) incompleteMap.set(k, c); }
      const bloques = bloquesCompletos();
      const actions = [];
      for (const b of bloques) {
        const k = b.kind; if (!expectedKinds.includes(k)) continue;
        const inc = incompleteMap.get(k);
        if (inc) actions.push({ mode:'update', id: inc.id, nombre: b.nameInput.value.trim(), selfie: b.selfieDataUrl });
        else if (!completeKinds.has(k)) actions.push({ mode:'create', k, nombre: b.nameInput.value.trim(), selfie: b.selfieDataUrl });
      }
      for (const a of actions) {
        if (a.mode === 'update') {
          const { error: e1 } = await window.sb.from('servicio_custodio').update({ nombre: a.nombre }).eq('id', a.id); if (e1) throw e1;
          const base64 = a.selfie.split(',')[1]; const { error: e2 } = await window.sb.rpc('guardar_selfie', { p_servicio_custodio_id: a.id, p_mime_type: 'image/jpeg', p_base64: base64 }); if (e2) throw e2;
        } else {
          const tipo_custodia = tipoForKind(a.k);
          const { data: cId, error: e3 } = await window.sb.rpc('agregar_custodio', { p_servicio_id: activeSvc.id, p_nombre: a.nombre, p_tipo_custodia: tipo_custodia }); if (e3) throw e3;
          const base64 = a.selfie.split(',')[1]; const { error: e4 } = await window.sb.rpc('guardar_selfie', { p_servicio_custodio_id: cId, p_mime_type: 'image/jpeg', p_base64: base64 }); if (e4) throw e4;
        }
      }
      showMsg('Registro completado ✅'); sessionStorage.setItem('servicio_id_actual', activeSvc.id); location.href = '/html/dashboard/mapa-resguardo.html';
    } catch (e) { console.error(e); showMsg('Error al completar'); }
  });
});
