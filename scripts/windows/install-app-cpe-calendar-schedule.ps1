param(
  [string]$RepositoryPath = ""
)

$ErrorActionPreference = "Stop"
if (-not $RepositoryPath) {
  $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
  $RepositoryPath = (Resolve-Path (Join-Path $scriptDirectory "..\.." )).Path
}

$runner = Join-Path $RepositoryPath "scripts\windows\run-calendar-aware-combined-sync.ps1"
$powerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 4) -MultipleInstances IgnoreNew

function New-CalendarAction([string]$ScheduleType) {
  $arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`" -ScheduleType $ScheduleType -RepositoryPath `"$RepositoryPath`""
  return (New-ScheduledTaskAction -Execute $powerShell -Argument $arguments)
}

function Install-AppTask([string]$Name, [object]$Action, [object[]]$Triggers, [string]$Description) {
  Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Triggers -Principal $principal -Settings $settings -Description $Description -Force | Out-Null
}

Get-ScheduledTask | Where-Object { $_.TaskName -like "App CPE*" } | ForEach-Object {
  Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false
}

$mondayToSaturday = @("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")
$mondayToFriday = @("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")

Install-AppTask "App CPE - 07-30 laborables y sabados" (New-CalendarAction "Common") @(
  New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $mondayToSaturday -At "07:30"
) "07:30 de lunes a sabado; se omiten festivos."

Install-AppTask "App CPE - Laborables 12-30" (New-CalendarAction "Normal") @(
  New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $mondayToFriday -At "12:30"
) "12:30 de lunes a viernes laborables; se omiten festivos y visperas."

Install-AppTask "App CPE - Laborables 14-45" (New-CalendarAction "Normal") @(
  New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $mondayToFriday -At "14:45"
) "14:45 de lunes a viernes laborables; se omiten festivos y visperas."

$remaining2026Eves = @([datetime]"2026-10-08", [datetime]"2026-12-07", [datetime]"2026-12-24")
$reduced1145 = @(
  New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Saturday -At "11:45"
)
$reduced1330 = @(
  New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Saturday -At "13:30"
)
foreach ($eve in $remaining2026Eves) {
  $reduced1145 += New-ScheduledTaskTrigger -Once -At $eve.Date.AddHours(11).AddMinutes(45)
  $reduced1330 += New-ScheduledTaskTrigger -Once -At $eve.Date.AddHours(13).AddMinutes(30)
}

Install-AppTask "App CPE - Sabados y visperas 11-45" (New-CalendarAction "Reduced") $reduced1145 "11:45 los sabados y visperas laborables de festivo."
Install-AppTask "App CPE - Sabados y visperas 13-30" (New-CalendarAction "Reduced") $reduced1330 "13:30 los sabados y visperas laborables de festivo."

$desktop = [Environment]::GetFolderPath("DesktopDirectory")
$gatewayShortcut = Join-Path $desktop "Abrir Chrome Worker App CPE.lnk"
$combinedShortcut = Join-Path $desktop "App CPE - 3 Actualizar TODO (mes + chapero + puertas).lnk"
$flow = "Start-Process -FilePath '$gatewayShortcut'; Start-Sleep -Seconds 45; Start-Process -FilePath '$combinedShortcut'"
$encodedFlow = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($flow))
$dailyAction = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand $encodedFlow"
$dailyTriggers = @(
  (New-ScheduledTaskTrigger -Daily -At "02:00"),
  (New-ScheduledTaskTrigger -Daily -At "08:00"),
  (New-ScheduledTaskTrigger -Daily -At "14:00"),
  (New-ScheduledTaskTrigger -Daily -At "20:00")
)
Install-AppTask "App CPE - Diario 02-08-14-20" $dailyAction $dailyTriggers "Todos los dias, incluidos domingos y festivos: 02:00, 08:00, 14:00 y 20:00."

Write-Host "Programacion App CPE instalada: seis tareas definitivas."
