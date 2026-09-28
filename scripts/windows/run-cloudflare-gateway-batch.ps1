param(
  [ValidateRange(1, 32)][int]$BatchSize = 5,
  [ValidateRange(1024, 65535)][int]$Port = 9223,
  [ValidateRange(5, 120)][int]$WarmupSeconds = 20,
  [ValidateRange(0, 10)][int]$MaxCloudflareRestarts = 3,
  [string]$RepositoryPath = "",
  [switch]$Drain
)

$ErrorActionPreference = "Stop"
if (-not $RepositoryPath) {
  $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
  $RepositoryPath = (Resolve-Path (Join-Path $scriptDirectory "..\.." )).Path
}
$secretPath = Join-Path $env:LOCALAPPDATA "AppCPE\portal-worker\supabase-secret.dpapi"
if (-not (Test-Path -LiteralPath $secretPath)) { throw "Falta la clave cifrada del worker." }

$endpoint = "http://127.0.0.1:$Port"
$gatewayScript = Join-Path $RepositoryPath "scripts\windows\start-cloudflare-gateway.ps1"
$clearanceCheckScript = Join-Path $RepositoryPath "scripts\cloudflare-clearance-pool-check.js"
if (-not (Test-Path -LiteralPath $gatewayScript)) { throw "No existe el iniciador del Chrome gateway." }
if (-not (Test-Path -LiteralPath $clearanceCheckScript)) { throw "No existe la comprobacion de Cloudflare." }

# Hay que preparar el gateway incluso si el puerto ya estaba abierto: una
# sesion de Chrome viva puede conservar una autorizacion de Cloudflare caducada.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $gatewayScript -Port $Port
$gatewayExitCode = $LASTEXITCODE
$clearanceExitCode = 3
if ($gatewayExitCode -eq 0) {
  Write-Host "Chrome gateway abierto y recargado. Esperando $WarmupSeconds segundos para completar Cloudflare..." -ForegroundColor Yellow
  Start-Sleep -Seconds $WarmupSeconds
}

$previousCdpEndpoint = $env:CPE_PORTAL_CDP_ENDPOINT
$previousPoolSize = $env:CPE_CLOUDFLARE_POOL_SIZE
if ($gatewayExitCode -eq 0) {
  try {
    $env:CPE_PORTAL_CDP_ENDPOINT = $endpoint
    $env:CPE_CLOUDFLARE_POOL_SIZE = "1"
    Set-Location -LiteralPath $RepositoryPath
    & node $clearanceCheckScript
    $clearanceExitCode = $LASTEXITCODE
  } finally {
    $env:CPE_PORTAL_CDP_ENDPOINT = $previousCdpEndpoint
    $env:CPE_CLOUDFLARE_POOL_SIZE = $previousPoolSize
  }
}
if ($clearanceExitCode -ne 0) {
  Write-Host "Cloudflare sigue pendiente antes de comenzar. Se reiniciara Chrome antes de leer la cola." -ForegroundColor Yellow
} else {
  Write-Host "Cloudflare validado. Iniciando la tanda de usuarios." -ForegroundColor Green
}

$secureSecret = ConvertTo-SecureString (Get-Content -LiteralPath $secretPath -Raw).Trim()
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
try {
  $env:CPE_SUPABASE_URL = "https://wvwdiywtlbffumshbboa.supabase.co"
  $env:CPE_SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  $env:CPE_PORTAL_CDP_ENDPOINT = $endpoint
  $env:CPE_PORTAL_HEADLESS = "false"
  # Reuse the same installed Chrome fingerprint as the visible gateway.
  # A cf_clearance cookie copied from Chrome can be rejected by bundled Chromium.
  $env:CPE_PORTAL_BROWSER_CHANNEL = "chrome"
  $env:CPE_PORTAL_WORKER_BATCH_SIZE = [string]$BatchSize
  if ($Drain) { $env:CPE_PORTAL_WORKER_DRAIN = "true" }
  else { $env:CPE_PORTAL_WORKER_ONCE = "true" }
  Set-Location -LiteralPath $RepositoryPath
  for ($restart = 0; $restart -le $MaxCloudflareRestarts; $restart++) {
    if ($restart -eq 0 -and $clearanceExitCode -ne 0) { continue }
    if ($restart -gt 0) {
      Write-Host "Cloudflare interrumpio la tanda. Reiniciando Chrome y Ejecutar pendientes ($restart/$MaxCloudflareRestarts)..." -ForegroundColor Yellow
      Start-Sleep -Seconds 5
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $gatewayScript -Port $Port
      if ($LASTEXITCODE -ne 0) {
        if ($restart -eq $MaxCloudflareRestarts) { throw "Chrome no pudo renovarse; los trabajos siguen pendientes." }
        continue
      }
      Start-Sleep -Seconds $WarmupSeconds
      & node $clearanceCheckScript
      if ($LASTEXITCODE -ne 0) {
        if ($restart -eq $MaxCloudflareRestarts) { throw "Cloudflare sigue pidiendo verificacion; los trabajos siguen pendientes." }
        continue
      }
    }

    & node "scripts/portal-sync-worker.js"
    $workerExitCode = $LASTEXITCODE
    if ($workerExitCode -eq 0) { exit 0 }
    if ($workerExitCode -ne 75) { exit $workerExitCode }
  }
  throw "Cloudflare ha interrumpido la ejecucion repetidamente; los trabajos restantes siguen en cola."
} finally {
  $env:CPE_SUPABASE_SECRET_KEY = $null
  $env:CPE_PORTAL_CDP_ENDPOINT = $null
  $env:CPE_PORTAL_HEADLESS = $null
  $env:CPE_PORTAL_BROWSER_CHANNEL = $null
  $env:CPE_PORTAL_WORKER_BATCH_SIZE = $null
  $env:CPE_PORTAL_WORKER_ONCE = $null
  $env:CPE_PORTAL_WORKER_DRAIN = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
}
