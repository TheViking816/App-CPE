param(
  [ValidateRange(1024, 65535)][int]$Port = 9223,
  [string]$ProfilePath = "",
  [string]$PortalUrl = "https://portal.cpevalencia.com/#User",
  [ValidateRange(5, 180)][int]$WaitSeconds = 90,
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
$verifiedReloadScript = Join-Path $PSScriptRoot "..\reload-cloudflare-gateway.js"
if (-not (Test-Path -LiteralPath $verifiedReloadScript)) {
  throw "No existe el recargador verificado del Chrome gateway."
}

function Invoke-VerifiedPortalReload {
  & node $verifiedReloadScript "http://127.0.0.1:$Port"
  if ($LASTEXITCODE -ne 0) {
    throw "Chrome esta abierto, pero el portal no quedo autorizado despues de recargarlo."
  }
}

function Stop-DedicatedGatewayChrome {
  $profileArgument = "--user-data-dir=$ProfilePath"
  $processes = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profileArgument) }
  foreach ($process in $processes) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  $deadline = (Get-Date).AddSeconds(10)
  do {
    Start-Sleep -Milliseconds 250
    try { $null = Invoke-RestMethod -Uri $versionUrl -TimeoutSec 1 } catch { return }
  } while ((Get-Date) -lt $deadline)
}

function Set-JsonProperty([object]$Target, [string]$Name, [object]$Value) {
  if ($Target.PSObject.Properties.Name -contains $Name) {
    $Target.$Name = $Value
  } else {
    $Target | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
  }
}

function Set-GatewayProfilePreferences {
  $defaultProfilePath = Join-Path $ProfilePath "Default"
  $preferencesPath = Join-Path $defaultProfilePath "Preferences"
  New-Item -ItemType Directory -Path $defaultProfilePath -Force | Out-Null
  $preferences = [PSCustomObject]@{}
  if (Test-Path -LiteralPath $preferencesPath) {
    try { $preferences = Get-Content -LiteralPath $preferencesPath -Raw | ConvertFrom-Json } catch {}
  }
  if (-not $preferences) { $preferences = [PSCustomObject]@{} }
  Set-JsonProperty $preferences "credentials_enable_service" $false
  Set-JsonProperty $preferences "credentials_enable_autosignin" $false
  if (-not ($preferences.PSObject.Properties.Name -contains "profile") -or -not $preferences.profile) {
    Set-JsonProperty $preferences "profile" ([PSCustomObject]@{})
  }
  Set-JsonProperty $preferences.profile "password_manager_enabled" $false
  Set-JsonProperty $preferences.profile "password_manager_leak_detection" $false
  Set-JsonProperty $preferences.profile "exit_type" "Normal"
  Set-JsonProperty $preferences.profile "exited_cleanly" $true
  $json = $preferences | ConvertTo-Json -Depth 100 -Compress
  [System.IO.File]::WriteAllText($preferencesPath, $json, [System.Text.UTF8Encoding]::new($false))
}

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
  $null = Open-PortalGatewayTab
  Invoke-VerifiedPortalReload
  Write-Host "Gateway Chrome ya disponible en el puerto $Port. Portal recargado y comprobado para renovar Cloudflare."
  exit 0
} catch {
  Write-Host "El Chrome gateway existente no responde correctamente; se cierra y se abre de nuevo." -ForegroundColor Yellow
  Stop-DedicatedGatewayChrome
}

New-Item -ItemType Directory -Path $ProfilePath -Force | Out-Null
Set-GatewayProfilePreferences
$arguments = @(
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=$Port",
  "--user-data-dir=$ProfilePath",
  "--profile-directory=Default",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-features=PasswordLeakDetection,LeakDetectionUnauthenticated,PasswordCheck,PasswordManagerOnboarding",
  "--disable-save-password-bubble",
  "--disable-session-crashed-bubble",
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
      Invoke-VerifiedPortalReload
      Write-Host "Gateway Chrome preparado y portal recargado de forma verificada. Deja abierta la ventana de Chrome; esta consola ya puede cerrarse."
      exit 0
    }
  } catch {}
} while ((Get-Date) -lt $deadline)

throw "Chrome se abrió, pero el puerto de conexión no respondió."
