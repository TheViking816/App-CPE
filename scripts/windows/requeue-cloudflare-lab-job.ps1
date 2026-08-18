param(
  [ValidatePattern('^\d{5}$')][string]$Chapa = "72683",
  [string]$RepositoryPath = ""
)

$ErrorActionPreference = "Stop"
if (-not $RepositoryPath) {
  $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
  $RepositoryPath = (Resolve-Path (Join-Path $scriptDirectory "..\.." )).Path
}
$secretPath = Join-Path $env:LOCALAPPDATA "AppCPE\portal-worker\supabase-secret.dpapi"
if (-not (Test-Path -LiteralPath $secretPath)) { throw "Falta la clave cifrada del worker." }

$secureSecret = ConvertTo-SecureString (Get-Content -LiteralPath $secretPath -Raw).Trim()
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
try {
  $env:CPE_SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  Set-Location -LiteralPath $RepositoryPath
  & node "scripts/requeue-cloudflare-lab-job.js" $Chapa
  exit $LASTEXITCODE
} finally {
  $env:CPE_SUPABASE_SECRET_KEY = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
}
