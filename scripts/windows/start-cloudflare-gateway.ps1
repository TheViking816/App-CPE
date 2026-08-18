param(
  [ValidateRange(1024, 65535)][int]$Port = 9223,
  [string]$ProfilePath = "",
  [string]$PortalUrl = "https://portal.cpevalencia.com/#User",
  [ValidateRange(5, 60)][int]$WaitSeconds = 20
)

$ErrorActionPreference = "Stop"
if (-not $ProfilePath) {
  $ProfilePath = Join-Path $env:LOCALAPPDATA "AppCPE\cloudflare-gateway\chrome-profile"
}
$chromeCandidates = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
)
$chromePath = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $chromePath) { throw "Google Chrome no está instalado." }

$versionUrl = "http://127.0.0.1:$Port/json/version"
try {
  $null = Invoke-RestMethod -Uri $versionUrl -TimeoutSec 2
  Write-Host "Gateway Chrome ya disponible en el puerto $Port."
  exit 0
} catch {}

New-Item -ItemType Directory -Path $ProfilePath -Force | Out-Null
$arguments = @(
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=$Port",
  "--user-data-dir=$ProfilePath",
  "--profile-directory=Default",
  "--no-first-run",
  "--no-default-browser-check",
  $PortalUrl
)

# Esta ventana es deliberadamente visible: permite resolver el desafío humano
# cuando Cloudflare lo solicite y conserva después el mismo perfil.
Start-Process -FilePath $chromePath -ArgumentList $arguments | Out-Null

$deadline = (Get-Date).AddSeconds($WaitSeconds)
do {
  Start-Sleep -Milliseconds 500
  try {
    $version = Invoke-RestMethod -Uri $versionUrl -TimeoutSec 2
    if ($version.webSocketDebuggerUrl) {
      Write-Host "Gateway Chrome preparado. Deja esta ventana abierta."
      exit 0
    }
  } catch {}
} while ((Get-Date) -lt $deadline)

throw "Chrome se abrió, pero el puerto de conexión no respondió."
