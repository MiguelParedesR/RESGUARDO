// dashboard-consulta.js – Consulta por Cliente → Placas → Servicios → Custodios + Selfies
// Requiere: window.sb (config.js) y tablas conforme al esquema definido.

document.addEventListener('DOMContentLoaded', () => {
    const h = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
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
    // Bloquear menú contextual
    document.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.sensitive')) {
            e.preventDefault();
            showMsg('Zona protegida');
        }
    });
    // Overlay si la pestaña se oculta
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            antiOverlay.classList.add('show');
        } else {
            antiOverlay.classList.remove('show');
        }
    });
    // Intento disuasivo ante PrintScreen
    document.addEventListener('keydown', (e) => {
        if (e.key && e.key.toLowerCase() === 'printscreen') {
            antiOverlay.classList.add('show');
            setTimeout(() => antiOverlay.classList.remove('show'), 1200);
            showMsg('Captura desaconsejada en esta zona');
        }
    });

    // UI elementos
    const selectCliente = document.getElementById('select-cliente');
    const btnReset = document.getElementById('btn-reset');
    const placasContainer = document.getElementById('placas-container');

    if (!window.sb) {
        console.error('[consulta] Supabase no inicializado (config.js)');
        showMsg('Error de inicialización');
        return;
    }

    // Helpers
    const fmtFecha = (iso) => {
        try {
            const d = new Date(iso);
            return new Intl.DateTimeFormat('es-PE', {
                dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima'
            }).format(d);
        } catch { return iso || ''; }
    };

    function groupBy(arr, keyFn) {
        return arr.reduce((acc, item) => {
            const k = keyFn(item);
            (acc[k] ||= []).push(item);
            return acc;
        }, {});
    }

    async function cargarClientes() {
        try {
            const { data, error } = await window.sb
                .from('cliente')
                .select('id, nombre')
                .order('nombre', { ascending: true });
            if (error) throw error;

            // Reset
            selectCliente.innerHTML = '<option value="">– Seleccione cliente –</option>';
            for (const c of data) {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.nombre;
                selectCliente.appendChild(opt);
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

        Object.entries(porPlaca).forEach(([placa, lista]) => {
            const total = lista.length;
            const ultima = lista[0]; // más reciente por order('created_at', desc)

            const card = document.createElement('div');
            card.className = 'mdl-card mdl-shadow--2dp placa-card sensitive';

            const header = document.createElement('div');
            header.className = 'placa-header';
            header.innerHTML = `
        <div class="placa-title">
          <span class="chip">${placa}</span>
          <div class="placa-meta">${total} servicio(s) · Último: ${fmtFecha(ultima.created_at)}</div>
        </div>
        <button class="mdl-button mdl-js-button mdl-button--icon" aria-label="Expandir">
          <i class="material-icons">expand_more</i>
        </button>
      `;

            const panel = document.createElement('div');
            panel.className = 'servicios-panel';

            header.addEventListener('click', async () => {
                panel.classList.toggle('open');
                const icon = header.querySelector('.material-icons');
                icon.textContent = panel.classList.contains('open') ? 'expand_less' : 'expand_more';

                // Si se está abriendo, renderizar servicios si aún no se cargaron
                if (panel.classList.contains('open') && !panel.dataset.loaded) {
                    // Render sincrónico: pintamos skeleton y luego cargamos custodia+foto
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
            placasContainer.appendChild(card);
            if (window.componentHandler && window.componentHandler.upgradeElement) {
                window.componentHandler.upgradeElement(card);
            }
        });
    }

    async function renderServicioCard(svc) {
        const card = document.createElement('div');
        card.className = 'mdl-card mdl-shadow--2dp servicio-card';

        const estadoClass = (svc.estado === 'FINALIZADO') ? 'estado-finalizado' : 'estado-activo';

        // Estructura base
        card.innerHTML = `
      <div class="mdl-card__title">
        <h2 class="mdl-card__title-text">Servicio #${svc.id}</h2>
      </div>
      <div class="mdl-card__supporting-text servicio-body">
        <div class="servicio-info">
          <p><strong>Placa:</strong> ${svc.placa || '—'}</p>
          <p><strong>Tipo:</strong> ${svc.tipo || '—'}</p>
          <p><strong>Destino:</strong> ${svc.destino_texto || '—'}</p>
          <p><strong>Fecha:</strong> ${fmtFecha(svc.created_at)}</p>
          <p class="estado ${estadoClass}"><strong>Estado:</strong> ${svc.estado}</p>
        </div>
        <div class="custodios" id="custodios-${svc.id}">
          <!-- Se llenará con custodios + selfies -->
        </div>
      </div>
    `;

        // Cargar custodios y selfies
        try {
            const { data: custodios, error: errC } = await window.sb
                .from('servicio_custodio')
                .select('id, tipo_custodia, custodio_id')
                .eq('servicio_id', svc.id);
            if (errC) throw errC;

            const cont = card.querySelector(`#custodios-${svc.id}`);
            cont.innerHTML = '';

            if (!custodios || !custodios.length) {
                cont.innerHTML = `<div class="hint">Sin custodios registrados en este servicio.</div>`;
            } else {
                // Traer todas las selfies de golpe para estos custodios
                const ids = custodios.map(c => c.id);
                const { data: selfies, error: errS } = await window.sb
                    .from('selfie')
                    .select('servicio_custodio_id, mime_type, data_base64')
                    .in('servicio_custodio_id', ids);
                if (errS) throw errS;

                const selfiesMap = new Map();
                (selfies || []).forEach(s => selfiesMap.set(s.servicio_custodio_id, s));

                // Resolver nombres de custodios por lote (sin relaciones PostgREST)
                const nombresMap = new Map();
                try {
                    const custIds = Array.from(new Set((custodios || []).map(c => c.custodio_id).filter(Boolean)));
                    if (custIds.length) {
                        const { data: nombres, error: errN } = await window.sb
                            .from('custodio')
                            .select('id, nombre')
                            .in('id', custIds);
                        if (errN) throw errN;
                        (nombres || []).forEach(n => nombresMap.set(n.id, n.nombre));
                    }
                } catch (e2) {
                    console.warn('[consulta] No se pudo resolver nombres de custodios', e2);
                }

                for (const c of custodios) {
                    const s = selfiesMap.get(c.id);
                    const imgSrc = s ? `data:${s.mime_type};base64,${s.data_base64}` : '';
                    const nombreCustodio = nombresMap.get(c.custodio_id) || '';
                    const custEl = document.createElement('div');
                    custEl.className = 'custodio-card';
                    custEl.innerHTML = `
            ${imgSrc ? `<img draggable="false" alt="Selfie de ${nombreCustodio}" src="${imgSrc}" />` : `<div class="hint">Sin selfie</div>`}
            <h4>${nombreCustodio || '—'}</h4>
            <div class="tipo">${c.tipo_custodia || ''}</div>
          `;
                    // Reemplazar el contenido por construcción segura de nodos
                    try {
                        const n = nombreCustodio || '-';
                        const t = c.tipo_custodia || '';
                        const frag = document.createDocumentFragment();
                        if (imgSrc) {
                            const img = document.createElement('img');
                            img.setAttribute('draggable', 'false');
                            img.alt = `Selfie de ${n}`;
                            img.src = imgSrc;
                            frag.appendChild(img);
                        } else {
                            const noImg = document.createElement('div');
                            noImg.className = 'hint';
                            noImg.textContent = 'Sin selfie';
                            frag.appendChild(noImg);
                        }
                        const h4 = document.createElement('h4');
                        h4.textContent = n;
                        frag.appendChild(h4);
                        const tipoDiv = document.createElement('div');
                        tipoDiv.className = 'tipo';
                        tipoDiv.textContent = t;
                        frag.appendChild(tipoDiv);
                        custEl.innerHTML = '';
                        custEl.appendChild(frag);
                    } catch {}
                    cont.appendChild(custEl);
                }
            }
        } catch (e) {
            console.error(e);
            showMsg('No se pudieron cargar custodios/selfies');
        }

        if (window.componentHandler && window.componentHandler.upgradeElement) {
            window.componentHandler.upgradeElement(card);
        }
        return card;
    }

    // Eventos
    selectCliente.addEventListener('change', async () => {
        const id = selectCliente.value;
        placasContainer.innerHTML = '';
        if (!id) return;
        await cargarServiciosPorCliente(id);
    });

    btnReset.addEventListener('click', () => {
        selectCliente.value = '';
        placasContainer.innerHTML = '';
    });

    // Start
    cargarClientes();
});
