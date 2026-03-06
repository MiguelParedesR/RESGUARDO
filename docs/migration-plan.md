# Migration Plan (Legacy -> operations-platform)

Fecha de corte del plan: 2026-03-06  
Fuente de verdad usada:

- `docs/auditoria-legacy.md`
- `docs/legacy-audit/function-inventory-full.csv`
- `docs/arquitectura-migracion-paralela.md`
- `docs/migration-function-map.csv` (mapeo función por función generado en esta fase)

## Paso 0 - Preparacion de entorno local (ejecutado)

Estado real en esta maquina:

- `node -v` -> `v24.14.0`
- `npm.cmd -v` -> `11.9.0`
- `pnpm` instalado -> `10.30.3` (invocado como `pnpm.cmd`)

Instalacion aplicada:

1. `winget install OpenJS.NodeJS.LTS --scope user --silent --accept-package-agreements --accept-source-agreements`
2. `npm.cmd install -g pnpm`

Validaciones:

1. `pnpm install` en `operations-platform` -> OK
2. `pnpm typecheck` -> OK
3. `pnpm build` -> OK

Nota operativa PowerShell:

- Por `ExecutionPolicy`, usar `npm.cmd` / `pnpm.cmd` en vez de `npm` / `pnpm`.

## Inventario migrable consolidado

Total funciones mapeadas: **624**

- CUSTODIA MOBILE: 184
- ALARM SYSTEM: 155
- ADMIN DASHBOARD: 146
- MAP SYSTEM: 97
- TRACKING SYSTEM: 42

Tipo de migracion asignado:

- Utility Function: 221
- React Component: 154
- Service Layer: 101
- React Hook: 98
- Zustand Store: 50

## Fase 1 - Auth y sesion compatible

Objetivo: migrar autenticacion sin romper rutas legacy.

Legacy involucrado:

- `js/login/login.js`
- `js/guard.js`
- `js/lib/custodia-session.js`
- `js/lib/app-header.js`
- `config.js`

Nuevo destino:

- `packages/auth`
- `services/supabase/src/admin/*` y `services/supabase/src/custodia/*`
- `apps/operations-app/src/app/store/*` (estado sesion/rol)

Artefactos esperados:

- React components: login shell y selector de rol.
- Hooks: session guard + route guard.
- Store Zustand: `auth/session`.
- Servicios: `validate-pin`, `load-role`, `restore-session`.

No ruptura:

- Mantener claves de storage existentes (`auth_role`, `auth_empresa`, `servicio_id_actual`, `custodia_session`).
- Mantener consultas a `usuario`, `custodia`, `custodia_login`.

## Fase 2 - Admin dashboard

Objetivo: reemplazar visualizacion admin en paralelo.

Legacy involucrado:

- `js/dashboard/dashboard-admin.js`
- `js/dashboard/admin-custodias.js`
- `js/dashboard/dashboard-consulta.js`
- `html/dashboard/dashboard-admin.html`
- `html/dashboard/admin-custodias.html`

Nuevo destino:

- `modules/admin-dashboard`
- `packages/ui`
- `services/supabase/src/admin/*`

Artefactos esperados:

- React components: service list, cards, filters, paneles.
- Hooks: filtros, refresh, realtime fallback polling.
- Store Zustand: `admin-dashboard-store`.
- Servicios: consultas `servicio`, `servicio_custodio`, vistas de ping.

No ruptura:

- Mantener lectura de `v_ultimo_ping_por_custodia` y `v_servicio_ultimo_ping`.
- Mantener flujo de finalizacion de servicio.

## Fase 3 - Map system

Objetivo: extraer y unificar mapas/rutas en paquete reusable.

Legacy involucrado:

- `js/dashboard/admin-clientes-rutas.js`
- `js/lib/router-local.js`
- `js/lib/tracking-common.js`
- secciones mapa de `js/mapa.js`

Nuevo destino:

- `packages/maps`
- `services/supabase/src/maps/*`

Artefactos esperados:

- React components: `MapCanvas`, `RouteLayer`, `MarkersLayer`.
- Hooks: OSRM resolver + fallback local/remoto.
- Store Zustand: `map-store`.
- Utilities: normalizacion GeoJSON, distancias, hash de ruta.

No ruptura:

- Mantener `ruta_cliente` y tolerancias.
- Mantener integracion OSRM existente.

## Fase 4 - Tracking system

Objetivo: migrar tracking GPS + ingest y estado de pings.

Legacy involucrado:

- `js/mapa.js` (tracking core)
- `js/lib/tracking-store.js`
- funciones de tracking en admin/custodia

Nuevo destino:

- `modules/tracking`
- `packages/tracking`
- `services/supabase/src/tracking/*`

Artefactos esperados:

- Hooks: geolocation watcher, send/flush pings, realtime subscription.
- Store Zustand: `tracking-store`.
- Servicios: `registrar-ubicacion.service.ts` y lecturas `ubicacion`.

No ruptura:

- Mantener RPC `registrar_ubicacion`.
- Mantener canal realtime de ubicaciones y fallback polling.

## Fase 5 - Alarm system

Objetivo: migrar alarmas sin romper panico/check-in.

Legacy involucrado:

- `modules/alarma/alarma.js`
- `service-worker.js`
- `netlify/functions/push-send.js`
- `netlify/functions/push-broadcast.js`
- `netlify/functions/push-cron-checkin.js`
- `netlify/functions/checkin-scheduler.js`
- `netlify/functions/ruta-desvio-handler.js`

Nuevo destino:

- `modules/alarm-system`
- `packages/alerts`
- `services/supabase/src/alarm/*`
- `services/realtime` y `services/notifications` (nuevos)

Artefactos esperados:

- React components: panic modal, check-in prompt, alert timeline.
- Hooks: subscribe alarm channel, sirena/audio, push bridge.
- Store Zustand: `alarm-store`.
- Services: `alarm-event`, `push-subscription`, ack/update metadata.

No ruptura:

- Mantener tabla `alarm_event`, `push_subscription`.
- Mantener contracts de Netlify Functions.

## Fase 6 - Custodia mobile completa (PWA)

Objetivo: migrar flujo extremo de custodia end-to-end.

Legacy involucrado:

- `js/dashboard/dashboard-custodia.js`
- `js/dashboard/custodia-registros.js`
- `js/registro-custodia.js`
- `js/mapa.js` (UI custodia)
- `js/lib/camera.js`
- `js/lib/selfie-icon.js`
- `js/lib/permissions.js`

Nuevo destino:

- `modules/custodia-mobile`
- `packages/ui`, `packages/maps`, `packages/auth`
- `services/supabase/src/custodia/*`

Artefactos esperados:

- React components: registro servicio, captura selfie, mapa-resguardo, check-in.
- Hooks: permisos (geo/mic/cam), captura selfie, estado de servicio activo.
- Store Zustand: `custodia-store`.
- Services: `servicio`, `servicio_custodio`, `custodia`, `custodia_login`.

No ruptura:

- Mantener campos y validaciones de registro actuales.
- Mantener navegación operacional sin downtime.

## Estrategia de despliegue paralelo

1. Mantener legacy en rutas actuales (`/html/...`).
2. Publicar moderno en rutas separadas (`/ops/...`) o subapp.
3. Activar por feature-flag por modulo.
4. Monitorear equivalencia funcional (legacy vs moderno).
5. Retirar vistas legacy solo cuando exista paridad validada.

## Gate de salida por fase

Cada fase cierra solo si cumple:

1. Sin cambios de esquema Supabase.
2. Sin rotura de RPC existentes.
3. Sin rotura de Netlify functions existentes.
4. Flujo operativo validado con usuarios reales (admin/custodia).
5. Telemetria de errores <= baseline legacy.
