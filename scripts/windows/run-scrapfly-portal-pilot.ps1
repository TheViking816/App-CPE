param(
  [string]$RepositoryPath = "",
  [ValidatePattern('^\d{5}$')][string]$TargetChapa = "72683"
)

$ErrorActionPreference = "Stop"
if (-not $RepositoryPath) {
  $RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path
}
$workerSecretPath = Join-Path $env:LOCALAPPDATA "AppCPE\portal-worker\supabase-secret.dpapi"
$scrapflyEndpointPath = Join-Path $env:LOCALAPPDATA "AppCPE\scrapfly\cloud-browser-endpoint.dpapi"

if (-not (Test-Path -LiteralPath $workerSecretPath)) { throw "Falta la clave cifrada de Supabase." }
if (-not (Test-Path -LiteralPath $scrapflyEndpointPath)) { throw "Falta la conexion cifrada de Scrapfly." }

$workerSecure = ConvertTo-SecureString (Get-Content -LiteralPath $workerSecretPath -Raw).Trim()
$scrapflySecure = ConvertTo-SecureString (Get-Content -LiteralPath $scrapflyEndpointPath -Raw).Trim()
$workerPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($workerSecure)
$scrapflyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($scrapflySecure)

try {
  $env:CPE_SUPABASE_URL = "https://wvwdiywtlbffumshbboa.supabase.co"
  $env:CPE_SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($workerPointer)
  $env:CPE_PORTAL_CDP_ENDPOINT = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($scrapflyPointer)
  $env:CPE_PORTAL_BROWSER_PROVIDER = "scrapfly"
  $env:CPE_PORTAL_WORKER_BATCH_SIZE = "1"
  $env:CPE_PORTAL_WORKER_DRAIN = "true"
  $env:CPE_PORTAL_WORKER_ONCE = "false"
  $env:CPE_PORTAL_REFRESH_LATEST_PAYROLL = "true"

  Set-Location -LiteralPath $RepositoryPath
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts/windows/requeue-cloudflare-lab-job.ps1" -Chapa $TargetChapa -RepositoryPath $RepositoryPath
  if ($LASTEXITCODE -ne 0) { throw "No se pudo preparar la chapa del piloto." }

  & node "scripts/portal-sync-worker.js"
  if ($LASTEXITCODE -ne 0) { throw "El piloto de Scrapfly termino con errores." }
}
finally {
  $env:CPE_SUPABASE_SECRET_KEY = $null
  $env:CPE_PORTAL_CDP_ENDPOINT = $null
  $env:CPE_PORTAL_BROWSER_PROVIDER = $null
  $env:CPE_PORTAL_WORKER_BATCH_SIZE = $null
  $env:CPE_PORTAL_WORKER_DRAIN = $null
  $env:CPE_PORTAL_WORKER_ONCE = $null
  $env:CPE_PORTAL_REFRESH_LATEST_PAYROLL = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($workerPointer)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($scrapflyPointer)
}
