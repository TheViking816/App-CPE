param(
  [string]$RepositoryPath = "",
  [ValidateRange(1024, 65535)][int]$GatewayPort = 9223,
  [ValidateRange(1, 32)][int]$BatchSize = 10,
  [ValidateRange(5, 120)][int]$WarmupSeconds = 45
)

$ErrorActionPreference = "Stop"
if (-not $RepositoryPath) {
  $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
  $RepositoryPath = (Resolve-Path (Join-Path $scriptDirectory "..\.." )).Path
}

$gatewayScript = Join-Path $RepositoryPath "scripts\windows\start-cloudflare-gateway.ps1"
$batchScript = Join-Path $RepositoryPath "scripts\windows\run-cloudflare-gateway-batch.ps1"
if (-not (Test-Path -LiteralPath $gatewayScript)) { throw "No existe el iniciador del Chrome gateway." }
if (-not (Test-Path -LiteralPath $batchScript)) { throw "No existe el procesador de trabajos pendientes." }

Write-Host "1/2 Abriendo y recargando Chrome para renovar Cloudflare..." -ForegroundColor Yellow
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $gatewayScript -Port $GatewayPort
if ($LASTEXITCODE -ne 0) { throw "No se pudo preparar el Chrome gateway." }

Write-Host "Esperando $WarmupSeconds segundos antes de leer la cola..." -ForegroundColor Yellow
Start-Sleep -Seconds $WarmupSeconds

Write-Host "2/2 Procesando solamente los trabajos que ya estan en cola..." -ForegroundColor Yellow
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $batchScript `
  -RepositoryPath $RepositoryPath `
  -Port $GatewayPort `
  -BatchSize $BatchSize `
  -Drain
if ($LASTEXITCODE -ne 0) { throw "No se pudieron procesar todos los trabajos pendientes." }

Write-Host "Trabajos pendientes procesados en tandas de hasta $BatchSize." -ForegroundColor Green
