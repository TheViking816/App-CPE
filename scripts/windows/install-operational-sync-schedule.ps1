param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path
)

$ErrorActionPreference = "Stop"
$taskName = "App CPE Chapero y Puertas"
$runner = Join-Path $RepositoryPath "scripts\windows\run-operational-sync.ps1"
if (-not (Test-Path -LiteralPath $runner)) { throw "No existe el worker de Chapero y Puertas." }

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$quotedRunner = '"' + $runner.Replace('"', '""') + '"'
$quotedRepo = '"' + $RepositoryPath.Replace('"', '""') + '"'
$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $quotedRunner -RepositoryPath $quotedRepo"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $RepositoryPath
$times = @((0..23 | ForEach-Object { "{0:D2}:00" -f $_ })) + @("07:30", "12:30", "14:45")
$triggers = foreach ($time in $times) {
  New-ScheduledTaskTrigger -Daily -At ([DateTime]::ParseExact($time, "HH:mm", [Globalization.CultureInfo]::InvariantCulture))
}
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force | Out-Null

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Actualizar Chapero y Puertas App CPE.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -NoExit -File $quotedRunner -RepositoryPath $quotedRepo"
$shortcut.WorkingDirectory = $RepositoryPath
$shortcut.Description = "Actualiza Chapero, Puertas y Tablon mediante el Chrome worker"
$shortcut.Save()
Write-Host "Chapero, Puertas y Tablon configurados cada hora, mas 07:30, 12:30 y 14:45."
