param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path,
  [ValidateRange(1, 30)][int]$RetryMinutes = 5,
  [ValidateRange(5, 360)][int]$MaximumWaitMinutes = 180
)

$ErrorActionPreference = "Stop"
$workerStateDir = Join-Path $env:LOCALAPPDATA "AppCPE\portal-worker"
$secretPath = Join-Path $workerStateDir "supabase-secret.dpapi"
$logDir = Join-Path $workerStateDir "logs"
$checkScript = Join-Path $RepositoryPath "scripts\check-supabase-worker-access.js"
if (-not (Test-Path -LiteralPath $secretPath)) { throw "No existe la credencial cifrada del worker." }
if (-not (Test-Path -LiteralPath $checkScript)) { throw "No existe la comprobacion de acceso a Supabase." }
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir ("supabase-preflight-{0}.log" -f (Get-Date -Format "yyyy-MM-dd-HHmmss"))

$secureSecret = ConvertTo-SecureString (Get-Content -LiteralPath $secretPath -Raw).Trim()
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
$deadline = (Get-Date).AddMinutes($MaximumWaitMinutes)
try {
  $env:CPE_SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  Set-Location -LiteralPath $RepositoryPath
  while ($true) {
    & node $checkScript 2>&1 | Out-File -LiteralPath $logPath -Append -Encoding utf8
    $checkExitCode = $LASTEXITCODE
    if ($checkExitCode -eq 0) {
      "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Supabase disponible; comienza la sincronizacion." |
        Out-File -LiteralPath $logPath -Append -Encoding utf8
      exit 0
    }
    if ($checkExitCode -ne 75) { throw "Supabase rechazo la credencial del worker de forma permanente." }
    if ((Get-Date).AddMinutes($RetryMinutes) -gt $deadline) {
      throw "Supabase no recupero el acceso del worker tras $MaximumWaitMinutes minutos."
    }
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Acceso temporalmente no disponible; nuevo intento en $RetryMinutes minutos." |
      Out-File -LiteralPath $logPath -Append -Encoding utf8
    Start-Sleep -Seconds ($RetryMinutes * 60)
  }
}
finally {
  $env:CPE_SUPABASE_SECRET_KEY = $null
  if ($secretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
}
