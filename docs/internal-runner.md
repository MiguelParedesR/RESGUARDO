# Internal Runner (sin npm)

Se agrego una extension interna en PowerShell para ejecutar auditoria y soporte local sin depender de `npm`.

## Archivo

- `tools/internal-runner.ps1`

## Comandos

### 1) Diagnostico de runtime

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/internal-runner.ps1 -Task doctor
```

Salida esperada: disponibilidad de `npm`, `node`, `python`, `rg`.

### 2) Inventario funcional completo

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/internal-runner.ps1 -Task inventory
```

Genera:

- `docs/legacy-audit/function-inventory-full.csv`

### 3) Auditoria resumida

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/internal-runner.ps1 -Task audit
```

Genera:

- `docs/legacy-audit/function-inventory-full.csv`
- `docs/legacy-audit/summary.txt`

### 4) Servidor local legacy (sin npm)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/internal-runner.ps1 -Task serve-legacy -Port 8090
```

Abre `http://localhost:8090/` usando `HttpListener`.

## Notas

- Si la ejecucion de scripts esta bloqueada por politica local, usar `-ExecutionPolicy Bypass` como en los ejemplos.
- El runner no modifica el sistema legacy, solo genera artefactos de auditoria y herramientas de soporte.
