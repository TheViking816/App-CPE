param(
  [string]$RepositoryPath = ""
)

$ErrorActionPreference = "Stop"
if (-not $RepositoryPath) {
  $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
  $RepositoryPath = (Resolve-Path (Join-Path $scriptDirectory "..\.." )).Path
}

$runner = Join-Path $RepositoryPath "scripts\windows\run-combined-current-sync.ps1"
if (-not (Test-Path -LiteralPath $runner)) { throw "No existe el worker combinado." }

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "App CPE - 3 Actualizar TODO (mes + chapero + puertas).lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -NoExit -File "' + $runner + '" -RepositoryPath "' + $RepositoryPath + '"'
$shortcut.WorkingDirectory = $RepositoryPath
$shortcut.Description = "Actualiza mes actual de todos, Chapero, Puertas y Tablon General una sola vez"
$shortcut.Save()

Write-Host "Acceso creado: $shortcutPath"
