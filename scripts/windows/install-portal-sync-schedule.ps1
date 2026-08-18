param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path
)

$ErrorActionPreference = "Stop"
$taskName = "App CPE Actualizacion Programada"
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Write-Host "Actualizaciones horarias desactivadas. Usa los accesos manuales del escritorio."
