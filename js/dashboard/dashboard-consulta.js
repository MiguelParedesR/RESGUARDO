// dashboard-consulta.js — Consulta por Cliente → Placas → Servicios → Custodios + Selfies

document.addEventListener('DOMContentLoaded', () => {
    const h = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
    const toBase64 = (data) => {
        try {
            if (!data) return '';
            if (/^[A-Za-z0-9+/]+=*$/.test(data)) return data;
            if (typeof data === 'string' && data.startsWith('\\x')) {
                const hex = data.slice(2);
                let bin = '';
                for (let i = 0; i < hex.length; i += 2) bin += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
                return btoa(bin);
            }
            return btoa(data);
        } catch { return ''; }
    };

    // Snackbar
    const snackbar = document.getElementById('app-snackbar');
    const showMsg = (message) => {
        try {
            if (snackbar && snackbar.MaterialSnackbar) snackbar.MaterialSnackbar.showSnackbar({ message });
            else alert(message);
        } catch { alert(message); }
    };

    // Anti-exfiltración básica (disuasiva)
    const antiOverlay = document.getElementById('anti-capture-overlay');
    document.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.sensitive')) {
            e.preventDefault();
            showMsg('Zona protegida');
        }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) antiOverlay?.classList.add('show');
        else antiOverlay?.classList.remove('show');
    });
    document.addEventListener('keydown', (e) => {
        if (e.key && e.key.toLowerCase() === 'printscreen') {
            antiOverlay?.classList.add('show');
            setTimeout(() => antiOverlay?.classList.remove('show'), 1200);
            showMsg('Captura desaconsejada en esta zona');
        }
    });

    // UI elementos
    const btnReset = document.getElementById('btn-reset');
    const placasContainer = document.getElementById('placas-container');
    const sidebar = document.getElementById('sidebar');
    const toggleSidebarBtn = document.getElementById('toggle-sidebar');
    const scrim = document.getElementById('scrim');
    const searchClientes = document.getElementById('search-clientes');
    const listaClientes = document.getElementById('lista-clientes');
    const searchClientesMobile = document.getElementById('search-clientes-mobile');
    const datalistClientes = document.getElementById('clientes-datalist');
    const fotosModal = document.getElementById('fotos-modal');
    const fotosGrid = document.getElementById('fotos-grid');

    if (!window.sb) {
        console.error('[consulta] Supabase no inicializado (config.js)');
        showMsg('Error de inicialización');
        return;
    }

    // Helpers
    const fmtFecha = (iso) => {
        try {
            const d = new Date(iso);
            return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima' }).format(d);
        } catch { return iso || ''; }
    };
    function groupBy(arr, keyFn) {
        return arr.reduce((acc, item) => { const k = keyFn(item); (acc[k] ||= []).push(item); return acc; }, {});
    }

    // Estado y sidebar
    let clientesCache = [];
    let clienteSeleccionado = null;

    function renderSidebar(clientes) {
        listaClientes.innerHTML = '';
        for (const c of clientes) {
            const li = document.createElement('li');
            li.dataset.id = c.id;
            li.innerHTML = '<span>' + h(c.nombre) + '</span>';
            li.addEventListener('click', async () => {
                clienteSeleccionado = c;
                for (const item of listaClientes.querySelectorAll('li')) item.classList.remove('is-active');
                li.classList.add('is-active');
                placasContainer.innerHTML = '';
                await cargarServiciosPorCliente(c.id);
                if (window.matchMedia('(max-width: 1023px)').matches) closeSidebar();
            });
            listaClientes.appendChild(li);
        }
    }
    function filterClientes(q) {
        q = (q || '').toLowerCase().trim();
        if (!q) return renderSidebar(clientesCache);
      // build datalist for mobile
      if (datalistClientes) {
        datalistClientes.innerHTML = '';
        for (const c of clientesCache) {
          const o = document.createElement('option');
          o.value = c.nombre;
          datalistClientes.appendChild(o);
        }
      }
        renderSidebar(clientesCache.filter(c => (c.nombre || '').toLowerCase().includes(q)));
    }

    async function cargarClientes() {
        try {
            const { data, error } = await window.sb
                .from('cliente')
                .select('id, nombre')
                .order('nombre', { ascending: true });
            if (error) throw error;
            clientesCache = data || [];
            renderSidebar(clientesCache);
      // build datalist for mobile
      if (datalistClientes) {
        datalistClientes.innerHTML = '';
        for (const c of clientesCache) {
          const o = document.createElement('option');
          o.value = c.nombre;
          datalistClientes.appendChild(o);
        }
      }
        } catch (e) {
            console.error(e);
            showMsg('No se pudieron cargar los clientes');
        }
    }

    async function cargarServiciosPorCliente(clienteId) {
        try {
            const { data, error } = await window.sb
                .from('servicio')
                .select('id, placa, destino_texto, estado, tipo, created_at')
                .eq('cliente_id', clienteId)
                .order('created_at', { ascending: false });
            if (error) throw error;
            renderPlacasAgrupadas(data || []);
        } catch (e) {
            console.error(e);
            showMsg('No se pudieron cargar los servicios del cliente');
        }
    }

    function renderPlacasAgrupadas(servicios) {
        placasContainer.innerHTML = '';
        if (!servicios.length) {
            placasContainer.innerHTML = `
        <div class="mdl-card mdl-shadow--2dp placa-card">
          <div class="mdl-card__supporting-text">Sin servicios para este cliente.</div>
        </div>`;
            return;
        }

        const porPlaca = groupBy(servicios, s => s.placa || 'SIN-PLACA');

        // Grupo por cliente seleccionado
        const selectedText = (clienteSeleccionado && clienteSeleccionado.nombre) || '';
        const group = document.createElement('section');
        group.className = 'cliente-group';
        const totalPlacas = Object.keys(porPlaca).length;
        group.innerHTML = `
      <header class="cliente-header">
        <h3 class="cliente-title">${h(selectedText)}</h3>
        <div class="cliente-subtitle">${servicios.length} servicio(s) · ${totalPlacas} placa(s)</div>
      </header>
      <div class="placas-grid" id="cliente-cards"></div>
    `;
        const cardsContainer = group.querySelector('#cliente-cards');
        placasContainer.appendChild(group); group.classList.add("mount-fade");

        Object.entries(porPlaca).forEach(([placa, lista]) => {
            const total = lista.length;
            const ultima = lista[0];

            const card = document.createElement('article');
            card.className = 'mdl-card mdl-shadow--2dp placa-card sensitive';

            const header = document.createElement('div');
            header.className = 'placa-header';
            header.setAttribute('aria-expanded', 'false');
            '
header.innerHTML = `
        <div class="placa-title">
          <span class="chip">${placa}</span>
          <div class="placa-meta">${h((clienteSeleccionado && clienteSeleccionado.nombre) || ')} � ${ultima.tipo || '}</div>
        </div>
        <button class="mdl-button mdl-js-button mdl-button--icon" aria-label="Expandir">
          <i class="material-icons expand-icon">expand_more</i>
        </button>
      `;
'

            const panel = document.createElement('div');
            panel.className = 'servicios-panel';

            header.addEventListener('click', async () => {
                panel.classList.toggle('open');
                const icon = header.querySelector('.material-icons');
                const open = panel.classList.contains('open');
                icon.textContent = open ? 'expand_less' : 'expand_more';
                header.setAttribute('aria-expanded', open ? 'true' : 'false');
                if (open && !panel.dataset.loaded) {
                    panel.innerHTML = '';
                    for (const svc of lista) {
                        const svcEl = await renderServicioCard(svc);
                        panel.appendChild(svcEl);
                    }
                    panel.dataset.loaded = '1';
                }
            });

            card.appendChild(header);
            card.appendChild(panel);
            cardsContainer.appendChild(card);
            if (window.componentHandler && window.componentHandler.upgradeElement) window.componentHandler.upgradeElement(card);
        });
    }

    async function renderServicioCard(svc) {
        const card = document.createElement('div');
        card.className = 'mdl-card mdl-shadow--2dp servicio-card';
        const estadoClass = (svc.estado === 'FINALIZADO') ? 'estado-finalizado' : 'estado-activo';

        card.innerHTML = `
      <div class="mdl-card__title">
        <h2 class="mdl-card__title-text">Servicio #${svc.id}</h2>
      </div>
      <div class="mdl-card__supporting-text servicio-body">
        <div class="servicio-info">
          <p><strong>Placa:</strong> ${svc.placa || ''}</p>
          <p><strong>Tipo:</strong> ${svc.tipo || ''}</p>
          <p><strong>Destino:</strong> ${svc.destino_texto || ''}</p>
          <p><strong>Fecha:</strong> ${fmtFecha(svc.created_at)}</p>
          <p class="estado ${estadoClass}"><strong>Estado:</strong> ${svc.estado}</p>
        </div>
        <div class="custodios" id="custodios-${svc.id}"></div>
      </div>
    `;

        try {
            const { data: custodios, error: errC } = await window.sb
                .from('servicio_custodio')
                .select('id, nombre_custodio, tipo_custodia')
                .eq('servicio_id', svc.id);
            if (errC) throw errC;

            const cont = card.querySelector(`#custodios-${svc.id}`);
            cont.innerHTML = '';

            if (!custodios || !custodios.length) {
                cont.innerHTML = `<div class="hint">Sin custodios registrados en este servicio.</div>`;
            } else {
                const ids = custodios.map(c => c.id);
                const { data: selfies, error: errS } = await window.sb
                    .from('selfie')
                    .select('servicio_custodio_id, mime_type, bytes')
                    .in('servicio_custodio_id', ids);
                if (errS) throw errS;

                const selfiesMap = new Map();
                (selfies || []).forEach(s => selfiesMap.set(s.servicio_custodio_id, s));

                for (const c of custodios) {
                    const s = selfiesMap.get(c.id);
                    const b64 = s ? toBase64(s.data_base64 || s.bytes) : '';
                    const imgSrc = b64 ? `data:${s.mime_type};base64,${b64}` : '';
                    const nombreCustodio = c.nombre_custodio || '';
                    const custEl = document.createElement('div');
                    custEl.className = 'custodio-card';
                    if (imgSrc) {
                        const img = document.createElement('img');
                        img.setAttribute('draggable', 'false');
                        img.alt = `Selfie de ${nombreCustodio}`;
                        img.src = imgSrc;
                        custEl.appendChild(img);
                    } else {
                        const noImg = document.createElement('div');
                        noImg.className = 'hint';
                        noImg.textContent = 'Sin selfie';
                        custEl.appendChild(noImg);
                    }
                    const h4 = document.createElement('h4');
                    h4.textContent = nombreCustodio || '-';
                    custEl.appendChild(h4);
                    const tipoDiv = document.createElement('div');
                    tipoDiv.className = 'tipo';
                    tipoDiv.textContent = c.tipo_custodia || '';
                    custEl.appendChild(tipoDiv);
                    cont.appendChild(custEl);
                }

                const hasSelfies = (selfies || []).length > 0;
                if (hasSelfies) {
                    const actions = document.createElement('div');
                    actions.className = 'mdl-card__actions';
                    const btn = document.createElement('button');
                    btn.className = 'mdl-button mdl-js-button';
                    btn.textContent = 'Mostrar fotos de custodia';
                    btn.addEventListener('click', () => {
                        const items = [];
                        for (const c of custodios) {
                            const s = selfiesMap.get(c.id);
                            if (!s) continue;
                            const b64 = toBase64(s.data_base64 || s.bytes);
                            if (!b64) continue;
                            items.push({ src: `data:${s.mime_type};base64,${b64}`, label: c.nombre_custodio || '' });
                        }
                        if (items.length) showFotosCustodia(items); else showMsg('Sin fotos de custodia');
                    });
                    actions.appendChild(btn);
                    card.appendChild(actions);
                }
            }
        } catch (e) {
            console.error(e);
            showMsg('No se pudieron cargar custodios/selfies');
        }

        if (window.componentHandler && window.componentHandler.upgradeElement) window.componentHandler.upgradeElement(card);
        return card;
    }

    // Sidebar toggle
    function openSidebar() { sidebar && sidebar.classList.add('open'); scrim && scrim.removeAttribute('hidden'); }
    function closeSidebar() { sidebar && sidebar.classList.remove('open'); scrim && scrim.setAttribute('hidden', ''); }
      // Ensure correct UI when resizing (hide overlay or close drawer)
  const mqTablet = window.matchMedia('(max-width: 1023px)');
  const mqMobile = window.matchMedia('(max-width: 599px)');
  function syncResponsiveState(){
    if (mqMobile.matches) { closeSidebar(); if (toggleSidebarBtn) toggleSidebarBtn.style.display = 'none'; }
    else { if (toggleSidebarBtn) toggleSidebarBtn.style.display = ''; }
    if (!mqTablet.matches) { scrim && scrim.setAttribute('hidden',''); }
  }
  window.addEventListener('resize', () => { syncResponsiveState(); });
  syncResponsiveState();toggleSidebarBtn && toggleSidebarBtn.addEventListener('click', () => {
        if (sidebar && sidebar.classList.contains('open')) closeSidebar(); else openSidebar();
    });
    scrim && scrim.addEventListener('click', closeSidebar);
    searchClientes && searchClientes.addEventListener('input', () => filterClientes(searchClientes.value));

      // Mobile header search
  if (searchClientesMobile) {
    const trigger = async () => {
      const name = (searchClientesMobile.value || '').trim().toLowerCase();
      const found = clientesCache.find(c => (c.nombre || '').toLowerCase() === name);
      if (found) {
        clienteSeleccionado = found;
        placasContainer.innerHTML = '';
        await cargarServiciosPorCliente(found.id);
      }
    };
    searchClientesMobile.addEventListener('change', trigger);
    searchClientesMobile.addEventListener('keydown', (e) => { if (e.key === 'Enter') trigger(); });
  }// Modal fotos
    function showFotosCustodia(items) {
        if (!fotosModal || !fotosGrid) return;
        fotosGrid.innerHTML = '';
        for (const it of items) {
            const fig = document.createElement('figure');
            const img = document.createElement('img');
            img.src = it.src;
            img.alt = it.label || 'Foto de custodia';
            const cap = document.createElement('figcaption');
            cap.textContent = it.label || '';
            fig.appendChild(img);
            fig.appendChild(cap);
            fotosGrid.appendChild(fig);
        }
        fotosModal.setAttribute('aria-hidden', 'false');
    }
    fotosModal && fotosModal.addEventListener('click', (e) => {
        const t = e.target;
        if (t.matches('[data-close="modal"], .modal-backdrop')) {
            fotosModal.setAttribute('aria-hidden', 'true');
            fotosGrid && (fotosGrid.innerHTML = '');
        }
    });

    // Reset
    btnReset && btnReset.addEventListener('click', () => {
        clienteSeleccionado = null;
        placasContainer.innerHTML = '';
        listaClientes && listaClientes.querySelectorAll('li').forEach(li => li.classList.remove('is-active'));
        if (searchClientes) { searchClientes.value = ''; renderSidebar(clientesCache);
      // build datalist for mobile
      if (datalistClientes) {
        datalistClientes.innerHTML = '';
        for (const c of clientesCache) {
          const o = document.createElement('option');
          o.value = c.nombre;
          datalistClientes.appendChild(o);
        }
      } }
    });

    // Start
    cargarClientes();
});
