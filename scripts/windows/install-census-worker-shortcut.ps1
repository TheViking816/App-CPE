param([string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path)

$ErrorActionPreference = "Stop"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "App CPE - Actualizar censos (manual).lnk"
$runner = Join-Path $RepositoryPath "scripts\windows\run-census-worker.ps1"
if (-not (Test-Path -LiteralPath $runner)) { throw "No existe el lector de censos." }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -RepositoryPath `"$RepositoryPath`" -UpdateFromMain"
$shortcut.WorkingDirectory = $RepositoryPath
$shortcut.Description = "Actualiza manualmente los censos TU y TP sin ejecutar el worker habitual"
$shortcut.WindowStyle = 1
$shortcut.Save()
Write-Output $shortcutPath
