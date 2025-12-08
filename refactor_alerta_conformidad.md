# Refactor alerta de conformidad (ping 15 min)

## Plan de refactor (ejecutar en orden)
1. **Dashboard-admin (JS/UI)**
   - Limpiar cualquier disparo automático de modal de pánico cuando `diffMin >= 16`.
   - Centralizar cálculo de estados por custodia (verde/amarillo/rojo) con un `setInterval` de 60 s basado en `ultimo_ping`.
   - Añadir badge global de "custodias sin reporte" y enlazar modal de listado.
   - Implementar modal de lista con acciones de "Enviar alerta" (megáfono) por custodia y snackbar de confirmación.
   - Conectar con Supabase/RT/RPC para publicar alerta puntual por custodia y refrescar estado visual sin recargar.

2. **Dashboard-admin (HTML/CSS)**
   - Insertar contenedor para badge global (icono + contador) en el header existente.
   - Crear markup minimal del modal (título, lista, botón cerrar, backdrop) reutilizando la paleta actual.
   - Añadir estilos para estados (verde/amarillo/rojo) y animación `pulseRed` para transición a crítico; estilos para badge y modal.

3. **Custodia mapa-resguardo (JS/UI)**
   - Revisar timer actual de "REPORTESE" y aislarlo en un controlador que evite solapamiento de modales.
   - Implementar receptor de alerta de pánico enviada por admin (Supabase/RT/RPC) que cierre el modal de conformidad y abra uno de pánico con audio fuerte + vibración.
   - Mantener flujo de confirmación: 1 minuto para responder en modal de conformidad; tras timeout solo marcar como "no reportado" (sin mostrar pánico en dashboard).
   - Asegurar que los sonidos se diferencian: sonido actual de conformidad vs sonido de pánico (alto volumen) y que el modal de pánico se ejecute en segundo plano (usar `Notification`/`navigator.vibrate`).

4. **Custodia mapa-resguardo (HTML/CSS)**
   - Separar visualmente los dos modales (`REPORTESE` y pánico admin) con clases/estados distintos; botón de cierre/respuesta consistente.
   - Estilos específicos para el modal de pánico (color de fondo + ícono megáfono) y evitar solapamiento.

5. **Integración / pruebas manuales**
   - Verificar recálculo de estados cada 60 s (cambiar `ultimo_ping` mock) y que el admin no recibe modales automáticos.
   - Simular múltiples custodias críticas y validar contador, modal y acciones de megáfono.
   - Probar flujo custodia: ping periódico, timeout de 1 min, recepción de alerta admin con cierre/apertura de modales, audio y vibración.

## Fragmentos JS propuestos

### Dashboard-admin: cálculo de estados + badge
```js
const CUSTODIA_STATE = { NORMAL: 'normal', WARN: 'warn', CRITICAL: 'critical' };
const STATUS_LIMITS = { warn: 15, critical: 16 };
let custodias = []; // {id, nombre, ultimo_ping_at, tipo}
let unchecked = new Map(); // id -> state
const badgeEl = document.getElementById('badge-custodias');
const badgeCountEl = badgeEl?.querySelector('.badge-count');
const modal = document.getElementById('modal-custodias');
const listEl = modal?.querySelector('[data-list]');

function diffMinutes(ts) {
  return (Date.now() - new Date(ts).getTime()) / 60000;
}

function computeState(c) {
  const diff = diffMinutes(c.ultimo_ping_at);
  if (diff >= STATUS_LIMITS.critical) return CUSTODIA_STATE.CRITICAL;
  if (diff > STATUS_LIMITS.warn) return CUSTODIA_STATE.WARN;
  return CUSTODIA_STATE.NORMAL;
}

function refreshStates() {
  unchecked.clear();
  custodias.forEach((c) => {
    const state = computeState(c);
    applyRowColor(c.id, state); // pinta fila/card (verde/amarillo/rojo + animación en transición a rojo)
    if (state === CUSTODIA_STATE.CRITICAL) unchecked.set(c.id, { ...c, state });
  });
  renderBadge();
  if (modal?.classList.contains('open')) renderModalList();
}

function renderBadge() {
  const count = unchecked.size;
  if (!badgeEl) return;
  badgeEl.classList.toggle('hidden', count === 0);
  if (badgeCountEl) badgeCountEl.textContent = count;
  if (count > 0) badgeEl.classList.add('pulse-red');
  else badgeEl.classList.remove('pulse-red');
}

function renderModalList() {
  if (!listEl) return;
  listEl.innerHTML = '';
  unchecked.forEach((c) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="row">
        <div class="meta">
          <div class="name">${h(c.nombre)}</div>
          <div class="tipo">${h(c.tipo || 'Simple')}</div>
          <div class="time">Último reporte: hace ${Math.round(diffMinutes(c.ultimo_ping_at))} min</div>
        </div>
        <button class="btn-alerta" data-id="${c.id}">📣 Enviar alerta</button>
      </div>`;
    listEl.appendChild(li);
  });
}

badgeEl?.addEventListener('click', () => {
  modal?.classList.add('open');
  renderModalList();
});
modal?.addEventListener('click', (e) => {
  if (e.target.dataset.close || e.target === modal) modal.classList.remove('open');
});
setInterval(refreshStates, 60000);
refreshStates();
```

### Dashboard-admin: acción megáfono (enviar alerta)
```js
async function sendAlertaCustodia(custodiaId) {
  try {
    await window.sb.rpc('alerta_admin_custodia', { custodia_id: custodiaId });
    showMsg(`Alerta enviada a ${getCustodiaNombre(custodiaId)}`);
    markPendingAlert(custodiaId); // opcional: UI "ALERTA ENVIADA"
  } catch (err) {
    console.error('[alerta admin] error', err);
    showMsg('No se pudo enviar la alerta');
  }
}

listEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-alerta');
  if (!btn) return;
  const id = btn.dataset.id;
  sendAlertaCustodia(id);
});
```

### Custodia (mapa-resguardo): controlador de modales
```js
const MODAL = {
  reporte: document.getElementById('modal-reporte'),
  panico: document.getElementById('modal-panico-admin'),
};
const timers = { reporte: null };
const sonidos = {
  reporte: new Audio('/assets/audio/reporte.mp3'),
  panico: new Audio('/assets/audio/panico.mp3'),
};

function abrirModalReporte() {
  cerrarModalPanico();
  clearTimeout(timers.reporte);
  MODAL.reporte?.classList.add('open');
  playSound(sonidos.reporte);
  timers.reporte = setTimeout(() => {
    marcarNoReportado(); // notifica backend que no respondió
    cerrarModalReporte();
  }, 60_000);
}
function cerrarModalReporte() {
  MODAL.reporte?.classList.remove('open');
  clearTimeout(timers.reporte);
}

function abrirModalPanicoAdmin(payload) {
  cerrarModalReporte();
  MODAL.panico?.classList.add('open');
  playSound(sonidos.panico, { loud: true });
  navigator.vibrate?.([400, 200, 400]);
  // opcional: Notification API para segundo plano
}
function cerrarModalPanico() {
  MODAL.panico?.classList.remove('open');
}

// Receptor Realtime de alerta admin
const alertaChannel = window.sb.channel(`custodia-alerta-${custodiaId}`);
alertaChannel
  .on('broadcast', { event: 'alerta_admin' }, (payload) => {
    abrirModalPanicoAdmin(payload);
  })
  .subscribe();
```

## Interfaces RPC / Realtime sugeridas
- **RPC**: `alerta_admin_custodia(custodia_id uuid)` → inserta registro en tabla `alertas_admin` y dispara broadcast Realtime.
- **Canal Realtime**: `custodia-alerta-<custodia_id>` con evento `broadcast` `{ event: 'alerta_admin', payload: { custodia_id, servicio_id, motivo: 'no_reporte' } }`.
- **Estado de ping**: seguir usando `ultimo_ping_at` desde tabla existente (`ubicacion` o similar). Enviar actualización de ping al confirmar botón del modal `REPORTESE` mediante RPC `registrar_ping_custodia(custodia_id)`.
- **Notificación de no reporte**: cuando vence el timeout de 1 minuto en custodia, llamar a RPC `custodia_no_reportada(custodia_id)` que solo marca estado y deja que dashboard recalcule en siguiente tick; no dispara modal en admin.
- **Audio**: reutilizar sonido de pánico actual del dashboard para `sonidos.panico` y mantener `sonidos.reporte` para conformidad.

## Notas de integración
- Reutilizar helpers existentes (`showMsg`, `h`, stores de tracking) donde ya están en `dashboard-admin.js`/`mapa.js` para minimizar regresiones.
- Evitar `setInterval` duplicados: si existe un loop similar, consolidar en uno que actualice ambas vistas (tabla + modal) cada 60 s.
- Mantener CSP: rutas de audio y assets deben ser locales (ya usados en dashboard).
- Asegurar que los modales usan clases exclusivas para prevenir solapamiento (`.modal-reporte` vs `.modal-panico-admin`).
- Validar en tablets: animaciones suaves (`pulseRed` corta) y sin bloqueos en el hilo principal.
