# Legacy Audit Artifacts

Carpeta con inventario tecnico line-by-line del sistema legacy.

## Archivos

- `functions.csv`: simbolos/funciones detectadas.
- `events.csv`: eventos DOM y custom events detectados.
- `supabase.csv`: llamadas Supabase detectadas (basico).
- `supabase-deep.csv`: llamadas Supabase con snippet multilinea.
- `supabase-inline-html.csv`: llamadas Supabase en scripts inline de HTML.
- `fetch.csv`: llamadas fetch detectadas.
- `navigation.csv`: rutas y redirecciones detectadas.
- `storage.csv`: uso de localStorage/sessionStorage.
- `css-links.csv`: relaciones HTML/CSS.
- `function-inventory-full.csv`: inventario funcional extendido (624 funciones).
- `summary.txt`: resumen cuantitativo de la auditoria.

## Regenerar inventario extendido

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/internal-runner.ps1 -Task audit
```
