param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path
)

$ErrorActionPreference = "Stop"
$taskName = "App CPE - Control remoto pendientes"
$runner = Join-Path $RepositoryPath "scripts\windows\run-remote-pending-worker-agent.ps1"
$secretPath = Join-Path $env:LOCALAPPDATA "AppCPE\portal-worker\supabase-secret.dpapi"
if (-not (Test-Path -LiteralPath $runner)) { throw "No existe el agente remoto." }
if (-not (Test-Path -LiteralPath $secretPath)) { throw "Falta la credencial cifrada del worker." }

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$quotedRunner = '"' + $runner.Replace('"', '""') + '"'
$quotedRepo = '"' + $RepositoryPath.Replace('"', '""') + '"'
$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $quotedRunner -RepositoryPath $quotedRepo"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $RepositoryPath
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$watchdogTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logonTrigger, $watchdogTrigger) -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Control remoto instalado y en ejecución: $taskName" -ForegroundColor Green
