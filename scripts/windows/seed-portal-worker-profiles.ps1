param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path,
  [ValidateRange(1, 32)][int]$BatchSize = 10
)

$ErrorActionPreference = "Stop"
$repositoryRoot = [IO.Path]::GetFullPath($RepositoryPath)
$shared = [IO.Path]::GetFullPath((Join-Path $repositoryRoot "data\portal-oficial-chrome-profile\shared"))
$profileRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot "data\portal-oficial-chrome-profile\workers"))

foreach ($path in @($shared, $profileRoot)) {
  if (-not $path.StartsWith($repositoryRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Ruta de perfiles fuera del repositorio: $path"
  }
}

$portalChrome = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq "chrome.exe" -and $_.CommandLine -like "*portal-oficial-chrome-profile*"
})
if ($portalChrome.Count -gt 0) {
  throw "Cierra primero todas las ventanas de Chrome del portal."
}
if (-not (Test-Path -LiteralPath (Join-Path $shared "Local State")) -or
    -not (Test-Path -LiteralPath (Join-Path $shared "Default\Network"))) {
  throw "Falta una sesion compartida valida de Cloudflare."
}

$items = @("Network", "Preferences", "Secure Preferences", "Local Storage", "Session Storage", "Service Worker", "IndexedDB", "WebStorage")
New-Item -ItemType Directory -Path $profileRoot -Force | Out-Null

foreach ($slot in 1..$BatchSize) {
  $target = Join-Path $profileRoot "worker-$slot"
  if (Test-Path -LiteralPath $target) {
    throw "Ya existe $target; no se sobrescribe."
  }
  $targetDefault = Join-Path $target "Default"
  New-Item -ItemType Directory -Path $targetDefault -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $shared "Local State") -Destination (Join-Path $target "Local State") -Force
  foreach ($item in $items) {
    $source = Join-Path (Join-Path $shared "Default") $item
    if (Test-Path -LiteralPath $source) {
      Copy-Item -LiteralPath $source -Destination (Join-Path $targetDefault $item) -Recurse -Force
    }
  }
}

Write-Host "Creados $BatchSize perfiles aislados en $profileRoot"
