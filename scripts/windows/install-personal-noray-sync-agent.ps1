param([string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path)
$ErrorActionPreference = 'Stop'
$taskName = 'App CPE - Sincronizacion personal manual'
$runner = Join-Path $RepositoryPath 'scripts\windows\run-personal-noray-sync-agent.ps1'
$agent = Join-Path $RepositoryPath 'scripts\personal-noray-sync-agent.js'
$secret = Join-Path $env:LOCALAPPDATA 'AppCPE\portal-worker\supabase-secret.dpapi'
if (-not (Test-Path -LiteralPath $runner) -or -not (Test-Path -LiteralPath $agent)) { throw 'Faltan archivos del agente.' }
if (-not (Test-Path -LiteralPath $secret)) { throw 'Falta la credencial local cifrada.' }
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$quotedRunner = '"' + $runner.Replace('"','""') + '"'
$quotedRepo = '"' + $RepositoryPath.Replace('"','""') + '"'
$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $quotedRunner -RepositoryPath $quotedRepo"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $RepositoryPath
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host 'Agente instalado. Solo abre Noray cuando 72683 pulsa Sincronizar ahora en el Monitor.'
