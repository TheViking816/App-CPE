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
  $ProfileRoot = Join-Path $RepositoryPath "data\portal-oficial-chrome-profile\workers"
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
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$watchdogTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 5 `
  -RestartInterval (New-TimeSpan -Minutes 2) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logonTrigger, $watchdogTrigger) -Settings $settings -Principal $principal -Force | Out-Null
Disable-ScheduledTask -TaskName $taskName | Out-Null

$scheduleInstaller = Join-Path $RepositoryPath "scripts\windows\install-portal-sync-schedule.ps1"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scheduleInstaller -RepositoryPath $RepositoryPath
if ($LASTEXITCODE -ne 0) { throw "No se pudieron instalar los horarios del portal." }
$operationalScheduleInstaller = Join-Path $RepositoryPath "scripts\windows\install-operational-sync-schedule.ps1"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $operationalScheduleInstaller -RepositoryPath $RepositoryPath
if ($LASTEXITCODE -ne 0) { throw "No se pudieron instalar los horarios de Chapero y Puertas." }
$pendingShortcutInstaller = Join-Path $RepositoryPath "scripts\windows\install-pending-sync-shortcut.ps1"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $pendingShortcutInstaller -RepositoryPath $RepositoryPath
if ($LASTEXITCODE -ne 0) { throw "No se pudo crear el acceso para actualizar pendientes." }
$remoteAgentInstaller = Join-Path $RepositoryPath "scripts\windows\install-remote-pending-worker-agent.ps1"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $remoteAgentInstaller -RepositoryPath $RepositoryPath
if ($LASTEXITCODE -ne 0) { throw "No se pudo instalar el control remoto de pendientes." }

Write-Host "Worker instalado en modo manual en tandas de hasta $BatchSize."
Write-Host "Estado y logs: $workerStateDir"
