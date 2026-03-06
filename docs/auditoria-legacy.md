# Auditoria Interna Legacy (Fases 1-4)

Fecha de auditoria: 2026-03-06  
Repositorio auditado: `RESGUARDO`

## 0) Alcance auditado

Se audito el sistema legacy completo en:

- HTML: `html/**/*.html` (11 archivos)
- JS frontend: `js/**/*.js` + `modules/alarma/alarma.js` + `config.js` + `service-worker.js`
- JS backend serverless: `netlify/functions/*.js`
- CSS: `css/**/*.css` + `modules/alarma/alarma.css`

Artefactos line-by-line generados:

- `docs/legacy-audit/functions.csv` (692 simbolos)
- `docs/legacy-audit/events.csv` (234 eventos detectados)
- `docs/legacy-audit/supabase-deep.csv` (77 interacciones Supabase multilinea)
- `docs/legacy-audit/supabase-inline-html.csv` (8 interacciones en scripts inline)
- `docs/legacy-audit/fetch.csv` (16 fetch)
- `docs/legacy-audit/navigation.csv`
- `docs/legacy-audit/storage.csv`
- `docs/legacy-audit/function-inventory-full.csv` (624 funciones clasificadas con dependencias/eventos/supabase)
- `docs/legacy-audit/summary.txt`

## Fase 1 - Auditoria completa del sistema

### 1.1 Arquitectura actual (as-is)

Arquitectura observada:

1. Frontend multi-pagina (MPA) en HTML + JS vanilla + CSS.
2. Supabase JS v2 via CDN (`window.sb`) para CRUD, RPC y Realtime.
3. Netlify Functions para push/check-in/desvio/IA:
   - `push-send`
   - `push-broadcast`
   - `push-cron-checkin`
   - `checkin-scheduler`
   - `ruta-desvio-handler`
   - `ruta-ai-helper`
4. Service Worker con cache runtime + push notifications + bridge a UI (`channel: "alarma"`).
5. Integracion de mapas con Leaflet + OSM + OSRM (y fallback local/remoto via `router-local.js`).

### 1.2 Modulos legacy identificados

AUTH / SESSION

- `js/login/login.js`
- `js/guard.js`
- `js/lib/custodia-session.js`
- estados en `sessionStorage` / `localStorage`

ADMIN

- `js/dashboard/dashboard-admin.js`
- `js/dashboard/admin-clientes-rutas.js`
- `js/dashboard/admin-custodias.js`
- `html/dashboard/dashboard-admin.html`
- `html/dashboard/admin-clientes-rutas.html`
- `html/dashboard/admin-custodias.html`

CUSTODIA

- `js/dashboard/dashboard-custodia.js`
- `js/dashboard/custodia-registros.js`
- `js/mapa.js`
- `html/dashboard/dashboard-custodia.html`
- `html/dashboard/custodia-registros.html`
- `html/dashboard/mapa-resguardo.html`

CONSULTA

- `js/dashboard/dashboard-consulta.js`
- `html/dashboard/dashboard-consulta.html`

ALARMAS / PUSH / CHECK-IN

- `modules/alarma/alarma.js`
- `modules/alarma/alarma.css`
- `service-worker.js`
- Netlify functions de alarmas/check-in

COMPARTIDOS

- `config.js`
- `js/lib/app-header.js`
- `js/lib/router-local.js`
- `js/lib/tracking-common.js`
- `js/lib/tracking-store.js`
- `js/lib/permissions.js`
- `js/pwa.js`

### 1.3 Flujo de navegacion (routing legacy)

Rutas principales:

- `/html/login/login.html`
- `/html/login/registro-custodia.html`
- `/html/dashboard/dashboard-admin.html`
- `/html/dashboard/admin-clientes-rutas.html`
- `/html/dashboard/admin-custodias.html`
- `/html/dashboard/dashboard-custodia.html`
- `/html/dashboard/custodia-registros.html`
- `/html/dashboard/mapa-resguardo.html`
- `/html/dashboard/dashboard-consulta.html`

Guard central:

- `js/guard.js` valida rol y servicio activo para `mapa-resguardo`.

### 1.4 Flujo de datos y base de datos

Tablas/vistas usadas en frontend + functions:

- `usuario`
- `custodia`
- `custodia_login`
- `cliente`
- `servicio`
- `servicio_custodio`
- `ubicacion`
- `ruta_cliente`
- `alarm_event`
- `push_subscription`
- `v_ultimo_ping_por_custodia`
- `v_servicio_ultimo_ping`

RPC usados:

- `registrar_ubicacion`
- `get_panic_alarm_events_from_jwt`
- `agregar_custodio` (script inline en `mapa-resguardo.html`)

Realtime channels detectados:

- `rt-servicio-admin`
- `rt-ubicacion-admin`
- `alarma-events`
- `svc-finish-${servicioId}`
- `ubicacion-svc-${servicioId}`
- canales dinamicos de marcadores/admin

### 1.5 Flujo de eventos

Eventos dominantes detectados:

- `click` (124)
- `input` (19)
- `DOMContentLoaded` (14)
- `keydown` (12)
- `change` (10)
- `beforeunload`, `visibilitychange`, `focus`, `submit`, etc.

Eventos de integracion critica:

- `realtime:down` (disparado en `config.js`)
- mensajes SW/UI por `postMessage` con `channel: "alarma"`
- `pushsubscriptionchange` y `notificationclick` en SW

### 1.6 Flujo de estado

Claves criticas de storage:

- `auth_role`
- `auth_empresa`
- `auth_usuario_id`
- `servicio_id_actual`
- `custodia_session`
- `custodia_profile`
- `custodia_is_logged`
- `router.osrmBase`
- `router.osrmLocalDown`
- `alarma.queue.v1`
- `alarma.flags.v1`
- `alarma.push.metadata`

## Fase 2 - Mapeo funcional completo

### AUTH SYSTEM

- Login por PIN para `ADMIN`, `CUSTODIA`, `CONSULTA`.
- Redireccion por rol (`guard.pathForRole`).
- Validacion de sesion activa y servicio activo en mapa.
- Persistencia de perfil custodia y sesion temporal.

### ADMIN DASHBOARD

- Lista de servicios activos/finalizados.
- Mapa global de custodias.
- Marcadores y detalles por servicio.
- Finalizacion de servicio.
- Deteccion de custodias sin reporte.
- Integracion con eventos de panico/check-in/ruta desviada.

### CUSTODIA SYSTEM

- Registro de servicio (cliente/placa/tipo/destino).
- Asociacion `servicio` + `servicio_custodio`.
- Captura selfie y validaciones de permisos.
- Navegacion al mapa operacional.
- Confirmacion periodica de check-in.

### TRACKING SYSTEM

- `watchPosition` y captura GPS.
- Persistencia de ubicaciones via RPC `registrar_ubicacion`.
- Visualizacion de destino + ruta OSRM.
- Tolerancia de desvio de ruta.
- Fallback realtime -> polling cuando aplica.

### ALARM SYSTEM

- Emision de eventos a `alarm_event`.
- Canal realtime `alarma-events`.
- Sirena, TTS, vibracion, modal panico.
- Recordatorio de check-in y reporte forzado.
- Envio de push y registro de suscripciones.

### MAP SYSTEM

- Leaflet en admin y custodia.
- Marcador custodia, destino y capas de ruta.
- Polilineas OSRM / fallback local.
- Vista de ruta de cliente en admin.

### Interacciones entre modulos

1. Login habilita sesion -> `guard` libera dashboard por rol.
2. Custodia crea servicio -> activa `servicio_id_actual` -> mapa inicia tracking.
3. Tracking escribe ubicacion -> admin refresca via realtime/polling.
4. Alarmas insertan `alarm_event` -> admin/custodia reaccionan UI+audio.
5. Scheduler/check-in functions disparan push + eventos.
6. Ruta desviada backend inserta evento -> admin y custodia muestran alerta.

## Fase 3 - Inventario de funciones

Inventario completo:

- `docs/legacy-audit/function-inventory-full.csv` (624 funciones)

Columnas:

- `archivo`
- `linea`
- `funcion`
- `responsabilidad` (clasificacion automatizada)
- `dependencias`
- `eventos_escucha`
- `eventos_dispara`
- `supabase_objetivos`
- `supabase_operaciones`
- `fetch_endpoints`

Muestras de funciones criticas:

- `js/mapa.js` -> `registrarUbicacionSeguro`  
  Responsabilidad: registrar tracking GPS.  
  Dependencias: `navigator.geolocation`, `window.sb`.  
  Supabase: `rpc:registrar_ubicacion`.

- `modules/alarma/alarma.js` -> `emit`  
  Responsabilidad: emitir evento operacional (panic/start/checkin/etc).  
  Dependencias: Supabase + cola offline + push endpoint.  
  Supabase: `from:alarm_event`.

- `js/dashboard/dashboard-admin.js` -> `setupRealtime`  
  Responsabilidad: suscribir cambios de `servicio` y `ubicacion`.  
  Supabase: `channel:rt-servicio-admin`, `channel:rt-ubicacion-admin`.

- `netlify/functions/ruta-desvio-handler.js` -> `handler`  
  Responsabilidad: detectar desvio y escribir `alarm_event(type=ruta_desviada)`.  
  Dependencias: `servicio`, `ruta_cliente`, `ubicacion`, `alarm_event`.

- `netlify/functions/checkin-scheduler.js` -> `runScheduler`  
  Responsabilidad: control 15m + reintentos + `checkin_missed`.  
  Dependencias: `servicio`, `alarm_event`, push broadcast.

## Fase 4 - Dependencias criticas y contratos no rompibles

### 4.1 No se deben romper

1. RPC:
   - `registrar_ubicacion`
   - `get_panic_alarm_events_from_jwt`
   - `agregar_custodio`
2. Tablas/vistas:
   - `servicio`, `servicio_custodio`, `ubicacion`
   - `alarm_event`, `push_subscription`
   - `cliente`, `ruta_cliente`
   - `usuario`, `custodia`, `custodia_login`
   - `v_ultimo_ping_por_custodia`, `v_servicio_ultimo_ping`
3. Netlify functions:
   - `push-send`, `push-broadcast`
   - `push-cron-checkin`, `checkin-scheduler`
   - `ruta-desvio-handler`, `ruta-ai-helper`
4. Storage/session contracts:
   - `auth_role`, `servicio_id_actual`, `custodia_session`, etc.
5. Eventos cross-layer:
   - `realtime:down`
   - mensajes SW (`channel: "alarma"`)

### 4.2 Flujos operativos criticos

1. Login -> guard -> dashboard por rol.
2. Alta servicio custodia -> mapa -> tracking continuo.
3. Tracking -> `registrar_ubicacion` -> visibilidad admin en tiempo real.
4. Check-in 15m -> recordatorio -> eventual `checkin_missed`.
5. Panico/ruta desviada -> `alarm_event` -> audio/push/admin action.

### 4.3 Riesgos tecnicos detectados

1. En `js/dashboard/dashboard-admin.js` las funciones `extractServicioIdFromEvent` y `applyLateReportRemote` estan fuera del closure principal y referencian estado/funciones internas, con riesgo de `ReferenceError` segun flujo de ejecucion.
2. Alta complejidad ciclomatica y acoplamiento en:
   - `modules/alarma/alarma.js` (2715 lineas)
   - `js/dashboard/dashboard-admin.js` (2562 lineas)
   - `js/mapa.js` (2064 lineas)
3. Dependencia fuerte de session/local storage y side effects DOM acoplados.

## Resultado

La auditoria completa y el mapa total del sistema legacy quedaron documentados y trazables con evidencia por archivo/linea en `docs/legacy-audit/*`.
