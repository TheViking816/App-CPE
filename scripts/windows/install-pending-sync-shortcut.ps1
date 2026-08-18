param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path,
  [ValidateRange(1024, 65535)][int]$GatewayPort = 9223
)

$ErrorActionPreference = "Stop"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Actualizar pendientes App CPE.lnk"
$gatewayScript = Join-Path $RepositoryPath "scripts\windows\start-cloudflare-gateway.ps1"
if (-not (Test-Path -LiteralPath $gatewayScript)) { throw "No existe el iniciador del Chrome worker." }

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $gatewayScript + '" -Port ' + $GatewayPort
$shortcut.WorkingDirectory = $RepositoryPath
$shortcut.Description = "Procesa solamente las sincronizaciones que ya estan en cola"
$shortcut.Save()
Write-Host "Acceso creado: $shortcutPath"
