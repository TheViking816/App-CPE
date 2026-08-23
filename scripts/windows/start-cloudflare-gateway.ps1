param(
  [ValidateRange(1024, 65535)][int]$Port = 9223,
  [string]$ProfilePath = "",
  [string]$PortalUrl = "https://portal.cpevalencia.com/#User",
  [ValidateRange(5, 60)][int]$WaitSeconds = 20,
  [ValidateRange(1, 30)][int]$ReloadDelaySeconds = 5
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
function Open-PortalGatewayTab {
  $encodedPortalUrl = [Uri]::EscapeDataString($PortalUrl)
  return Invoke-RestMethod -Method Put -Uri "http://127.0.0.1:$Port/json/new?$encodedPortalUrl" -TimeoutSec 5
}

function Reload-PortalGatewayTab([object]$Target) {
  if (-not $Target -or -not $Target.webSocketDebuggerUrl) {
    $Target = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 5 |
      Where-Object { $_.type -eq "page" -and $_.url -like "https://portal.cpevalencia.com/*" } |
      Select-Object -First 1
  }
  if (-not $Target -or -not $Target.webSocketDebuggerUrl) {
    throw "No se encontro la pestana del portal para recargarla."
  }

  Start-Sleep -Seconds $ReloadDelaySeconds
  $socket = [System.Net.WebSockets.ClientWebSocket]::new()
  try {
    $null = $socket.ConnectAsync([Uri]$Target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    $payload = [Text.Encoding]::UTF8.GetBytes('{"id":1,"method":"Page.reload","params":{"ignoreCache":true}}')
    $segment = [ArraySegment[byte]]::new($payload)
    $null = $socket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
  } finally {
    $socket.Dispose()
  }
}

try {
  $null = Invoke-RestMethod -Uri $versionUrl -TimeoutSec 2
  $portalTarget = Open-PortalGatewayTab
  Reload-PortalGatewayTab $portalTarget
  Write-Host "Gateway Chrome ya disponible en el puerto $Port. Portal abierto y recargado para renovar Cloudflare."
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
      Reload-PortalGatewayTab $null
      Write-Host "Gateway Chrome preparado y portal recargado. Deja abierta la ventana de Chrome; esta consola ya puede cerrarse."
      exit 0
    }
  } catch {}
} while ((Get-Date) -lt $deadline)

throw "Chrome se abrió, pero el puerto de conexión no respondió."
