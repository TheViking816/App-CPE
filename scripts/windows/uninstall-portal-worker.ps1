$ErrorActionPreference = "Stop"
foreach ($taskName in @("App CPE Portal Worker", "App CPE Actualizacion Programada", "App CPE Chapero y Puertas")) {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
}
Write-Host "Tareas programadas eliminadas. La clave cifrada y los logs se conservan en LOCALAPPDATA para permitir recuperacion."
