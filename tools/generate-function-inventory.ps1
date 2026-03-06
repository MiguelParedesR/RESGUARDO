param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$InputCsv = "docs/legacy-audit/functions.csv",
  [string]$OutputCsv = "docs/legacy-audit/function-inventory-full.csv"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-TextSlice {
  param(
    [string[]]$Lines,
    [int]$StartLine,
    [int]$EndLine
  )

  if (-not $Lines -or $Lines.Count -eq 0) { return "" }
  if ($StartLine -lt 1) { $StartLine = 1 }
  if ($EndLine -lt $StartLine) { $EndLine = $StartLine }
  if ($StartLine -gt $Lines.Count) { return "" }
  if ($EndLine -gt $Lines.Count) { $EndLine = $Lines.Count }

  $startIndex = $StartLine - 1
  $endIndex = $EndLine - 1
  if ($startIndex -eq $endIndex) {
    return [string]$Lines[$startIndex]
  }
  return ($Lines[$startIndex..$endIndex] -join "`n")
}

function Get-UniqueMatches {
  param(
    [string]$Text,
    [string]$Pattern,
    [int]$Group = 1
  )

  $list = New-Object System.Collections.Generic.List[string]
  if ([string]::IsNullOrWhiteSpace($Text)) { return @() }
  $matches = [regex]::Matches($Text, $Pattern, "IgnoreCase")
  foreach ($m in $matches) {
    if ($m.Groups.Count -le $Group) { continue }
    $rawValue = $m.Groups[$Group].Value
    if ($null -eq $rawValue) { $rawValue = "" }
    $value = ([string]$rawValue).Trim()
    if ([string]::IsNullOrWhiteSpace($value)) { continue }
    if (-not $list.Contains($value)) { $list.Add($value) }
  }
  return $list.ToArray()
}

function Get-Dependencies {
  param([string]$Text)

  $deps = New-Object System.Collections.Generic.List[string]
  $patterns = @(
    @{ name = "Supabase Client"; pattern = "(window\.sb|createClient\s*\(|@supabase/supabase-js)" }
    @{ name = "Supabase Query Builder"; pattern = "(\.from\s*\(|\.rpc\s*\(|\.channel\s*\()" }
    @{ name = "Fetch API"; pattern = "fetch\s*\(" }
    @{ name = "navigator.geolocation"; pattern = "navigator\.geolocation" }
    @{ name = "navigator.mediaDevices"; pattern = "navigator\.mediaDevices|getUserMedia\s*\(" }
    @{ name = "Notification API"; pattern = "Notification|showNotification|pushsubscriptionchange" }
    @{ name = "Service Worker API"; pattern = "serviceWorker|skipWaiting|clients\.matchAll" }
    @{ name = "Leaflet"; pattern = "(^|[^A-Za-z0-9_])L\.|leaflet" }
    @{ name = "Web Audio/Speech"; pattern = "AudioContext|speechSynthesis|SpeechRecognition|webkitSpeechRecognition" }
    @{ name = "Timers"; pattern = "setInterval|setTimeout" }
    @{ name = "localStorage"; pattern = "localStorage" }
    @{ name = "sessionStorage"; pattern = "sessionStorage" }
    @{ name = "window.Alarma"; pattern = "window\.Alarma|Alarma\." }
    @{ name = "routerLocal OSRM"; pattern = "routerLocal|OSRM|GraphHopper" }
    @{ name = "web-push"; pattern = "webpush|web-push" }
  )

  foreach ($item in $patterns) {
    if ($Text -match $item.pattern) {
      if (-not $deps.Contains($item.name)) { $deps.Add($item.name) }
    }
  }
  return ($deps | Sort-Object)
}

function Classify-Responsibility {
  param(
    [string]$FunctionName,
    [string]$Text
  )

  $safeFunctionName = if ($null -eq $FunctionName) { "" } else { [string]$FunctionName }
  $safeText = if ($null -eq $Text) { "" } else { [string]$Text }
  $hay = ("{0} {1}" -f $safeFunctionName, $safeText).ToLowerInvariant()
  if ($hay -match "\b(login|auth|session|guard|usuario|role|rol|pin)\b") { return "Autenticacion y sesion" }
  if ($hay -match "\b(panic|alarma|checkin|sirena|tts|extreme|reporte|alerta)\b") { return "Alarmas y check-in" }
  if ($hay -match "\b(map|marker|ruta|route|geo|ubicacion|tracking|leaflet|osrm)\b") { return "Mapa, ruta y tracking" }
  if ($hay -match "\b(render|show|open|close|modal|sidebar|toast|ui|dialog)\b") { return "UI y experiencia de usuario" }
  if ($hay -match "\b(insert|update|delete|create|save|fetch|load|query|supabase|rpc|from)\b") { return "Persistencia y consultas de datos" }
  return "Utilidad y control de flujo"
}

function Get-SupabaseTargets {
  param([string]$Text)
  $targets = New-Object System.Collections.Generic.List[string]

  foreach ($t in (Get-UniqueMatches -Text $Text -Pattern '\.from\(\s*["'']([^"'']+)["'']\s*\)')) {
    $entry = "from:$t"
    if (-not $targets.Contains($entry)) { $targets.Add($entry) }
  }
  foreach ($t in (Get-UniqueMatches -Text $Text -Pattern '\.rpc\(\s*["'']([^"'']+)["'']')) {
    $entry = "rpc:$t"
    if (-not $targets.Contains($entry)) { $targets.Add($entry) }
  }
  foreach ($t in (Get-UniqueMatches -Text $Text -Pattern '\.channel\(\s*["'']([^"'']+)["'']')) {
    $entry = "channel:$t"
    if (-not $targets.Contains($entry)) { $targets.Add($entry) }
  }

  return ($targets | Sort-Object)
}

function Get-SupabaseOperations {
  param([string]$Text)
  $ops = New-Object System.Collections.Generic.List[string]
  $patterns = @("select", "insert", "update", "delete", "upsert", "eq", "in", "order", "maybeSingle", "single")
  foreach ($p in $patterns) {
    if ($Text -match ("\." + [regex]::Escape($p) + "\s*\(")) {
      if (-not $ops.Contains($p)) { $ops.Add($p) }
    }
  }
  return ($ops | Sort-Object)
}

function Get-FetchTargets {
  param([string]$Text)
  $targets = New-Object System.Collections.Generic.List[string]
  foreach ($t in (Get-UniqueMatches -Text $Text -Pattern 'fetch\(\s*["'']([^"'']+)["'']')) {
    if (-not $targets.Contains($t)) { $targets.Add($t) }
  }
  if (($Text -match 'fetch\(\s*`') -and (-not $targets.Contains("<template-string>"))) {
    $targets.Add("<template-string>")
  }
  if (($Text -match "fetch\(\s*[a-zA-Z_]") -and (-not $targets.Contains("<variable-url>"))) {
    $targets.Add("<variable-url>")
  }
  return ($targets | Sort-Object)
}

$inputPath = Join-Path $RepoRoot $InputCsv
if (-not (Test-Path $inputPath)) {
  throw "No se encontro el inventario base en $inputPath"
}

$rows = Import-Csv $inputPath | Where-Object { $_.kind -eq "function" -and $_.file -and $_.symbol }
if (-not $rows -or $rows.Count -eq 0) {
  throw "No hay funciones en $inputPath"
}

$inventory = New-Object System.Collections.Generic.List[object]

$groups = $rows | Group-Object file
foreach ($group in $groups) {
  $relativeFile = ($group.Name -replace "/", "\")
  $fullPath = Join-Path $RepoRoot $relativeFile
  if (-not (Test-Path $fullPath)) { continue }

  $lines = Get-Content -Path $fullPath
  if (-not $lines) { continue }

  $sorted = @($group.Group | Sort-Object { [int]$_.line })
  for ($i = 0; $i -lt $sorted.Count; $i++) {
    $current = $sorted[$i]
    $start = [int]$current.line
    $end = $lines.Count
    if ($i -lt ($sorted.Count - 1)) {
      $nextLine = [int]$sorted[$i + 1].line
      $end = [Math]::Max($start, $nextLine - 1)
    }

    $chunk = Get-TextSlice -Lines $lines -StartLine $start -EndLine $end
    $eventsListen = Get-UniqueMatches -Text $chunk -Pattern 'addEventListener\(\s*["'']([^"'']+)["'']'
    $eventsDispatch = @()
    $eventsDispatch += Get-UniqueMatches -Text $chunk -Pattern 'dispatchEvent\(\s*new\s+CustomEvent\(\s*["'']([^"'']+)["'']'
    $eventsDispatch += Get-UniqueMatches -Text $chunk -Pattern 'dispatchEvent\(\s*new\s+Event\(\s*["'']([^"'']+)["'']'
    $eventsDispatch = $eventsDispatch | Sort-Object -Unique

    $supabaseTargets = Get-SupabaseTargets -Text $chunk
    $supabaseOps = Get-SupabaseOperations -Text $chunk
    $fetchTargets = Get-FetchTargets -Text $chunk
    $deps = Get-Dependencies -Text $chunk
    $responsabilidad = Classify-Responsibility -FunctionName $current.symbol -Text $chunk

    $inventory.Add([pscustomobject]@{
        archivo               = $relativeFile
        linea                 = $start
        funcion               = $current.symbol
        responsabilidad       = $responsabilidad
        dependencias          = ($deps -join "; ")
        eventos_escucha       = ($eventsListen -join "; ")
        eventos_dispara       = ($eventsDispatch -join "; ")
        supabase_objetivos    = ($supabaseTargets -join "; ")
        supabase_operaciones  = ($supabaseOps -join "; ")
        fetch_endpoints       = ($fetchTargets -join "; ")
      })
  }
}

$outputPath = Join-Path $RepoRoot $OutputCsv
$outputDir = Split-Path -Parent $outputPath
if (-not (Test-Path $outputDir)) {
  New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}

$inventory |
  Sort-Object archivo, linea |
  Export-Csv -NoTypeInformation -Encoding UTF8 -Path $outputPath

$total = $inventory.Count
Write-Output "Inventario generado: $OutputCsv ($total funciones)."
