param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path,
  [ValidateRange(1, 32)][int]$BatchSize = 10,
  [string]$ProfileRoot = ""
)

$ErrorActionPreference = "Stop"
$workerStateDir = Join-Path $env:LOCALAPPDATA "AppCPE\portal-worker"
$secretPath = Join-Path $workerStateDir "supabase-secret.dpapi"
$logDir = Join-Path $workerStateDir "logs"

if (-not (Test-Path -LiteralPath $secretPath)) {
  throw "No existe la clave cifrada del worker. Ejecuta install-portal-worker.ps1."
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
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
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
}
