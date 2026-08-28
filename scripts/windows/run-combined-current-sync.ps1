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
$supabasePreflightScript = Join-Path $RepositoryPath "scripts\windows\wait-for-supabase-worker.ps1"
if (-not (Test-Path -LiteralPath $operationalScript)) { throw "No existe el worker de Chapero y Puertas." }
if (-not (Test-Path -LiteralPath $portalScript)) { throw "No existe el worker del mes actual." }
if (-not (Test-Path -LiteralPath $supabasePreflightScript)) { throw "No existe la comprobacion previa de Supabase." }

Write-Host "App CPE - ACTUALIZACION COMPLETA DEL MES ACTUAL" -ForegroundColor Cyan
Write-Host "0/2 Comprobando que Supabase acepta el worker..." -ForegroundColor Yellow
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $supabasePreflightScript -RepositoryPath $RepositoryPath
if ($LASTEXITCODE -ne 0) { throw "Supabase no estuvo disponible para el worker." }
Write-Host "1/2 Actualizando Puertas y Chapero (el Tablon se omite en este paso)..." -ForegroundColor Yellow
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $operationalScript -RepositoryPath $RepositoryPath -SkipGeneralBoard
$operationalExitCode = $LASTEXITCODE
if ($operationalExitCode -ne 0) {
  Write-Warning "Fallo Puertas o Chapero. Se continua con los perfiles para no bloquear la actualizacion del mes."
}

Write-Host "2/2 Actualizando el mes actual de todos y el Tablon General una sola vez..." -ForegroundColor Yellow
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $portalScript -RepositoryPath $RepositoryPath -Mode CurrentMonth
$portalExitCode = $LASTEXITCODE
if ($portalExitCode -ne 0) { throw "Fallo la actualizacion del mes actual." }

if ($operationalExitCode -ne 0) {
  throw "Los perfiles y el Tablon se actualizaron, pero fallo Puertas o Chapero. Revisa el log operativo."
}

Write-Host "Actualizacion completa finalizada: Puertas, Chapero, mes actual y Tablon General." -ForegroundColor Green
