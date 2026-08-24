param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path,
  [ValidateRange(1024, 65535)][int]$GatewayPort = 9223,
  [ValidateRange(1, 5)][int]$OperationalAttempts = 3,
  [ValidateRange(0, 60)][int]$RetryDelaySeconds = 15,
  [switch]$SkipGeneralBoard
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
  if (-not $SkipGeneralBoard) {
    $env:CPE_GENERAL_BOARD_CDP_ENDPOINT = "http://127.0.0.1:$GatewayPort"
  }
  Set-Location -LiteralPath $RepositoryPath
  $logPath = Join-Path $logDir ("operativo-{0}.log" -f (Get-Date -Format "yyyy-MM-dd-HHmmss"))

  function Invoke-OperationalReader {
    param(
      [Parameter(Mandatory = $true)][string]$ScriptPath,
      [Parameter(Mandatory = $true)][string]$Label
    )

    for ($attempt = 1; $attempt -le $OperationalAttempts; $attempt++) {
      "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Label intento $attempt/$OperationalAttempts" |
        Out-File -LiteralPath $logPath -Append -Encoding utf8

      $readerOutput = @(& node $ScriptPath 2>&1)
      $readerExitCode = $LASTEXITCODE
      $readerOutput | Out-File -LiteralPath $logPath -Append -Encoding utf8

      if ($readerExitCode -eq 0) { return 0 }

      $readerText = $readerOutput -join "`n"
      $isForbidden = $readerText -match "HTTP\s+403"
      if (-not $isForbidden -or $attempt -ge $OperationalAttempts) { return $readerExitCode }

      "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Label recibio HTTP 403; renovando la autorizacion de Cloudflare antes de reintentar." |
        Out-File -LiteralPath $logPath -Append -Encoding utf8

      $gatewayOutput = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $gatewayScript -Port $GatewayPort 2>&1)
      $gatewayExitCode = $LASTEXITCODE
      $gatewayOutput | Out-File -LiteralPath $logPath -Append -Encoding utf8
      if ($gatewayExitCode -ne 0) { return $gatewayExitCode }
      if ($RetryDelaySeconds -gt 0) { Start-Sleep -Seconds $RetryDelaySeconds }
    }

    return 1
  }

  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $puertasExitCode = Invoke-OperationalReader -ScriptPath "scripts/sync-puertas.js" -Label "Puertas"
  $chaperoExitCode = Invoke-OperationalReader -ScriptPath "scripts/sync-chapero.js" -Label "Chapero"
  $generalBoardExitCode = 0
  if (-not $SkipGeneralBoard) {
    $generalBoardExitCode = Invoke-OperationalReader -ScriptPath "scripts/sync-general-board.js" -Label "Tablon general"
  }
  $ErrorActionPreference = $previousErrorAction
  if ($puertasExitCode -ne 0 -or $chaperoExitCode -ne 0 -or $generalBoardExitCode -ne 0) {
    throw "La actualizacion operativa fallo: puertas=$puertasExitCode, chapero=$chaperoExitCode, tablon=$generalBoardExitCode."
  }
}
finally {
  $env:CPE_SUPABASE_SECRET_KEY = $null
  $env:CPE_PORTAL_CDP_ENDPOINT = $null
  $env:CPE_GENERAL_BOARD_CDP_ENDPOINT = $null
  if ($secretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
}
