$ErrorActionPreference = 'Stop'
Write-Host 'Prueba manual de próximas contrataciones: solo 72683. Activa tu VPN antes de continuar.'
$confirmation = Read-Host 'Escribe LEER para iniciar la prueba o pulsa Intro para salir'
if ($confirmation -cne 'LEER') { exit }
$personalLink = Read-Host 'Pega el enlace personal de Jornales de 72683 (no se mostrará)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($personalLink)
try {
  $env:CPE_UPCOMING_PERSONAL_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  Push-Location (Join-Path $PSScriptRoot '..\..')
  try { node scripts/read-upcoming-72683.js --manual }
  finally { Pop-Location }
} finally {
  Remove-Item Env:CPE_UPCOMING_PERSONAL_URL -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
