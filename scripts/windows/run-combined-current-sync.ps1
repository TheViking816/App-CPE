param(
  [string]$RepositoryPath = ""
)

$ErrorActionPreference = "Stop"
if (-not $RepositoryPath) {
  $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
  $RepositoryPath = (Resolve-Path (Join-Path $scriptDirectory "..\.." )).Path
}

$operationalScript = Join-Path $RepositoryPath "scripts\windows\run-operational-sync.ps1"
$portalScript = Join-Path $RepositoryPath "scripts\windows\queue-all-portal-syncs.ps1"
if (-not (Test-Path -LiteralPath $operationalScript)) { throw "No existe el worker de Chapero y Puertas." }
if (-not (Test-Path -LiteralPath $portalScript)) { throw "No existe el worker del mes actual." }

Write-Host "App CPE - ACTUALIZACION COMPLETA DEL MES ACTUAL" -ForegroundColor Cyan
Write-Host "1/2 Actualizando Puertas y Chapero (el Tablon se omite en este paso)..." -ForegroundColor Yellow
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $operationalScript -RepositoryPath $RepositoryPath -SkipGeneralBoard
if ($LASTEXITCODE -ne 0) { throw "Fallo la actualizacion de Puertas o Chapero." }

Write-Host "2/2 Actualizando el mes actual de todos y el Tablon General una sola vez..." -ForegroundColor Yellow
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $portalScript -RepositoryPath $RepositoryPath -Mode CurrentMonth
if ($LASTEXITCODE -ne 0) { throw "Fallo la actualizacion del mes actual." }

Write-Host "Actualizacion completa finalizada: Puertas, Chapero, mes actual y Tablon General." -ForegroundColor Green
