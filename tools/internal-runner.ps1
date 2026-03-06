param(
  [ValidateSet("doctor", "inventory", "audit", "serve-legacy")]
  [string]$Task = "doctor",
  [int]$Port = 8090
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Test-Tool {
  param([string]$Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  return [bool]$cmd
}

function Invoke-Doctor {
  $report = [ordered]@{
    powershell = $PSVersionTable.PSVersion.ToString()
    npm        = Test-Tool "npm"
    node       = Test-Tool "node"
    python     = Test-Tool "python"
    rg         = Test-Tool "rg"
  }
  $report.GetEnumerator() | ForEach-Object { "{0}={1}" -f $_.Key, $_.Value }
}

function Invoke-Inventory {
  & (Join-Path $PSScriptRoot "generate-function-inventory.ps1") `
    -RepoRoot $RepoRoot `
    -InputCsv "docs/legacy-audit/functions.csv" `
    -OutputCsv "docs/legacy-audit/function-inventory-full.csv"
}

function Invoke-Audit {
  Invoke-Inventory

  $summaryPath = Join-Path $RepoRoot "docs/legacy-audit/summary.txt"
  $functions = (Import-Csv (Join-Path $RepoRoot "docs/legacy-audit/functions.csv")).Count
  $events = (Import-Csv (Join-Path $RepoRoot "docs/legacy-audit/events.csv")).Count
  $supabase = (Import-Csv (Join-Path $RepoRoot "docs/legacy-audit/supabase-deep.csv")).Count
  $fetch = (Import-Csv (Join-Path $RepoRoot "docs/legacy-audit/fetch.csv")).Count
  $inventory = (Import-Csv (Join-Path $RepoRoot "docs/legacy-audit/function-inventory-full.csv")).Count

  @(
    "legacy_audit_summary"
    "generated_at=$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK')"
    "functions_csv_rows=$functions"
    "events_csv_rows=$events"
    "supabase_csv_rows=$supabase"
    "fetch_csv_rows=$fetch"
    "function_inventory_rows=$inventory"
  ) | Set-Content -Encoding UTF8 $summaryPath

  Write-Output "Resumen generado: docs/legacy-audit/summary.txt"
}

function Get-ContentType {
  param([string]$Path)
  switch -Regex ($Path.ToLowerInvariant()) {
    "\.html$" { "text/html; charset=utf-8"; break }
    "\.css$" { "text/css; charset=utf-8"; break }
    "\.js$" { "application/javascript; charset=utf-8"; break }
    "\.json$" { "application/json; charset=utf-8"; break }
    "\.svg$" { "image/svg+xml"; break }
    "\.png$" { "image/png"; break }
    "\.jpg$|\.jpeg$" { "image/jpeg"; break }
    "\.ico$" { "image/x-icon"; break }
    default { "application/octet-stream" }
  }
}

function Invoke-ServeLegacy {
  Add-Type -AssemblyName System.Net.HttpListener
  $listener = New-Object System.Net.HttpListener
  $prefix = "http://localhost:$Port/"
  $listener.Prefixes.Add($prefix)
  $listener.Start()
  Write-Output "Servidor legacy activo en $prefix (Ctrl+C para detener)"

  try {
    while ($listener.IsListening) {
      $ctx = $listener.GetContext()
      $req = $ctx.Request
      $res = $ctx.Response

      $path = $req.Url.AbsolutePath
      if ([string]::IsNullOrWhiteSpace($path) -or $path -eq "/") {
        $path = "/html/index.html"
      }
      $relative = $path.TrimStart("/").Replace("/", "\")
      $full = Join-Path $RepoRoot $relative

      if (-not (Test-Path $full)) {
        $res.StatusCode = 404
        $bytes404 = [Text.Encoding]::UTF8.GetBytes("Not Found")
        $res.OutputStream.Write($bytes404, 0, $bytes404.Length)
        $res.Close()
        continue
      }

      $bytes = [IO.File]::ReadAllBytes($full)
      $res.ContentType = Get-ContentType -Path $full
      $res.ContentLength64 = $bytes.Length
      $res.StatusCode = 200
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.Close()
    }
  } finally {
    $listener.Stop()
    $listener.Close()
  }
}

switch ($Task) {
  "doctor" { Invoke-Doctor; break }
  "inventory" { Invoke-Inventory; break }
  "audit" { Invoke-Audit; break }
  "serve-legacy" { Invoke-ServeLegacy; break }
  default { throw "Task no soportada: $Task" }
}
