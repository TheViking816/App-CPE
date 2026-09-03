param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path
)

$ErrorActionPreference = "Stop"
$secretPath = Join-Path $env:LOCALAPPDATA "AppCPE\portal-worker\supabase-secret.dpapi"
if (-not (Test-Path -LiteralPath $secretPath)) { throw "Falta la credencial cifrada del worker." }

$secureSecret = ConvertTo-SecureString (Get-Content -LiteralPath $secretPath -Raw).Trim()
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
try {
  $env:CPE_SUPABASE_URL = "https://wvwdiywtlbffumshbboa.supabase.co"
  $env:CPE_SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  $env:CPE_REPOSITORY_PATH = $RepositoryPath
  $env:CPE_REMOTE_WORKER_ID = $env:COMPUTERNAME
  Set-Location -LiteralPath $RepositoryPath
  & node "scripts/remote-pending-worker-agent.js"
  exit $LASTEXITCODE
} finally {
  $env:CPE_SUPABASE_SECRET_KEY = $null
  $env:CPE_REPOSITORY_PATH = $null
  $env:CPE_REMOTE_WORKER_ID = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
}
