param(
  [ValidateRange(1, 6)][int]$BatchSize = 1,
  [ValidateRange(1024, 65535)][int]$Port = 9223,
  [ValidateRange(5, 120)][int]$WarmupSeconds = 20,
  [string]$RepositoryPath = ""
)

$ErrorActionPreference = "Stop"
if (-not $RepositoryPath) {
  $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
  $RepositoryPath = (Resolve-Path (Join-Path $scriptDirectory "..\.." )).Path
}

$secretPath = Join-Path $env:LOCALAPPDATA "AppCPE\portal-worker\supabase-secret.dpapi"
if (-not (Test-Path -LiteralPath $secretPath)) { throw "Falta la clave cifrada de Supabase." }

$gatewayScript = Join-Path $RepositoryPath "scripts\windows\start-cloudflare-gateway.ps1"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $gatewayScript -Port $Port
if ($LASTEXITCODE -ne 0) { throw "No se pudo abrir el Chrome gateway." }

Write-Host "Esperando $WarmupSeconds segundos para validar Cloudflare..." -ForegroundColor Yellow
Start-Sleep -Seconds $WarmupSeconds

$secureSecret = ConvertTo-SecureString (Get-Content -LiteralPath $secretPath -Raw).Trim()
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
try {
  $env:CPE_SUPABASE_URL = "https://wvwdiywtlbffumshbboa.supabase.co"
  $env:CPE_SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  $env:CPE_PORTAL_CDP_ENDPOINT = "http://127.0.0.1:$Port"
  $env:CPE_PORTAL_HEADLESS = "false"
  $env:CPE_PORTAL_BROWSER_CHANNEL = "chrome"
  $env:CPE_BOLSA_SCAN_BATCH_SIZE = [string]$BatchSize
  Set-Location -LiteralPath $RepositoryPath
  & node "scripts/bolsa-name-scan-worker.js" --queue-all
  exit $LASTEXITCODE
} finally {
  $env:CPE_SUPABASE_SECRET_KEY = $null
  $env:CPE_PORTAL_CDP_ENDPOINT = $null
  $env:CPE_PORTAL_HEADLESS = $null
  $env:CPE_PORTAL_BROWSER_CHANNEL = $null
  $env:CPE_BOLSA_SCAN_BATCH_SIZE = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
}
