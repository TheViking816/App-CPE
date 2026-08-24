param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path,
  [ValidateRange(1024, 65535)][int]$GatewayPort = 9223
)

$ErrorActionPreference = "Stop"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Actualizar pendientes App CPE.lnk"
$runnerScript = Join-Path $RepositoryPath "scripts\windows\run-pending-sync.ps1"
if (-not (Test-Path -LiteralPath $runnerScript)) { throw "No existe el flujo de trabajos pendientes." }

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -NoExit -File "' + $runnerScript + '" -RepositoryPath "' + $RepositoryPath + '" -GatewayPort ' + $GatewayPort + ' -BatchSize 10 -WarmupSeconds 45'
$shortcut.WorkingDirectory = $RepositoryPath
$shortcut.Description = "Prepara Chrome y procesa solamente las sincronizaciones que ya estan en cola"
$shortcut.Save()
Write-Host "Acceso creado: $shortcutPath"
