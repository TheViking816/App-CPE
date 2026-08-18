param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path,
  [ValidateRange(1024, 65535)][int]$GatewayPort = 9223
)

$ErrorActionPreference = "Stop"
$workerStateDir = Join-Path $env:LOCALAPPDATA "AppCPE\portal-worker"
$secretPath = Join-Path $workerStateDir "supabase-secret.dpapi"
$logDir = Join-Path $workerStateDir "logs"
$gatewayScript = Join-Path $RepositoryPath "scripts\windows\start-cloudflare-gateway.ps1"
if (-not (Test-Path -LiteralPath $secretPath)) { throw "No existe la clave cifrada del worker." }

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
& powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $gatewayScript -Port $GatewayPort
if ($LASTEXITCODE -ne 0) { throw "No se pudo preparar el Chrome gateway." }

$secureSecret = ConvertTo-SecureString (Get-Content -LiteralPath $secretPath -Raw).Trim()
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
try {
  $env:CPE_SUPABASE_URL = "https://wvwdiywtlbffumshbboa.supabase.co"
  $env:CPE_SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  $env:CPE_PORTAL_CDP_ENDPOINT = "http://127.0.0.1:$GatewayPort"
  Set-Location -LiteralPath $RepositoryPath
  $logPath = Join-Path $logDir ("operativo-{0}.log" -f (Get-Date -Format "yyyy-MM-dd-HHmmss"))

  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & node "scripts/sync-puertas.js" 2>&1 | Out-File -LiteralPath $logPath -Append -Encoding utf8
  $puertasExitCode = $LASTEXITCODE
  & node "scripts/sync-chapero.js" 2>&1 | Out-File -LiteralPath $logPath -Append -Encoding utf8
  $chaperoExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction
  if ($puertasExitCode -ne 0 -or $chaperoExitCode -ne 0) {
    throw "La actualizacion operativa fallo: puertas=$puertasExitCode, chapero=$chaperoExitCode."
  }
}
finally {
  $env:CPE_SUPABASE_SECRET_KEY = $null
  $env:CPE_PORTAL_CDP_ENDPOINT = $null
  if ($secretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
}
