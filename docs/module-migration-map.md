# Module Migration Map

Fuente principal de mapeo: `docs/migration-function-map.csv` (624 funciones).

## 1) Agrupacion funcional legacy -> modulo moderno

## ADMIN DASHBOARD

Alcance funcional:

- visualizacion de servicios
- monitoreo de custodias
- estado de ping
- acciones de administrador

Legacy principal:

- `js/dashboard/dashboard-admin.js`
- `js/dashboard/admin-custodias.js`
- `js/dashboard/dashboard-consulta.js`
- parte de `js/login/login.js`, `js/guard.js`, `js/lib/app-header.js`

Nuevas ubicaciones:

- `operations-platform/modules/admin-dashboard`
- `operations-platform/services/supabase/src/admin`
- `operations-platform/packages/ui`

Datos/Supabase:

- `servicio`
- `servicio_custodio`
- `v_ultimo_ping_por_custodia`
- `v_servicio_ultimo_ping`
- `cliente`

## MAP SYSTEM

Alcance funcional:

- renderizado de mapas
- marcadores
- rutas OSRM
- edicion de rutas cliente

Legacy principal:

- `js/dashboard/admin-clientes-rutas.js`
- `js/lib/router-local.js`
- `js/lib/tracking-common.js`
- secciones de mapa en `js/mapa.js`
- `netlify/functions/ruta-ai-helper.js`

Nuevas ubicaciones:

- `operations-platform/packages/maps`
- `operations-platform/services/supabase/src/maps`

Datos/Supabase:

- `ruta_cliente`
- `cliente`
- `servicio`

## TRACKING SYSTEM

Alcance funcional:

- geolocalizacion
- envio de coordenadas
- monitoreo de pings
- realtime + fallback polling

Legacy principal:

- `js/mapa.js` (tracking)
- `js/lib/tracking-store.js`
- `js/lib/router-local.js` (partes de resiliencia)

Nuevas ubicaciones:

- `operations-platform/modules/tracking`
- `operations-platform/packages/tracking`
- `operations-platform/services/supabase/src/tracking`

Datos/Supabase:

- `ubicacion`
- `servicio`
- RPC `registrar_ubicacion`

## ALARM SYSTEM

Alcance funcional:

- ping periodico
- confirmacion de custodia
- alertas admin
- panico
- push + bridge SW

Legacy principal:

- `modules/alarma/alarma.js`
- `service-worker.js`
- `netlify/functions/push-send.js`
- `netlify/functions/push-broadcast.js`
- `netlify/functions/push-cron-checkin.js`
- `netlify/functions/checkin-scheduler.js`
- `netlify/functions/ruta-desvio-handler.js`

Nuevas ubicaciones:

- `operations-platform/modules/alarm-system`
- `operations-platform/packages/alerts`
- `operations-platform/services/supabase/src/alarm`

Datos/Supabase:

- `alarm_event`
- `push_subscription`
- `servicio`

## CUSTODIA MOBILE

Alcance funcional:

- registro de servicio
- captura selfie
- activacion GPS
- mapa-resguardo
- confirmacion de reporte/check-in

Legacy principal:

- `js/dashboard/dashboard-custodia.js`
- `js/dashboard/custodia-registros.js`
- `js/registro-custodia.js`
- `js/mapa.js` (UI custodia)
- `js/lib/camera.js`
- `js/lib/selfie-icon.js`
- `js/lib/permissions.js`
- `js/lib/custodia-session.js`
- `js/login/login.js` (flujo custodia)

Nuevas ubicaciones:

- `operations-platform/modules/custodia-mobile`
- `operations-platform/services/supabase/src/custodia`
- `operations-platform/packages/auth`

Datos/Supabase:

- `custodia`
- `custodia_login`
- `servicio`
- `servicio_custodio`
- `cliente`

## 2) Dependencias criticas por modulo

Tabla de contratos no rompibles:

| Tipo | Contrato | Modulos impactados |
|---|---|---|
| RPC | `registrar_ubicacion` | TRACKING SYSTEM, CUSTODIA MOBILE |
| RPC | `get_panic_alarm_events_from_jwt` | ALARM SYSTEM |
| RPC | `agregar_custodio` | CUSTODIA MOBILE |
| Tabla | `alarm_event` | ALARM SYSTEM, ADMIN DASHBOARD |
| Tabla | `push_subscription` | ALARM SYSTEM |
| Tabla | `servicio` | ADMIN DASHBOARD, CUSTODIA MOBILE, TRACKING SYSTEM |
| Tabla | `servicio_custodio` | ADMIN DASHBOARD, CUSTODIA MOBILE |
| Tabla | `ubicacion` | TRACKING SYSTEM, ADMIN DASHBOARD |
| Tabla | `ruta_cliente` | MAP SYSTEM, ADMIN DASHBOARD |
| Vista | `v_ultimo_ping_por_custodia` | ADMIN DASHBOARD |
| Vista | `v_servicio_ultimo_ping` | ADMIN DASHBOARD, CUSTODIA MOBILE |

## 3) Eventos y acoplamientos relevantes

DOM events de mayor impacto:

- `click`
- `input`
- `keydown`
- `change`
- `submit`

Custom/system events criticos:

- `realtime:down`
- `channel: "alarma"` (SW <-> UI)
- `pushsubscriptionchange`
- `notificationclick`

## 4) Evidencia de cobertura total

Archivo de mapeo completo por funcion:

- `docs/migration-function-map.csv`

Columnas incluidas por cada funcion legacy:

- archivo original
- linea
- funcion
- responsabilidad legacy
- dependencias
- eventos DOM
- eventos custom
- objetivos/operaciones Supabase
- modulo destino
- tipo de migracion
- nueva ubicacion
- relacion con otros modulos
