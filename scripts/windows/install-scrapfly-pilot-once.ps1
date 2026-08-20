param(
  [Parameter(Mandatory = $true)][datetime]$RunAt,
  [string]$RepositoryPath = "",
  [string]$TaskName = "App CPE Scrapfly Pilot Once"
)

$ErrorActionPreference = "Stop"
if (-not $RepositoryPath) {
  $RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path
}
if ($RunAt -le (Get-Date)) { throw "La hora del piloto debe estar en el futuro." }

$runner = Join-Path $RepositoryPath "scripts\windows\run-scrapfly-portal-pilot.ps1"
$argument = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`" -RepositoryPath `"$RepositoryPath`" -TargetChapa 72683"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument
$trigger = New-ScheduledTaskTrigger -Once -At $RunAt
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Piloto aislado de Scrapfly para App CPE; una unica ejecucion." -Force | Out-Null
Write-Host "Tarea '$TaskName' preparada para $($RunAt.ToString('yyyy-MM-dd HH:mm:ss'))."
