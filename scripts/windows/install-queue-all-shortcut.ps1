param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path
)

$ErrorActionPreference = "Stop"
$desktop = [Environment]::GetFolderPath("Desktop")
$scriptPath = Join-Path $RepositoryPath "scripts\windows\queue-all-portal-syncs.ps1"
$shell = New-Object -ComObject WScript.Shell

$shortcuts = @(
  @{
    Name = "App CPE - 1 Carga completa anual (todos).lnk"
    Mode = "FullHistory"
    Description = "Carga completa de todos: ano actual, primas, nominas, documentos y resto del portal"
  },
  @{
    Name = "App CPE - 2 Actualizar mes actual (todos).lnk"
    Mode = "CurrentMonth"
    Description = "Actualiza el mes actual de todos y conserva el historico y las nominas anteriores"
  }
)

foreach ($definition in $shortcuts) {
  $shortcutPath = Join-Path $desktop $definition.Name
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = "powershell.exe"
  $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -NoExit -File "' + $scriptPath + '" -RepositoryPath "' + $RepositoryPath + '" -Mode ' + $definition.Mode
  $shortcut.WorkingDirectory = $RepositoryPath
  $shortcut.Description = $definition.Description
  $shortcut.Save()
  Write-Host "Acceso creado: $shortcutPath"
}
