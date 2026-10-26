$ErrorActionPreference = 'Stop'
Write-Host 'Prueba manual de próximas contrataciones: solo 72683. Activa tu VPN antes de continuar.'
$confirmation = Read-Host 'Escribe LEER para iniciar la prueba o pulsa Intro para salir'
if ($confirmation -cne 'LEER') { exit }
$secretPath = Join-Path $env:LOCALAPPDATA 'AppCPE\portal-worker\supabase-secret.dpapi'
if (-not (Test-Path -LiteralPath $secretPath)) { throw 'Falta la credencial local cifrada del worker.' }
$secure = ConvertTo-SecureString (Get-Content -LiteralPath $secretPath -Raw).Trim()
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$previousSecret = $env:CPE_SUPABASE_SECRET_KEY
$personalLink = Read-Host 'Pega el enlace personal de Jornales de 72683 (no se mostrará)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($personalLink)
try {
  $env:CPE_SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  $env:CPE_UPCOMING_PERSONAL_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  Push-Location (Join-Path $PSScriptRoot '..\..')
  try { node scripts/read-upcoming-72683.js --manual }
  finally { Pop-Location }
} finally {
  Remove-Item Env:CPE_UPCOMING_PERSONAL_URL -ErrorAction SilentlyContinue
  $env:CPE_SUPABASE_SECRET_KEY = $previousSecret
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
}
