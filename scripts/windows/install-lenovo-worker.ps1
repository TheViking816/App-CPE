param(
  [string]$RepositoryPath = "",
  [ValidateRange(1, 10)][int]$BatchSize = 10,
  [switch]$ReadSecretFromClipboard
)

$ErrorActionPreference = "Stop"
if (-not $RepositoryPath) {
  $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
  $RepositoryPath = (Resolve-Path (Join-Path $scriptDirectory "..\.." )).Path
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js no esta instalado o no aparece en PATH." }
$chromePath = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $chromePath) { throw "Google Chrome no esta instalado." }
if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath "node_modules\playwright"))) {
  throw "Faltan dependencias. Ejecuta npm ci en el repositorio antes de instalar el worker."
}

$stateDirectory = Join-Path $env:LOCALAPPDATA "AppCPE\portal-worker"
$secretPath = Join-Path $stateDirectory "supabase-secret.dpapi"
New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null

if ($ReadSecretFromClipboard) {
  $plainSecret = [string](Get-Clipboard -Raw)
  if ([string]::IsNullOrWhiteSpace($plainSecret)) { throw "El portapapeles no contiene una clave." }
  $secureSecret = ConvertTo-SecureString $plainSecret.Trim() -AsPlainText -Force
  Set-Clipboard -Value ""
  $plainSecret = $null
} else {
  $secureSecret = Read-Host "Pega la clave secreta dedicada de Supabase" -AsSecureString
}
$encryptedSecret = ConvertFrom-SecureString $secureSecret
Set-Content -LiteralPath $secretPath -Value $encryptedSecret -Encoding ascii
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $secretPath /inheritance:r /grant:r "${currentUser}:(R,W)" | Out-Null

$desktop = [Environment]::GetFolderPath("DesktopDirectory")
$shell = New-Object -ComObject WScript.Shell
function New-AppShortcut([string]$Name, [string]$Script, [string]$Arguments, [string]$Description) {
  $shortcut = $shell.CreateShortcut((Join-Path $desktop $Name))
  $shortcut.TargetPath = "powershell.exe"
  $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -NoExit -File "' + $Script + '" ' + $Arguments
  $shortcut.WorkingDirectory = $RepositoryPath
  $shortcut.Description = $Description
  $shortcut.Save()
}

$windowsScripts = Join-Path $RepositoryPath "scripts\windows"
New-AppShortcut "Abrir Chrome Worker App CPE.lnk" (Join-Path $windowsScripts "start-cloudflare-gateway.ps1") "-Port 9223" "Abre Chrome y recarga el portal para renovar Cloudflare"
New-AppShortcut "Actualizar pendientes App CPE.lnk" (Join-Path $windowsScripts "run-cloudflare-gateway-batch.ps1") ('-RepositoryPath "' + $RepositoryPath + '" -Port 9223 -BatchSize ' + $BatchSize + ' -Drain') "Procesa la cola en tandas de diez hasta vaciarla"
New-AppShortcut "Actualizar Chapero y Puertas App CPE.lnk" (Join-Path $windowsScripts "run-operational-sync.ps1") ('-RepositoryPath "' + $RepositoryPath + '"') "Actualiza Chapero, Puertas y Tablon"

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $windowsScripts "install-queue-all-shortcut.ps1") -RepositoryPath $RepositoryPath
if ($LASTEXITCODE -ne 0) { throw "No se pudieron crear los accesos de carga global." }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $windowsScripts "install-combined-current-sync-shortcut.ps1") -RepositoryPath $RepositoryPath
if ($LASTEXITCODE -ne 0) { throw "No se pudo crear el acceso de actualizacion completa." }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $windowsScripts "install-app-cpe-calendar-schedule.ps1") -RepositoryPath $RepositoryPath
if ($LASTEXITCODE -ne 0) { throw "No se pudieron instalar los horarios definitivos." }

$tasks = Get-ScheduledTask | Where-Object { $_.TaskName -like "App CPE*" }
if ($tasks.Count -ne 6) { throw "La instalacion no dejo exactamente seis tareas de App CPE." }
Write-Host "Lenovo preparado: accesos creados, tandas de $BatchSize y seis tareas definitivas. No se ha ejecutado ninguna sincronizacion."
