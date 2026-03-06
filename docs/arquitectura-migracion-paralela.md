# Arquitectura Moderna y Plan de Migracion Paralela (Fases 5-6)

Fecha: 2026-03-06

## 1) Principios de diseno

1. Convivencia legacy + moderno sin downtime.
2. Sin cambios de esquema Supabase.
3. Sin romper RPC ni endpoints actuales.
4. Migracion por vertical slices (feature-by-feature).
5. Reutilizacion de contratos de datos existentes.
6. PWA orientada a custodia movil.

## 2) Stack objetivo

Frontend:

- React 18
- Vite
- TypeScript
- TailwindCSS + base para ShadCN UI
- Zustand
- TanStack Query
- React Hook Form + Zod
- Framer Motion + GSAP
- React Leaflet

Backend:

- Supabase existente
- Supabase Realtime existente
- Netlify functions existentes

## 3) Estructura propuesta (implementada como scaffold)

```
operations-platform/
  apps/
    operations-app/
  packages/
    ui/
    maps/
    alerts/
    tracking/
    auth/
  services/
    supabase/
  modules/
    admin-dashboard/
    custodia-mobile/
    tracking/
    alarm-system/
```

## 4) Responsabilidades por capa

`apps/operations-app`

- Shell de aplicacion.
- Bootstrap React.
- Providers globales (React Query).
- Orquestacion de modulos por rol.

`packages/ui`

- Componentes base (paneles, badges, primitives).
- Futuro punto de extension para componentes ShadCN.

`packages/maps`

- Abstracciones Leaflet/React-Leaflet.
- Capas de mapa reutilizables por admin/custodia.

`packages/alerts`

- Tipos de alertas y ordenamiento/prioridad.
- Contratos de semantica operacional.

`packages/tracking`

- Utilidades de geodesia/estado de ping.
- Reglas de negocio de tracking reusables.

`packages/auth`

- Parsing de sesion legacy y tipos de rol.

`services/supabase`

- Cliente unico Supabase.
- Punto de integracion para queries/realtime.

`modules/*`

- Modulos funcionales por dominio:
  - admin-dashboard
  - custodia-mobile
  - tracking
  - alarm-system

## 5) Arquitectura de estado y datos

Estado global (Zustand):

- rol activo
- modulo activo
- servicio seleccionado

Fetch/cache (TanStack Query):

- query keys por dominio (`servicios`, `ubicaciones`, `alarmas`).
- stale-time configurable y retry controlado.

Validacion (RHF + Zod):

- formularios de login/servicio/check-in en capas de feature.

Animaciones:

- Framer Motion para transiciones de UI.
- GSAP para entradas de panel y transiciones de mapa/pantalla.

## 6) Integracion de mapas y realtime

Mapas:

- `@ops/maps` encapsula React Leaflet.
- Mantener contrato de coordenadas `lat/lng` existente.

Realtime:

- Reusar canales actuales (`rt-servicio-admin`, `rt-ubicacion-admin`, `alarma-events`).
- Fallback a polling en escenarios de `realtime:down`.

## 7) Seguridad y roles

Roles soportados:

- `ADMIN`
- `CUSTODIA`

Estrategia:

- Guard de rutas/modulos en frontend moderno.
- Reuso de claims/sesion y contratos de legacy.
- Sin alterar RLS ni esquema actual.

## 8) PWA para custodia

Implementado en scaffold:

- `manifest.webmanifest`
- `sw.js`
- registro SW en `src/pwa/register-sw.ts`

Objetivo de evolucion:

- cache selectivo para vistas de custodia
- reintentos offline para acciones criticas (check-in / panico)
- UX de reconexion con cola local

## 9) Estrategia de migracion incremental (Strangler)

Fase A - Preparacion (completada en base)

1. Auditoria total legacy.
2. Scaffold moderno en carpeta paralela.
3. Definicion de contratos no rompibles.

Fase B - Integracion controlada

1. Habilitar login moderno con mismo Supabase.
2. Exponer dashboard admin moderno en ruta paralela (sin reemplazar legacy).
3. Reusar tablas y RPC existentes.

Fase C - Migracion por modulo

1. Admin dashboard (lectura + mapa global).
2. Tracking admin/custodia en vivo.
3. Alarmas + check-in.
4. Custodia mobile PWA.

Fase D - Convivencia y corte gradual

1. Feature flags por modulo.
2. Monitoreo dual (legacy vs moderno).
3. Apagado gradual de vistas legacy solo cuando exista equivalencia funcional.

## 10) Restricciones de compatibilidad (obligatorias)

1. No eliminar sistema legacy.
2. No cambiar esquema Supabase.
3. No romper RPC existentes.
4. No romper Netlify functions actuales.
5. No modificar contratos de storage/session sin capa de compatibilidad.

## 11) Entregables generados

1. Auditoria completa: `docs/auditoria-legacy.md`
2. Inventario line-by-line: `docs/legacy-audit/*`
3. Inventario funcional extendido: `docs/legacy-audit/function-inventory-full.csv`
4. Runner interno sin npm: `tools/internal-runner.ps1` + `docs/internal-runner.md`
5. Nueva app paralela scaffold: `operations-platform/`
