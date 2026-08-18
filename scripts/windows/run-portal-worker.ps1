param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path,
  [ValidateRange(1, 32)][int]$BatchSize = 10,
  [string]$ProfileRoot = "",
  [ValidateRange(1024, 65535)][int]$GatewayPort = 9223
)

$ErrorActionPreference = "Stop"
$workerStateDir = Join-Path $env:LOCALAPPDATA "AppCPE\portal-worker"
$secretPath = Join-Path $workerStateDir "supabase-secret.dpapi"
$logDir = Join-Path $workerStateDir "logs"
$gatewayScript = Join-Path $RepositoryPath "scripts\windows\start-cloudflare-gateway.ps1"

if (-not (Test-Path -LiteralPath $secretPath)) {
  throw "No existe la clave cifrada del worker. Ejecuta install-portal-worker.ps1."
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
if (-not (Test-Path -LiteralPath $gatewayScript)) {
  throw "No existe el iniciador del Chrome gateway."
}
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $gatewayScript -Port $GatewayPort
if ($LASTEXITCODE -ne 0) { throw "No se pudo preparar el Chrome gateway." }

$encryptedSecret = (Get-Content -LiteralPath $secretPath -Raw).Trim()
$secureSecret = ConvertTo-SecureString $encryptedSecret
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)

try {
  $env:CPE_SUPABASE_URL = "https://wvwdiywtlbffumshbboa.supabase.co"
  $env:CPE_SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  $env:CPE_PORTAL_BROWSER_CHANNEL = "chrome"
  $env:CPE_PORTAL_HEADLESS = "false"
  $env:CPE_PORTAL_WORKER_POLL_MS = "2500"
  $env:CPE_PORTAL_WORKER_BATCH_SIZE = [string]$BatchSize
  $env:CPE_PORTAL_WORKER_PROFILE_ROOT = $ProfileRoot
  $env:CPE_PORTAL_CDP_ENDPOINT = "http://127.0.0.1:$GatewayPort"

  Set-Location -LiteralPath $RepositoryPath
  $logPath = Join-Path $logDir ("worker-{0}.log" -f (Get-Date -Format "yyyy-MM-dd-HHmmss"))
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & node "scripts/portal-sync-worker.js" 2>&1 | Out-File -LiteralPath $logPath -Append -Encoding utf8
  $workerExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction
  exit $workerExitCode
}
finally {
  $env:CPE_SUPABASE_SECRET_KEY = $null
  $env:CPE_PORTAL_WORKER_BATCH_SIZE = $null
  $env:CPE_PORTAL_WORKER_PROFILE_ROOT = $null
  $env:CPE_PORTAL_CDP_ENDPOINT = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
}
