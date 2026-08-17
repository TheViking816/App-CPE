param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path
)

$ErrorActionPreference = "Stop"
$workerStateDir = Join-Path $env:LOCALAPPDATA "AppCPE\portal-worker"
$secretPath = Join-Path $workerStateDir "supabase-secret.dpapi"
$logDir = Join-Path $workerStateDir "logs"

if (-not (Test-Path -LiteralPath $secretPath)) {
  throw "No existe la clave cifrada del worker. Ejecuta install-portal-worker.ps1."
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$secureSecret = ConvertTo-SecureString (Get-Content -LiteralPath $secretPath -Raw)
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)

try {
  $env:CPE_SUPABASE_URL = "https://wvwdiywtlbffumshbboa.supabase.co"
  $env:CPE_SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  $env:CPE_PORTAL_BROWSER_CHANNEL = "chrome"
  $env:CPE_PORTAL_HEADLESS = "false"
  $env:CPE_PORTAL_WORKER_POLL_MS = "2500"

  Set-Location -LiteralPath $RepositoryPath
  $logPath = Join-Path $logDir ("worker-{0}.log" -f (Get-Date -Format "yyyy-MM-dd"))
  & node "scripts/portal-sync-worker.js" *>> $logPath
  exit $LASTEXITCODE
}
finally {
  $env:CPE_SUPABASE_SECRET_KEY = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
}
