param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$InputCsv = "docs/legacy-audit/function-inventory-full.csv",
  [string]$OutputCsv = "docs/migration-function-map.csv"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Safe-String {
  param([object]$Value)
  if ($null -eq $Value) { return "" }
  return [string]$Value
}

function To-KebabCase {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return "legacy-fn" }
  $v = [regex]::Replace($Value, "([a-z0-9])([A-Z])", '$1-$2')
  $v = [regex]::Replace($v, "[^a-zA-Z0-9]+", "-")
  $v = $v.Trim("-").ToLowerInvariant()
  if ([string]::IsNullOrWhiteSpace($v)) { return "legacy-fn" }
  return $v
}

function Contains-Any {
  param(
    [string]$Text,
    [string[]]$Keywords
  )
  $safe = (Safe-String $Text).ToLowerInvariant()
  foreach ($k in $Keywords) {
    if ($safe.Contains($k.ToLowerInvariant())) { return $true }
  }
  return $false
}

function Resolve-Module {
  param($Row)
  $f = (Safe-String $Row.archivo).ToLowerInvariant()
  $fn = (Safe-String $Row.funcion).ToLowerInvariant()
  $resp = (Safe-String $Row.responsabilidad).ToLowerInvariant()
  $sup = (Safe-String $Row.supabase_objetivos).ToLowerInvariant()
  $fetch = (Safe-String $Row.fetch_endpoints).ToLowerInvariant()

  if ($f -match "netlify\\functions\\ruta-ai-helper") { return "MAP SYSTEM" }
  if ($f -match "modules\\alarma|service-worker|netlify\\functions\\push-|netlify\\functions\\checkin-scheduler|netlify\\functions\\ruta-desvio-handler") {
    return "ALARM SYSTEM"
  }
  if ($f -match "js\\mapa\.js|js\\lib\\router-local|js\\lib\\tracking-common|js\\dashboard\\admin-clientes-rutas") {
    if (Contains-Any "$fn $resp $sup $fetch" @("tracking", "ubicacion", "geolocation", "registrar_ubicacion", "ping")) {
      return "TRACKING SYSTEM"
    }
    return "MAP SYSTEM"
  }
  if ($f -match "js\\dashboard\\dashboard-admin|js\\dashboard\\admin-custodias|js\\dashboard\\dashboard-consulta|js\\lib\\tracking-store") {
    return "ADMIN DASHBOARD"
  }
  if ($f -match "js\\dashboard\\dashboard-custodia|js\\dashboard\\custodia-registros|js\\registro-custodia|js\\lib\\camera|js\\lib\\selfie-icon|js\\lib\\custodia-session|js\\lib\\permissions") {
    return "CUSTODIA MOBILE"
  }
  if ($f -match "js\\login\\login|js\\guard|js\\lib\\app-header|config\.js") {
    if (Contains-Any "$fn $resp" @("custodia", "pin", "session", "login")) { return "CUSTODIA MOBILE" }
    return "ADMIN DASHBOARD"
  }

  if (Contains-Any "$sup $resp $fn $fetch" @("alarm_event", "push_subscription", "panic", "checkin")) { return "ALARM SYSTEM" }
  if (Contains-Any "$sup $resp $fn $fetch" @("ubicacion", "registrar_ubicacion", "tracking")) { return "TRACKING SYSTEM" }
  if (Contains-Any "$sup $resp $fn $fetch" @("ruta_cliente", "osrm", "leaflet", "route", "map")) { return "MAP SYSTEM" }
  if (Contains-Any "$sup $resp $fn" @("servicio", "servicio_custodio", "cliente")) { return "ADMIN DASHBOARD" }

  return "CUSTODIA MOBILE"
}

function Resolve-MigrationType {
  param($Row, [string]$Module)
  $f = (Safe-String $Row.archivo).ToLowerInvariant()
  $fn = (Safe-String $Row.funcion).ToLowerInvariant()
  $resp = (Safe-String $Row.responsabilidad).ToLowerInvariant()
  $sup = Safe-String $Row.supabase_objetivos
  $fetch = Safe-String $Row.fetch_endpoints
  $events = Safe-String $Row.eventos_escucha
  $deps = (Safe-String $Row.dependencias).ToLowerInvariant()
  $looksLikeUiAction = Contains-Any "$fn $resp" @("render", "open", "close", "show")
  $looksLikeIoAction = Contains-Any "$fn" @("load", "fetch", "save", "create", "update", "delete", "insert", "query", "send", "rpc")
  $looksLikeStore = Contains-Any "$fn $resp $deps" @("store", "state", "session", "cache", "persist", "flags")
  $looksLikeHook = Contains-Any "$fn $resp" @("init", "setup", "subscribe", "watch", "poll", "monitor", "onpos", "handle")
  $looksLikeComponent = Contains-Any "$fn $resp" @("render", "open", "close", "show", "modal", "panel", "sidebar", "drawer", "form", "button", "card", "list", "map")

  if ($f -match "netlify\\functions|service-worker|config\.js") { return "Service Layer" }
  if (-not [string]::IsNullOrWhiteSpace($sup) -or -not [string]::IsNullOrWhiteSpace($fetch)) {
    if ($looksLikeUiAction -and -not $looksLikeIoAction) {
      return "React Component"
    }
    return "Service Layer"
  }
  if ($looksLikeStore) {
    return "Zustand Store"
  }
  if (-not [string]::IsNullOrWhiteSpace($events) -or $looksLikeHook) {
    return "React Hook"
  }
  if ($looksLikeComponent) {
    return "React Component"
  }
  return "Utility Function"
}

function Resolve-TargetPath {
  param(
    [string]$Module,
    [string]$MigrationType,
    [string]$FunctionName
  )

  $name = To-KebabCase $FunctionName
  $moduleSlug = switch ($Module) {
    "ADMIN DASHBOARD" { "admin" }
    "MAP SYSTEM" { "maps" }
    "TRACKING SYSTEM" { "tracking" }
    "ALARM SYSTEM" { "alarm" }
    default { "custodia" }
  }

  if ($MigrationType -eq "React Component") {
    switch ($Module) {
      "ADMIN DASHBOARD" { return "operations-platform/modules/admin-dashboard/src/components/$name.tsx" }
      "MAP SYSTEM" { return "operations-platform/packages/maps/src/components/$name.tsx" }
      "TRACKING SYSTEM" { return "operations-platform/modules/tracking/src/components/$name.tsx" }
      "ALARM SYSTEM" { return "operations-platform/modules/alarm-system/src/components/$name.tsx" }
      default { return "operations-platform/modules/custodia-mobile/src/components/$name.tsx" }
    }
  }

  if ($MigrationType -eq "React Hook") {
    switch ($Module) {
      "ADMIN DASHBOARD" { return "operations-platform/modules/admin-dashboard/src/hooks/use-$name.ts" }
      "MAP SYSTEM" { return "operations-platform/packages/maps/src/hooks/use-$name.ts" }
      "TRACKING SYSTEM" { return "operations-platform/modules/tracking/src/hooks/use-$name.ts" }
      "ALARM SYSTEM" { return "operations-platform/modules/alarm-system/src/hooks/use-$name.ts" }
      default { return "operations-platform/modules/custodia-mobile/src/hooks/use-$name.ts" }
    }
  }

  if ($MigrationType -eq "Zustand Store") {
    switch ($Module) {
      "ADMIN DASHBOARD" { return "operations-platform/modules/admin-dashboard/src/stores/use-admin-store.ts" }
      "MAP SYSTEM" { return "operations-platform/packages/maps/src/stores/use-map-store.ts" }
      "TRACKING SYSTEM" { return "operations-platform/modules/tracking/src/stores/use-tracking-store.ts" }
      "ALARM SYSTEM" { return "operations-platform/modules/alarm-system/src/stores/use-alarm-store.ts" }
      default { return "operations-platform/modules/custodia-mobile/src/stores/use-custodia-store.ts" }
    }
  }

  if ($MigrationType -eq "Service Layer") {
    return "operations-platform/services/supabase/src/$moduleSlug/$name.service.ts"
  }

  if (Contains-Any $FunctionName @("auth", "login", "pin", "session", "role", "guard")) {
    return "operations-platform/packages/auth/src/utils/$name.ts"
  }
  switch ($Module) {
    "MAP SYSTEM" { return "operations-platform/packages/maps/src/utils/$name.ts" }
    "TRACKING SYSTEM" { return "operations-platform/packages/tracking/src/utils/$name.ts" }
    "ALARM SYSTEM" { return "operations-platform/packages/alerts/src/utils/$name.ts" }
    default { return "operations-platform/packages/ui/src/utils/$name.ts" }
  }
}

function Resolve-RelatedModules {
  param($Row, [string]$PrimaryModule)
  $links = New-Object System.Collections.Generic.List[string]
  $text = (
    (Safe-String $Row.archivo) + " " +
    (Safe-String $Row.supabase_objetivos) + " " +
    (Safe-String $Row.fetch_endpoints) + " " +
    (Safe-String $Row.funcion) + " " +
    (Safe-String $Row.responsabilidad)
  ).ToLowerInvariant()

  if (Contains-Any $text @("alarm_event", "push_subscription", "panic", "checkin", "alarma")) { $links.Add("ALARM SYSTEM") }
  if (Contains-Any $text @("ubicacion", "registrar_ubicacion", "tracking", "ping")) { $links.Add("TRACKING SYSTEM") }
  if (Contains-Any $text @("ruta_cliente", "osrm", "leaflet", "map", "route")) { $links.Add("MAP SYSTEM") }
  if (Contains-Any $text @("servicio", "servicio_custodio", "dashboard-admin", "admin")) { $links.Add("ADMIN DASHBOARD") }
  if (Contains-Any $text @("custodia", "registro-custodia", "dashboard-custodia", "login", "selfie")) { $links.Add("CUSTODIA MOBILE") }

  if (-not $links.Contains($PrimaryModule)) { $links.Add($PrimaryModule) }
  return ($links | Sort-Object -Unique) -join "; "
}

function Filter-DomEvents {
  param([string]$EventList)
  if ([string]::IsNullOrWhiteSpace($EventList)) { return "" }
  $dom = @()
  foreach ($evt in ($EventList -split ";")) {
    $e = $evt.Trim()
    if ([string]::IsNullOrWhiteSpace($e)) { continue }
    if ($e -match "realtime:|notification|push|custom|sw-message") { continue }
    $dom += $e
  }
  return ($dom | Sort-Object -Unique) -join "; "
}

function Filter-CustomEvents {
  param([string]$Dispatched)
  if ([string]::IsNullOrWhiteSpace($Dispatched)) { return "" }
  return (($Dispatched -split ";" | ForEach-Object { $_.Trim() } | Where-Object { $_ }) | Sort-Object -Unique) -join "; "
}

$inputPath = Join-Path $RepoRoot $InputCsv
if (-not (Test-Path $inputPath)) {
  throw "No se encontro inventario base en $inputPath"
}

$rows = Import-Csv $inputPath
$mapped = New-Object System.Collections.Generic.List[object]

foreach ($row in $rows) {
  $module = Resolve-Module -Row $row
  $type = Resolve-MigrationType -Row $row -Module $module
  $target = Resolve-TargetPath -Module $module -MigrationType $type -FunctionName $row.funcion
  $related = Resolve-RelatedModules -Row $row -PrimaryModule $module

  $mapped.Add([pscustomobject]@{
      archivo_original      = $row.archivo
      linea                 = $row.linea
      funcion               = $row.funcion
      responsabilidad_legacy = $row.responsabilidad
      modulo_destino        = $module
      tipo_migracion        = $type
      nueva_ubicacion       = $target
      dependencias          = $row.dependencias
      eventos_dom           = (Filter-DomEvents -EventList (Safe-String $row.eventos_escucha))
      eventos_custom        = (Filter-CustomEvents -Dispatched (Safe-String $row.eventos_dispara))
      supabase_objetivos    = $row.supabase_objetivos
      supabase_operaciones  = $row.supabase_operaciones
      relacion_modulos      = $related
    })
}

$outputPath = Join-Path $RepoRoot $OutputCsv
$outDir = Split-Path -Parent $outputPath
if (-not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

$mapped |
  Sort-Object modulo_destino, archivo_original, {[int]$_.linea} |
  Export-Csv -NoTypeInformation -Encoding UTF8 -Path $outputPath

Write-Output "Migration map generado: $OutputCsv ($($mapped.Count) funciones)"
