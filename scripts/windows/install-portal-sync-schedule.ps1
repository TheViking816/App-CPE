param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path
)

$ErrorActionPreference = "Stop"
$taskName = "App CPE Actualizacion Programada"
$queueScript = Join-Path $RepositoryPath "scripts\windows\queue-all-portal-syncs.ps1"
if (-not (Test-Path -LiteralPath $queueScript)) {
  throw "No existe el lanzador de actualizacion global."
}

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$quotedQueue = '"' + $queueScript.Replace('"', '""') + '"'
$quotedRepo = '"' + $RepositoryPath.Replace('"', '""') + '"'
$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $quotedQueue -RepositoryPath $quotedRepo"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $RepositoryPath
$times = @("02:00", "07:30", "08:00", "12:30", "14:00", "14:45", "15:00", "20:00")
$triggers = foreach ($time in $times) {
  New-ScheduledTaskTrigger -Daily -At ([DateTime]::ParseExact($time, "HH:mm", [Globalization.CultureInfo]::InvariantCulture))
}
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Horarios instalados: $($times -join ', ')."
