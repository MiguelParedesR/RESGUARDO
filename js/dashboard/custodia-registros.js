// js/dashboard/custodia-registros.js - Lista de servicios por empresa (rol CUSTODIA) con filtro por cliente

document.addEventListener('DOMContentLoaded', () => {
  const snackbar = document.getElementById('app-snackbar');
  const showMsg = (message, timeout = 2500) => {
    try {
      if (snackbar?.MaterialSnackbar) {
        snackbar.MaterialSnackbar.showSnackbar({ message, timeout });
      } else {
        alert(message);
      }
    } catch {
      alert(message);
    }
  };

  const role = (sessionStorage.getItem('auth_role') || '').toUpperCase();
  const empresa = (sessionStorage.getItem('auth_empresa') || '').toUpperCase();
  if (role !== 'CUSTODIA' || !empresa) {
    location.replace('/html/login/login.html');
    return;
  }
  if (!window.sb) {
    showMsg('Supabase no inicializado');
    return;
  }

  // UI references
  const cardsContainer = document.getElementById('cards-custodia');
  const placeholder = document.getElementById('cards-placeholder');
  const clienteSelect = document.getElementById('cliente-select');
  const btnClearSelect = document.getElementById('cliente-clear');
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
  let mediaStream = null;
  let selfieDataUrl = null;

  function openDrawer() {
    drawer?.classList.add('open');
    drawer?.setAttribute('aria-hidden', 'false');
    drawerBackdrop?.classList.add('show');
  }

  function closeDrawer() {
    drawer?.classList.remove('open');
    drawer?.setAttribute('aria-hidden', 'true');
    drawerBackdrop?.classList.remove('show');
    try { stopCamera(); } catch {}
  }

  drawerClose?.addEventListener('click', closeDrawer);
  drawerBackdrop?.addEventListener('click', closeDrawer);

  btnIniciarCam?.addEventListener('click', async () => {
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

  btnTomarFoto?.addEventListener('click', () => {
    if (!mediaStream) {
      showMsg('Inicia la cámara primero');
      return;
    }
    const w = camVideo.videoWidth || 640;
    const h = camVideo.videoHeight || 480;
    camCanvas.width = w;
    camCanvas.height = h;
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

  btnRepetir?.addEventListener('click', () => {
    if (!mediaStream) return;
    selfieDataUrl = null;
    selfiePreview.style.display = 'none';
    camVideo.style.display = 'block';
    btnTomarFoto.disabled = false;
    btnRepetir.disabled = true;
    camEstado.textContent = 'Listo para tomar otra';
  });

  function stopCamera() {
    try {
      if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
    } catch {}
    mediaStream = null;
    camVideo.style.display = 'none';
  }

  window.addEventListener('beforeunload', stopCamera);

  // Estado global
  const defaultPlaceholder = 'Selecciona un cliente para visualizar los servicios disponibles.';
  let servicios = []; // [{ svc, custodios, total, completos }]
  let clientes = []; // [{ id, nombre }]
  let clienteSeleccionado = '';
  let currentRow = null; // { svc, custodios, total, completos }

  function showPlaceholder(message) {
    if (!placeholder) return;
    placeholder.textContent = message;
    placeholder.classList.remove('hidden');
  }

  function hidePlaceholder() {
    placeholder?.classList.add('hidden');
  }

  function syncClearButton() {
    if (!btnClearSelect) return;
    const disabled = !clienteSeleccionado;
    btnClearSelect.disabled = disabled;
    btnClearSelect.classList.toggle('is-disabled', disabled);
  }

  const formatFecha = (iso) => {
    try {
      const d = new Date(iso);
      return new Intl.DateTimeFormat('es-PE', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(d);
    } catch {
      return iso || '';
    }
  };

  function renderSelectOptions() {
    if (!clienteSelect) return;
    const current = clienteSeleccionado;
    clienteSelect.innerHTML = '';
    const baseOption = document.createElement('option');
    baseOption.value = '';
    baseOption.textContent = 'Seleccione cliente';
    clienteSelect.appendChild(baseOption);
    for (const c of clientes) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.nombre || 'Cliente';
      if (c.id === current) opt.selected = true;
      clienteSelect.appendChild(opt);
    }
    if (current && !clientes.some(c => c.id === current)) {
      clienteSeleccionado = '';
    }
    if (!clienteSeleccionado) clienteSelect.value = '';
    syncClearButton();
  }

  function render() {
    if (!cardsContainer) return;
    cardsContainer.innerHTML = '';
    if (!clienteSeleccionado) {
      if (!clientes.length) {
        showPlaceholder('No hay servicios registrados en este momento.');
      } else {
        showPlaceholder(defaultPlaceholder);
      }
      syncClearButton();
      return;
    }

    const rows = servicios.filter(({ svc }) => {
      if (clienteSeleccionado === '__sin_cliente') return svc.cliente_id == null;
      return String(svc.cliente_id || '') === clienteSeleccionado;
    });

    if (!rows.length) {
      showPlaceholder('No se encontraron servicios para el cliente seleccionado.');
      syncClearButton();
      return;
    }

    hidePlaceholder();
    syncClearButton();

    for (const row of rows) {
      const { svc, custodios, total, completos } = row;
      const card = document.createElement('div');
      card.className = 'svc-card';

      const head = document.createElement('div');
      head.className = 'svc-head';
      const title = document.createElement('div');
      title.className = 'svc-title';
      const placa = (svc.placa || '').toUpperCase() || 'SIN PLACA';
      const clienteNombre = svc.cliente?.nombre || 'Cliente sin asignar';
      const partes = [placa, clienteNombre];
      if (svc.tipo) partes.push(svc.tipo);
      title.textContent = partes.join(' • ');
      head.appendChild(title);

      const estado = (svc.estado || '').toUpperCase();
      const badge = document.createElement('span');
      badge.className = 'badge ' + (estado === 'FINALIZADO' ? 'finalizado' : 'activo');
      badge.textContent = estado || 'ACTIVO';
      head.appendChild(badge);
      card.appendChild(head);

      const body = document.createElement('div');
      body.className = 'svc-body';

      if (svc.destino_texto) {
        const p = document.createElement('p');
        p.textContent = `Destino: ${svc.destino_texto}`;
        body.appendChild(p);
      }

      if (svc.origen_texto) {
        const p = document.createElement('p');
        p.textContent = `Origen: ${svc.origen_texto}`;
        body.appendChild(p);
      }

      const pFecha = document.createElement('p');
      pFecha.textContent = `Creado: ${formatFecha(svc.created_at)}`;
      body.appendChild(pFecha);

      const meta = document.createElement('div');
      meta.className = 'svc-meta';
      const prog = document.createElement('span');
      prog.textContent = `Custodios: ${completos} / ${total}`;
      meta.appendChild(prog);
      body.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'svc-actions';

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
      cardsContainer.appendChild(card);
    }
  }

  function isCompleto(c) {
    const nombreOk = Boolean((c?.nombre_custodio || '').trim());
    const tieneSelfie = Array.isArray(c?.selfie) ? c.selfie.length > 0 : false;
    return nombreOk && tieneSelfie;
  }

  async function getServicios() {
    const { data, error } = await window.sb
      .from('servicio')
      .select('id, empresa, placa, tipo, estado, destino_texto, origen_texto, created_at, cliente_id, cliente:cliente_id(nombre)')
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

  async function cargar() {
    try {
      showPlaceholder('Cargando servicios...');
      const base = await getServicios();
      servicios = [];
      const mapClientes = new Map();

      for (const svc of base) {
        const custodios = await getCustodios(svc.id);
        const total = custodios.length;
        const completos = custodios.filter(isCompleto).length;
        servicios.push({ svc, custodios, total, completos });

        const clienteId = svc.cliente_id != null ? String(svc.cliente_id) : '__sin_cliente';
        const nombre = svc.cliente?.nombre || (clienteId === '__sin_cliente' ? 'Cliente sin asignar' : 'Cliente');
        if (!mapClientes.has(clienteId)) {
          mapClientes.set(clienteId, { id: clienteId, nombre });
        }
      }

      clientes = Array.from(mapClientes.values()).sort((a, b) =>
        (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' })
      );

      if (clienteSeleccionado && !clientes.some(c => c.id === clienteSeleccionado)) {
        clienteSeleccionado = '';
      }

      renderSelectOptions();
      render();
    } catch (e) {
      console.error(e);
      showMsg('Error al cargar servicios');
      showPlaceholder('No fue posible cargar los servicios. Intenta nuevamente.');
    }
  }

  function abrirEdicion(row) {
    currentRow = row;
    if (!currentRow) return;
    const incompletos = currentRow.custodios.filter(c => !isCompleto(c));
    if (!incompletos.length) {
      showMsg('Este servicio ya se encuentra completo.');
      render();
      return;
    }

    incompletosList.innerHTML = '';
    incompletos.forEach((c, idx) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'incom-item' + (idx === 0 ? ' active' : '');
      item.textContent = c.nombre_custodio || '(Sin nombre)';
      item.dataset.id = c.id;
      item.addEventListener('click', () => seleccionarCustodio(c.id, item));
      incompletosList.appendChild(item);
    });

    if (incompletos[0]) seleccionarCustodio(incompletos[0].id, incompletosList.firstElementChild);
    openDrawer();
  }

  function seleccionarCustodio(id, btnEl) {
    Array.from(incompletosList.children).forEach(el => el.classList.toggle('active', el === btnEl));
    custIdEl.value = String(id);
    const c = currentRow?.custodios.find(x => x.id === id);
    nombreEl.value = c?.nombre_custodio || '';
    if (window.componentHandler && nombreEl.parentElement) {
      try { componentHandler.upgradeElement(nombreEl.parentElement); } catch {}
    }
    selfieDataUrl = null;
    selfiePreview.style.display = 'none';
    camVideo.style.display = 'none';
    btnTomarFoto.disabled = true;
    btnRepetir.disabled = true;
    btnIniciarCam.disabled = false;
    camEstado.textContent = '';
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = (custIdEl.value || '').trim();
    const nombre = (nombreEl.value || '').trim();
    if (!id) return showMsg('Seleccione un custodio');
    if (!nombre) return showMsg('Ingrese un nombre');

    try {
      const { error: errName } = await window.sb
        .from('servicio_custodio')
        .update({ nombre_custodio: nombre })
        .eq('id', id);
      if (errName) {
        console.error(errName);
        return showMsg('Error al actualizar nombre');
      }

      if (selfieDataUrl) {
        const base64 = selfieDataUrl.split(',')[1];
        const { error: errSelfie } = await window.sb.rpc('guardar_selfie', {
          p_servicio_custodio_id: id,
          p_mime_type: 'image/jpeg',
          p_base64: base64
        });
        if (errSelfie) {
          console.error(errSelfie);
          return showMsg('Error al guardar selfie');
        }
      }

      showMsg('Cambios guardados');
      await recargarServicio(currentRow?.svc.id);

      const updatedRow = currentRow
        ? servicios.find(r => r.svc.id === currentRow.svc.id)
        : null;
      currentRow = updatedRow || null;
      const quedan = currentRow ? currentRow.custodios.filter(c => !isCompleto(c)).length : 0;
      if (!quedan) closeDrawer();
    } catch (err) {
      console.error(err);
      showMsg('Error inesperado');
    }
  });

  async function recargarServicio(servicioId) {
    if (!servicioId) return;
    try {
      const custodios = await getCustodios(servicioId);
      const idx = servicios.findIndex(r => r.svc.id === servicioId);
      if (idx >= 0) {
        const total = custodios.length;
        const completos = custodios.filter(isCompleto).length;
        servicios[idx] = {
          svc: servicios[idx].svc,
          custodios,
          total,
          completos
        };
      }
      render();
      if (currentRow && currentRow.svc.id === servicioId) {
        currentRow = servicios.find(r => r.svc.id === servicioId) || null;
      }
    } catch (err) {
      console.error(err);
    }
  }

  clienteSelect?.addEventListener('change', () => {
    clienteSeleccionado = clienteSelect.value || '';
    render();
  });

  btnClearSelect?.addEventListener('click', () => {
    clienteSeleccionado = '';
    if (clienteSelect) clienteSelect.value = '';
    render();
  });

  cargar();
});
