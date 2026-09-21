param(
  [string]$RepositoryPath = "",
  [ValidateRange(1024, 65535)][int]$GatewayPort = 9223,
  [ValidateRange(1, 32)][int]$BatchSize = 12,
  [ValidateRange(5, 120)][int]$WarmupSeconds = 20
)

$ErrorActionPreference = "Stop"
if (-not $RepositoryPath) {
  $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
  $RepositoryPath = (Resolve-Path (Join-Path $scriptDirectory "..\.." )).Path
}

$batchScript = Join-Path $RepositoryPath "scripts\windows\run-cloudflare-gateway-batch.ps1"
if (-not (Test-Path -LiteralPath $batchScript)) { throw "No existe el procesador de trabajos pendientes." }

# El procesador de tandas prepara y valida el gateway una sola vez. Antes se
# hacía también aquí, lo que duplicaba la recarga y añadía una espera fija.
Write-Host "Preparando Chrome y procesando solamente los trabajos que ya estan en cola..." -ForegroundColor Yellow
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $batchScript `
  -RepositoryPath $RepositoryPath `
  -Port $GatewayPort `
  -BatchSize $BatchSize `
  -WarmupSeconds $WarmupSeconds `
  -Drain
if ($LASTEXITCODE -ne 0) { throw "No se pudieron procesar todos los trabajos pendientes." }

Write-Host "Trabajos pendientes procesados en tandas de hasta $BatchSize." -ForegroundColor Green
