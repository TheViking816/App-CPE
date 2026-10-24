param([string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path)
$ErrorActionPreference = 'Stop'
$secretPath = Join-Path $env:LOCALAPPDATA 'AppCPE\portal-worker\supabase-secret.dpapi'
if (-not (Test-Path -LiteralPath $secretPath)) { throw 'Falta la credencial local cifrada del worker.' }
$secure = ConvertTo-SecureString (Get-Content -LiteralPath $secretPath -Raw).Trim()
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:CPE_SUPABASE_URL = 'https://wvwdiywtlbffumshbboa.supabase.co'
  $env:CPE_SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  Set-Location -LiteralPath $RepositoryPath
  $logDirectory = Join-Path $env:LOCALAPPDATA 'AppCPE\personal-noray'
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  & node 'scripts/personal-noray-sync-agent.js' *>> (Join-Path $logDirectory 'agent.log')
  exit $LASTEXITCODE
} finally {
  $env:CPE_SUPABASE_SECRET_KEY = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
