param(
  [ValidateRange(1, 10)][int]$BatchSize = 10,
  [ValidateRange(1024, 65535)][int]$Port = 9223,
  [string]$RepositoryPath = ""
)

$ErrorActionPreference = "Stop"
if (-not $RepositoryPath) {
  $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
  $RepositoryPath = (Resolve-Path (Join-Path $scriptDirectory "..\.." )).Path
}
$secretPath = Join-Path $env:LOCALAPPDATA "AppCPE\portal-worker\supabase-secret.dpapi"
if (-not (Test-Path -LiteralPath $secretPath)) { throw "Falta la clave cifrada del worker." }

$endpoint = "http://127.0.0.1:$Port"
try { $null = Invoke-RestMethod -Uri "$endpoint/json/version" -TimeoutSec 3 }
catch { throw "El gateway Chrome no está abierto." }

$secureSecret = ConvertTo-SecureString (Get-Content -LiteralPath $secretPath -Raw).Trim()
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
try {
  $env:CPE_SUPABASE_URL = "https://wvwdiywtlbffumshbboa.supabase.co"
  $env:CPE_SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  $env:CPE_PORTAL_CDP_ENDPOINT = $endpoint
  $env:CPE_PORTAL_HEADLESS = "false"
  $env:CPE_PORTAL_WORKER_BATCH_SIZE = [string]$BatchSize
  $env:CPE_PORTAL_WORKER_ONCE = "true"
  Set-Location -LiteralPath $RepositoryPath
  & node "scripts/portal-sync-worker.js"
  exit $LASTEXITCODE
} finally {
  $env:CPE_SUPABASE_SECRET_KEY = $null
  $env:CPE_PORTAL_CDP_ENDPOINT = $null
  $env:CPE_PORTAL_HEADLESS = $null
  $env:CPE_PORTAL_WORKER_BATCH_SIZE = $null
  $env:CPE_PORTAL_WORKER_ONCE = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
}
