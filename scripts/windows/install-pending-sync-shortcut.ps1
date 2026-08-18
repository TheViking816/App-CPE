param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path,
  [ValidateRange(1024, 65535)][int]$GatewayPort = 9223
)

$ErrorActionPreference = "Stop"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Actualizar pendientes App CPE.lnk"
$batchScript = Join-Path $RepositoryPath "scripts\windows\run-cloudflare-gateway-batch.ps1"
if (-not (Test-Path -LiteralPath $batchScript)) { throw "No existe el procesador del Chrome worker." }

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -NoExit -File "' + $batchScript + '" -RepositoryPath "' + $RepositoryPath + '" -Port ' + $GatewayPort + ' -BatchSize 10 -Drain'
$shortcut.WorkingDirectory = $RepositoryPath
$shortcut.Description = "Procesa solamente las sincronizaciones que ya estan en cola"
$shortcut.Save()
Write-Host "Acceso creado: $shortcutPath"
