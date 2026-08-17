$ErrorActionPreference = "Stop"
$taskName = "App CPE Portal Worker"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Write-Host "Tarea programada eliminada. La clave cifrada y los logs se conservan en LOCALAPPDATA para permitir recuperacion."
