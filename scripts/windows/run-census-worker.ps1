param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [ValidateRange(1024, 65535)][int]$GatewayPort = 9223,
  [switch]$UpdateFromMain
)

$ErrorActionPreference = "Stop"
$secretPath = Join-Path $env:LOCALAPPDATA "AppCPE\portal-worker\supabase-secret.dpapi"
$logDir = Join-Path $env:LOCALAPPDATA "AppCPE\census-worker\logs"
$gatewayScript = Join-Path $RepositoryPath "scripts\windows\start-cloudflare-gateway.ps1"
if (-not (Test-Path -LiteralPath $secretPath)) { throw "No existe la clave cifrada del worker." }
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

try {
  Set-Location -LiteralPath $RepositoryPath
  if ($UpdateFromMain) {
    & git fetch origin main
    if ($LASTEXITCODE -ne 0) { throw "No se pudo consultar main en GitHub." }
    $localCommit = (& git rev-parse HEAD).Trim()
    $mainCommit = (& git rev-parse origin/main).Trim()
    if ($LASTEXITCODE -ne 0) { throw "No se pudo comprobar la versión local." }
    if ($localCommit -ne $mainCommit) {
      $changes = @(git status --porcelain)
      if ($LASTEXITCODE -ne 0 -or $changes.Count -gt 0) {
        throw "Hay una versión nueva en main, pero la copia local contiene cambios pendientes. No se sobrescriben automáticamente."
      }
      & git merge --ff-only origin/main
      if ($LASTEXITCODE -ne 0) { throw "La copia local no pudo avanzar a main sin modificar cambios." }
    }
  }

  $secure = ConvertTo-SecureString (Get-Content -LiteralPath $secretPath -Raw).Trim()
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $env:CPE_SUPABASE_URL = "https://wvwdiywtlbffumshbboa.supabase.co"
    $env:CPE_SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $env:CPE_PORTAL_CDP_ENDPOINT = "http://127.0.0.1:$GatewayPort"
    $logPath = Join-Path $logDir ("censos-{0}.log" -f (Get-Date -Format "yyyy-MM-dd-HHmmss"))
    & node "scripts/census-worker.js" --preflight 2>&1 | Tee-Object -FilePath $logPath
    if ($LASTEXITCODE -ne 0) { throw "La base de datos todavía no permite leer las credenciales del lector de censos. Consulta $logPath." }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $gatewayScript -Port $GatewayPort
    if ($LASTEXITCODE -ne 0) { throw "No se pudo preparar el navegador del portal." }
    & node "scripts/census-worker.js" 2>&1 | Tee-Object -FilePath $logPath
    if ($LASTEXITCODE -ne 0) { throw "La actualización quedó incompleta. Consulta $logPath." }
    Write-Host "Censos actualizados. Registro: $logPath" -ForegroundColor Green
  } finally {
    $env:CPE_SUPABASE_SECRET_KEY = $null
    $env:CPE_PORTAL_CDP_ENDPOINT = $null
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  }
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
} finally {
  if ($Host.Name -eq "ConsoleHost") { Read-Host "Pulsa Intro para cerrar" | Out-Null }
}
