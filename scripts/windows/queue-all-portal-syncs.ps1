param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path,
  [ValidateSet("FullHistory", "CurrentMonth")][string]$Mode,
  [ValidateRange(1, 32)][int]$BatchSize = 6
)

$ErrorActionPreference = "Stop"
if (-not $Mode) { throw "Falta el modo: FullHistory o CurrentMonth." }
$secretPath = Join-Path $env:LOCALAPPDATA "AppCPE\portal-worker\supabase-secret.dpapi"

if (-not (Test-Path -LiteralPath $secretPath)) {
  throw "No existe la clave cifrada del worker."
}

$encryptedSecret = (Get-Content -LiteralPath $secretPath -Raw).Trim()
$secureSecret = ConvertTo-SecureString $encryptedSecret
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)

try {
  $env:CPE_SUPABASE_URL = "https://wvwdiywtlbffumshbboa.supabase.co"
  $env:CPE_SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  Set-Location -LiteralPath $RepositoryPath
  $modeArgument = if ($Mode -eq "FullHistory") { "--full-history" } else { "--current-month" }
  $modeLabel = if ($Mode -eq "FullHistory") { "CARGA COMPLETA ANUAL" } else { "ACTUALIZACION DEL MES ACTUAL" }
  Write-Host "App CPE - $modeLabel DE TODOS LOS USUARIOS" -ForegroundColor Cyan
  & node "scripts/queue-all-portal-syncs.js" $modeArgument
  if ($LASTEXITCODE -ne 0) { throw "No se pudieron crear los trabajos." }

  $batchScript = Join-Path $RepositoryPath "scripts\windows\run-cloudflare-gateway-batch.ps1"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $batchScript -RepositoryPath $RepositoryPath -BatchSize $BatchSize -Drain
  if ($LASTEXITCODE -ne 0) { throw "No se pudo procesar la cola." }
  Write-Host "$modeLabel finalizada en tandas de hasta $BatchSize." -ForegroundColor Green
}
finally {
  $env:CPE_SUPABASE_SECRET_KEY = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
}
