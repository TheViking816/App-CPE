param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path
)

$ErrorActionPreference = "Stop"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Actualizar todos App CPE.lnk"
$scriptPath = Join-Path $RepositoryPath "scripts\windows\queue-all-portal-syncs.ps1"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -NoExit -File "' + $scriptPath + '" -RepositoryPath "' + $RepositoryPath + '"'
$shortcut.WorkingDirectory = $RepositoryPath
$shortcut.Description = "Encola todas las chapas con claves del portal guardadas"
$shortcut.Save()
Write-Host "Acceso creado: $shortcutPath"
