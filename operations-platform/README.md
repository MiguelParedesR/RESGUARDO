# Operations Platform (Parallel Modern Frontend)

Base moderna para migracion incremental del frontend legacy de seguridad logistica.

## Objetivo

- Ejecutar en paralelo al sistema actual (legacy HTML/CSS/JS).
- Reutilizar Supabase existente sin cambiar esquema ni RPC.
- Migrar por modulos y por feature flags, sin interrupcion operativa.

## Stack objetivo

- React 18 + Vite + TypeScript
- TailwindCSS + base para ShadCN UI
- Zustand + TanStack Query
- React Hook Form + Zod
- Framer Motion + GSAP
- React Leaflet
- Supabase + Realtime

## Estructura

```
operations-platform/
  apps/operations-app
  packages/{ui,maps,alerts,tracking,auth}
  services/supabase
  modules/{admin-dashboard,custodia-mobile,tracking,alarm-system}
```

## Ejecucion

1. `pnpm install`
2. `pnpm dev --filter operations-app`

Validado en esta maquina:

- `node v24.14.0`
- `npm 11.9.0`
- `pnpm 10.30.3`
- `pnpm typecheck` y `pnpm build` ejecutan correctamente.

Si PowerShell bloquea scripts (`ExecutionPolicy`), ejecutar con wrappers:

- `npm.cmd ...`
- `pnpm.cmd ...`

Runner interno disponible:

- `powershell -NoProfile -ExecutionPolicy Bypass -File tools/internal-runner.ps1 -Task doctor`
- `powershell -NoProfile -ExecutionPolicy Bypass -File tools/internal-runner.ps1 -Task audit`

## Contratos de no ruptura

- No eliminar legacy.
- No cambiar esquema Supabase.
- No modificar contratos de RPC existentes.
- No romper endpoints Netlify existentes.
