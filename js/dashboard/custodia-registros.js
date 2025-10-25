// js/dashboard/custodia-registros.js — Lista de servicios por empresa (rol CUSTODIA)

document.addEventListener('DOMContentLoaded', () => {
  const snackbar = document.getElementById('app-snackbar');
  const showMsg = (message) => {
    try { if (snackbar?.MaterialSnackbar) snackbar.MaterialSnackbar.showSnackbar({ message }); else alert(message); }
    catch { alert(message); }
  };

  // Guard básico: requiere rol CUSTODIA y empresa en sesión
  const role = (sessionStorage.getItem('auth_role') || '').toUpperCase();
  const empresa = (sessionStorage.getItem('auth_empresa') || '').toUpperCase();
  if (role !== 'CUSTODIA' || !empresa) { location.replace('/html/login/login.html'); return; }
  if (!window.sb) { showMsg('Supabase no inicializado'); return; }

  // UI refs
  const container = document.getElementById('cards-custodia');
  const searchInput = document.getElementById('search-text');
  const drawer = document.getElementById('drawer-edicion');
  const drawerBackdrop = document.getElementById('drawer-backdrop');
  const drawerClose = document.getElementById('drawer-close');
  const incompletosList = document.getElementById('incompletos-list');
  const form = document.getElementById('form-edicion');
  const nombreEl = document.getElementById('nombre-custodio');
  const custIdEl = document.getElementById('custodio-id');

  // Cámara
  const btnIniciarCam = document.getElementById('btn-iniciar-cam');
  const btnTomarFoto = document.getElementById('btn-tomar-foto');
  const btnRepetir = document.getElementById('btn-repetir-foto');
  const camVideo = document.getElementById('cam-video');
  const camCanvas = document.getElementById('cam-canvas');
  const selfiePreview = document.getElementById('selfie-preview');
  const camEstado = document.getElementById('cam-estado');
  let mediaStream = null, selfieDataUrl = null;

  function openDrawer() { drawer.classList.add('open'); drawerBackdrop.classList.add('show'); }
  function closeDrawer() { drawer.classList.remove('open'); drawerBackdrop.classList.remove('show'); try { stopCamera(); } catch {} }
  drawerClose?.addEventListener('click', closeDrawer);
  drawerBackdrop?.addEventListener('click', closeDrawer);

  // Cámara handlers (reuso de dashboard-custodia.js)
  btnIniciarCam?.addEventListener('click', async () => {
    try {
      btnIniciarCam.disabled = true;
      camEstado.textContent = 'Solicitando permisos...';
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      camVideo.srcObject = mediaStream;
      camVideo.style.display = 'block';
      selfiePreview.style.display = 'none';
      btnTomarFoto.disabled = false; btnRepetir.disabled = true;
      camEstado.textContent = 'Cámara lista';
    } catch (err) {
      console.error(err); camEstado.textContent = 'No se pudo acceder a la cámara'; btnIniciarCam.disabled = false;
    }
  });
  btnTomarFoto?.addEventListener('click', () => {
    if (!mediaStream) { showMsg('Inicia la cámara primero'); return; }
    const w = camVideo.videoWidth || 640, h = camVideo.videoHeight || 480;
    camCanvas.width = w; camCanvas.height = h;
    const ctx = camCanvas.getContext('2d');
    ctx.drawImage(camVideo, 0, 0, w, h);
    selfieDataUrl = camCanvas.toDataURL('image/jpeg', 0.85);
    selfiePreview.src = selfieDataUrl;
    selfiePreview.style.display = 'block';
    camVideo.style.display = 'none';
    btnTomarFoto.disabled = true; btnRepetir.disabled = false;
    camEstado.textContent = 'Selfie capturada';
  });
  btnRepetir?.addEventListener('click', () => {
    if (!mediaStream) return;
    selfieDataUrl = null; selfiePreview.style.display = 'none'; camVideo.style.display = 'block';
    btnTomarFoto.disabled = false; btnRepetir.disabled = true; camEstado.textContent = 'Listo para tomar otra';
  });
  function stopCamera() { try { if (mediaStream) mediaStream.getTracks().forEach(t => t.stop()); } catch {} mediaStream = null; }
  window.addEventListener('beforeunload', stopCamera);

  // Estado
  let servicios = []; // [{svc, custodios:[], completos,nTotal}]
  let filtroTxt = '';

  async function getServicios() {
    const { data, error } = await window.sb
      .from('servicio')
      .select('id, empresa, placa, tipo, estado, destino_texto, created_at, cliente:cliente_id(nombre)')
      .eq('empresa', empresa)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function getCustodios(servicioId) {
    const { data, error } = await window.sb
      .from('servicio_custodio')
      .select('id, nombre_custodio, created_at, selfie(id)')
      .eq('servicio_id', servicioId);
    if (error) throw error;
    return data || [];
  }

  function isCompleto(c) {
    const nombreOk = Boolean((c?.nombre_custodio || '').trim());
    const tieneSelfie = Array.isArray(c?.selfie) ? c.selfie.length > 0 : false;
    return nombreOk && tieneSelfie;
  }

  async function cargar() {
    try {
      container.innerHTML = '';
      const base = await getServicios();
      servicios = [];
      for (const svc of base) {
        const custodios = await getCustodios(svc.id);
        const total = custodios.length;
        const completos = custodios.filter(isCompleto).length;
        servicios.push({ svc, custodios, total, completos });
      }
      render();
    } catch (e) { console.error(e); showMsg('Error al cargar servicios'); }
  }

  function formatFecha(iso) {
    try { const d = new Date(iso); return new Intl.DateTimeFormat('es-PE',{ dateStyle:'medium', timeStyle:'short'}).format(d); } catch { return iso; }
  }

  function render() {
    const q = filtroTxt.trim().toUpperCase();
    container.innerHTML = '';
    for (const row of servicios) {
      const { svc, custodios, total, completos } = row;
      const placa = (svc.placa || '').toUpperCase();
      const cliente = (svc.cliente?.nombre || '').toUpperCase();
      if (q && !(placa.includes(q) || cliente.includes(q))) continue;

      const card = document.createElement('div');
      card.className = 'svc-card';

      const head = document.createElement('div');
      head.className = 'svc-head';
      const title = document.createElement('div');
      title.className = 'svc-title';
      title.textContent = `${placa}  ${svc.cliente?.nombre || '—'}  ${svc.tipo || ''}`;
      head.appendChild(title);

      const badge = document.createElement('span');
      const estado = (svc.estado || '').toUpperCase();
      badge.className = 'badge ' + (estado === 'FINALIZADO' ? 'finalizado' : 'activo');
      badge.textContent = estado || 'ACTIVO';
      head.appendChild(badge);
      card.appendChild(head);

      const body = document.createElement('div');
      body.className = 'svc-body';
      const p1 = document.createElement('p'); p1.textContent = `Destino: ${svc.destino_texto || '—'}`; body.appendChild(p1);
      if (svc.origen_texto) { const p0 = document.createElement('p'); p0.textContent = `Origen: ${svc.origen_texto}`; body.appendChild(p0); }
      const p2 = document.createElement('p'); p2.textContent = `Creado: ${formatFecha(svc.created_at)}`; body.appendChild(p2);

      const meta = document.createElement('div');
      meta.className = 'svc-meta';
      const prog = document.createElement('span'); prog.textContent = `Custodios: ${completos} / ${total}`; meta.appendChild(prog);
      body.appendChild(meta);

      const actions = document.createElement('div'); actions.className = 'svc-actions';
      if (completos < total) {
        const btnCompletar = document.createElement('button');
        btnCompletar.className = 'icon-btn';
        btnCompletar.innerHTML = '<i class="material-icons">person_add</i> Completar registro';
        btnCompletar.addEventListener('click', () => abrirEdicion(row));
        actions.appendChild(btnCompletar);
      } else {
        const btnVer = document.createElement('button');
        btnVer.className = 'icon-btn';
        btnVer.title = 'Ver mapa';
        btnVer.innerHTML = '<i class="material-icons">visibility</i> Ver mapa';
        btnVer.addEventListener('click', () => {
          sessionStorage.setItem('servicio_id_actual', svc.id);
          location.href = '/html/dashboard/mapa-resguardo.html';
        });
        actions.appendChild(btnVer);
      }
      body.appendChild(actions);
      card.appendChild(body);

      container.appendChild(card);
    }
  }

  // Drawer de edición
  let currentRow = null; // { svc, custodios, total, completos }
  function abrirEdicion(row) {
    currentRow = row;
    // render listado de incompletos
    incompletosList.innerHTML = '';
    const incompletos = row.custodios.filter(c => !isCompleto(c));
    incompletos.forEach((c, idx) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'incom-item' + (idx === 0 ? ' active' : '');
      item.textContent = (c.nombre_custodio || '(Sin nombre)');
      item.dataset.id = c.id;
      item.addEventListener('click', () => seleccionarCustodio(c.id, item));
      incompletosList.appendChild(item);
    });
    // precargar el primero
    if (incompletos[0]) seleccionarCustodio(incompletos[0].id, incompletosList.firstElementChild);
    openDrawer();
  }

  function seleccionarCustodio(id, btnEl) {
    Array.from(incompletosList.children).forEach(el => el.classList.toggle('active', el === btnEl));
    custIdEl.value = String(id);
    const c = currentRow.custodios.find(x => x.id === id);
    nombreEl.value = c?.nombre_custodio || '';
    if (window.componentHandler && nombreEl.parentElement) try { componentHandler.upgradeElement(nombreEl.parentElement); } catch {}
    // reset cámara
    selfieDataUrl = null; selfiePreview.style.display = 'none'; camVideo.style.display = 'none';
    btnTomarFoto.disabled = true; btnRepetir.disabled = true; btnIniciarCam.disabled = false; camEstado.textContent = '';
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = (custIdEl.value || '').trim();
    const nombre = (nombreEl.value || '').trim();
    if (!id) return showMsg('Seleccione un custodio');
    if (!nombre) return showMsg('Ingrese un nombre');

    try {
      // 1) update nombre
      const { error: errName } = await window.sb.from('servicio_custodio').update({ nombre_custodio: nombre }).eq('id', id);
      if (errName) { console.error(errName); return showMsg('Error al actualizar nombre'); }

      // 2) selfie opcional (si se tomó)
      if (selfieDataUrl) {
        const base64 = selfieDataUrl.split(',')[1];
        const { error: errSelfie } = await window.sb.rpc('guardar_selfie', {
          p_servicio_custodio_id: id,
          p_mime_type: 'image/jpeg',
          p_base64: base64
        });
        if (errSelfie) { console.error(errSelfie); return showMsg('Error al guardar selfie'); }
      }

      showMsg('Cambios guardados');
      await recargarServicio(currentRow.svc.id);

      // si ya no quedan pendientes, cerrar
      const quedan = currentRow.custodios.filter(c => !isCompleto(c)).length;
      if (!quedan) closeDrawer();
    } catch (e2) { console.error(e2); showMsg('Error inesperado'); }
  });

  async function recargarServicio(servicioId) {
    try {
      const custodios = await getCustodios(servicioId);
      const idx = servicios.findIndex(r => r.svc.id === servicioId);
      if (idx >= 0) {
        const total = custodios.length;
        const completos = custodios.filter(isCompleto).length;
        servicios[idx] = { svc: servicios[idx].svc, custodios, total, completos };
      }
      render();
      if (currentRow && currentRow.svc.id === servicioId) currentRow = servicios.find(r => r.svc.id === servicioId);
    } catch (e) { console.error(e); }
  }

  // Búsqueda local
  searchInput?.addEventListener('input', () => { filtroTxt = searchInput.value || ''; render(); });

  cargar();
});
