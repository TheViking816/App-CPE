param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
)

$ErrorActionPreference = "Stop"
$RepositoryPath = (Resolve-Path -LiteralPath $RepositoryPath).Path
$taskName = "Actualizar Tablon Puertas Chapero - App CPE"
$runner = Join-Path $RepositoryPath "scripts\windows\run-operational-sync.ps1"
if (-not (Test-Path -LiteralPath $runner)) { throw "No existe el worker operativo: $runner" }

$powerShell = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
$arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -RepositoryPath "{1}"' -f $runner, $RepositoryPath
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $RepositoryPath
$days = @('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday')
$times = @('07:15', '12:15', '14:45')
$triggers = @($times | ForEach-Object {
  New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $days -At $_
})
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -WakeToRun `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -MultipleInstances IgnoreNew
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskPath '\' -TaskName $taskName -Action $action `
  -Trigger $triggers -Settings $settings -Principal $principal `
  -Description 'Actualiza Tablon, Puertas, Chapero y prevision del Oraculo de lunes a sabado a las 07:15, 12:15 y 14:45.' `
  -Force | Out-Null
$installed = Get-ScheduledTask -TaskPath '\' -TaskName $taskName
if ($installed.State -eq 'Disabled' -or $installed.Triggers.Count -ne 3) {
  throw "La nueva tarea no quedo activa con sus tres horarios; se conservan las tareas anteriores."
}

$legacyTaskNames = @(
  'App CPE Chapero y Puertas',
  'App CPE - 07-30 laborables y sabados',
  'App CPE - Cambio de mes 00-15',
  'App CPE - Control remoto pendientes',
  'App CPE - Diario 02-08-14-20',
  'App CPE - Laborables 12-30',
  'App CPE - Laborables 14-45',
  'App CPE - Sabados y visperas 11-45',
  'App CPE - Sabados y visperas 13-30',
  'PortalEstibaVLC Oraculo 0730',
  'PortalEstibaVLC Oraculo 1145',
  'PortalEstibaVLC Oraculo 1230',
  'PortalEstibaVLC Oraculo 1330',
  'PortalEstibaVLC Oraculo 1445'
)
$backupDir = Join-Path $env:LOCALAPPDATA ("AppCPE\scheduler-backup\{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
foreach ($oldName in $legacyTaskNames) {
  $oldTask = Get-ScheduledTask -TaskPath '\' -TaskName $oldName -ErrorAction SilentlyContinue
  if (-not $oldTask) { continue }
  New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
  $safeName = $oldName -replace '[^A-Za-z0-9._-]', '_'
  Export-ScheduledTask -TaskPath '\' -TaskName $oldName |
    Set-Content -LiteralPath (Join-Path $backupDir "$safeName.xml") -Encoding UTF8
  if ($oldTask.State -eq 'Running') { Stop-ScheduledTask -TaskPath '\' -TaskName $oldName }
  Unregister-ScheduledTask -TaskPath '\' -TaskName $oldName -Confirm:$false
}

Write-Host "Activa: $taskName"
Write-Host "Lunes a sabado: $($times -join ', ')"
Write-Host "Proxima ejecucion: $((Get-ScheduledTaskInfo -TaskPath '\' -TaskName $taskName).NextRunTime)"
