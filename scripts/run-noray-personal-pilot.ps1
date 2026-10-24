param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$pilotDir = Join-Path $env:LOCALAPPDATA 'AppCPE\noray-personal-pilot-72683'
$secretFile = Join-Path $pilotDir 'personal-url.dpapi'
$profileDir = Join-Path $pilotDir 'noray-personal-pilot-chrome-profile'
if (-not (Test-Path -LiteralPath $secretFile) -or -not (Test-Path -LiteralPath $profileDir)) {
  throw 'Falta el enlace cifrado o el perfil Chrome aislado del piloto 72683.'
}

$secureUrl = Get-Content -LiteralPath $secretFile -Raw | ConvertTo-SecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
try {
  $env:CPE_NORAY_PILOT_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $env:CPE_NORAY_PILOT_PROFILE = $profileDir
  Push-Location (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  try {
    if ($DryRun) { & node scripts/noray-personal-pilot.js }
    else { & node scripts/noray-personal-pilot.js --write-local }
    if ($LASTEXITCODE -ne 0) { throw "El lector Noray terminó con código $LASTEXITCODE." }
  } finally { Pop-Location }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  Remove-Item Env:CPE_NORAY_PILOT_URL -ErrorAction SilentlyContinue
  Remove-Item Env:CPE_NORAY_PILOT_PROFILE -ErrorAction SilentlyContinue
}
