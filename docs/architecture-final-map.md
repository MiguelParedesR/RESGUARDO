# Architecture Final Map

Arquitectura objetivo para coexistencia legacy + moderna sin interrupcion.

## 1) Mapa por capas

```
CAPA DE APLICACION
  apps/operations-app
    - shell React
    - routing de modulos
    - providers globales (Query, tema, estado)

CAPA DE LOGICA DE NEGOCIO
  modules/admin-dashboard
  modules/custodia-mobile
  modules/tracking
  modules/alarm-system
    - componentes por feature
    - hooks de orquestacion
    - stores de dominio

CAPA DE LIBRERIAS REUSABLES
  packages/ui
  packages/maps
  packages/alerts
  packages/tracking
  packages/auth
    - primitives UI
    - utilidades y modelos compartidos

CAPA DE SERVICIOS
  services/supabase
  services/realtime (nuevo)
  services/notifications (nuevo)
    - acceso a datos
    - realtime channels
    - push bridge / scheduler integration

CAPA DE DATOS
  SUPABASE
    - PostgreSQL
    - RPC
    - Realtime
    - Storage

SISTEMA LEGACY (EN PARALELO)
  html/css/js + netlify/functions actuales
```

## 2) Distribucion de responsabilidades

## apps/operations-app

- Punto de entrada unico de la experiencia moderna.
- Control de modulo activo por rol (`ADMIN` / `CUSTODIA`).
- Integracion con estado global y data-fetching.

## modules/*

- `admin-dashboard`: estado de servicios, monitoreo y control operativo.
- `custodia-mobile`: flujo movil de servicio, selfie, tracking y check-in.
- `tracking`: pipeline de ubicaciones y estado de pings.
- `alarm-system`: panico/check-in/alertas + integracion push.

## packages/*

- `ui`: componentes base, layout, paneles, badges.
- `maps`: Leaflet/React-Leaflet, rutas, markers, capas.
- `alerts`: modelos de alerta, prioridad y normalizacion.
- `tracking`: utilidades de geodesia y reglas de ping.
- `auth`: parsing de sesion legacy y contratos de rol.

## services/*

- `supabase`: repositorio de queries y mutaciones por dominio.
- `realtime`: suscripciones y fallback polling.
- `notifications`: push payloads y bridge con SW/functions.

## 3) Flujo operacional final esperado

1. Usuario autentica (moderno o legacy) con mismos contratos de sesion.
2. App moderna consume datos del mismo Supabase.
3. Realtime y alarmas mantienen contratos de `alarm_event`, `ubicacion`, `servicio`.
4. Push y scheduler siguen usando Netlify Functions existentes.
5. Modulos modernos reemplazan vistas legacy en rollout gradual por feature flag.

## 4) Compatibilidad con legacy

Reglas obligatorias mantenidas:

1. No eliminar legacy.
2. No modificar esquema Supabase.
3. No romper RPC existentes.
4. No romper endpoints Netlify existentes.
5. Mantener storage keys y contratos de sesion durante la transicion.

## 5) Capacidad de escalado

Escalabilidad garantizada por:

- Separacion estricta por capas.
- Feature-based modules.
- Servicios desacoplados de UI.
- Estado local por dominio (Zustand).
- Fetch/cache declarativo (TanStack Query).
- Reutilizacion cross-app por `packages/*`.

## 6) Artefactos de control arquitectonico

- `docs/migration-plan.md`
- `docs/module-migration-map.md`
- `docs/react-component-mapping.md`
- `docs/migration-function-map.csv`
- `docs/auditoria-legacy.md`
