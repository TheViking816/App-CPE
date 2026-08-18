param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path,
  [ValidateRange(1, 32)][int]$BatchSize = 10,
  [string]$ProfileRoot = "",
  [switch]$ReadSecretFromClipboard,
  [switch]$ReadSecretFromStdin,
  [switch]$DoNotStart
)

$ErrorActionPreference = "Stop"
$taskName = "App CPE Portal Worker"
$workerStateDir = Join-Path $env:LOCALAPPDATA "AppCPE\portal-worker"
$secretPath = Join-Path $workerStateDir "supabase-secret.dpapi"
$runnerPath = Join-Path $RepositoryPath "scripts\windows\run-portal-worker.ps1"
if ([string]::IsNullOrWhiteSpace($ProfileRoot)) {
  $ProfileRoot = Join-Path $RepositoryPath "data\portal-oficial-chrome-profile"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js no esta instalado o no aparece en PATH."
}
if (-not (Test-Path -LiteralPath "C:\Program Files\Google\Chrome\Application\chrome.exe")) {
  throw "Google Chrome no esta instalado en la ruta esperada."
}
if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath "node_modules\playwright"))) {
  throw "Faltan dependencias. Ejecuta npm ci en el repositorio del worker."
}

New-Item -ItemType Directory -Force -Path $workerStateDir | Out-Null

if ($ReadSecretFromStdin) {
  $plainSecret = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($plainSecret)) { throw "La entrada no contiene una clave." }
  $secureSecret = ConvertTo-SecureString $plainSecret.Trim() -AsPlainText -Force
  $plainSecret = $null
}
elseif ($ReadSecretFromClipboard) {
  $plainSecret = [string](Get-Clipboard -Raw)
  if ([string]::IsNullOrWhiteSpace($plainSecret)) { throw "El portapapeles no contiene una clave." }
  $secureSecret = ConvertTo-SecureString $plainSecret.Trim() -AsPlainText -Force
  Set-Clipboard -Value ""
  $plainSecret = $null
}
else {
  $secureSecret = Read-Host "Pega la clave secreta dedicada de Supabase" -AsSecureString
}

$encryptedSecret = ConvertFrom-SecureString $secureSecret
Set-Content -LiteralPath $secretPath -Value $encryptedSecret -Encoding ascii

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $secretPath /inheritance:r /grant:r "${currentUser}:(R,W)" | Out-Null

$quotedRunner = '"' + $runnerPath.Replace('"', '""') + '"'
$quotedRepo = '"' + $RepositoryPath.Replace('"', '""') + '"'
$quotedProfileRoot = '"' + $ProfileRoot.Replace('"', '""') + '"'
$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $quotedRunner -RepositoryPath $quotedRepo -BatchSize $BatchSize -ProfileRoot $quotedProfileRoot"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $RepositoryPath
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 5 `
  -RestartInterval (New-TimeSpan -Minutes 2) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

if (-not $DoNotStart) {
  Start-ScheduledTask -TaskName $taskName
}

Write-Host "Worker instalado en tandas de hasta $BatchSize. Se iniciara al entrar en Windows."
Write-Host "Estado y logs: $workerStateDir"
