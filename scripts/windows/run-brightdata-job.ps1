param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-fA-F-]{36}$')]
  [string]$JobId,
  [string]$RepositoryPath = ""
)

$ErrorActionPreference = "Stop"
if (-not $RepositoryPath) {
  $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
  $RepositoryPath = (Resolve-Path (Join-Path $scriptDirectory "..\.." )).Path
}
$supabaseSecretPath = Join-Path $env:LOCALAPPDATA "AppCPE\portal-worker\supabase-secret.dpapi"
$brightDataSecretPath = Join-Path $env:LOCALAPPDATA "AppCPE\brightdata\browser-endpoint.dpapi"

foreach ($requiredPath in @($supabaseSecretPath, $brightDataSecretPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Falta la credencial cifrada: $requiredPath"
  }
}

$supabaseSecure = ConvertTo-SecureString (Get-Content -LiteralPath $supabaseSecretPath -Raw).Trim()
$brightDataSecure = ConvertTo-SecureString (Get-Content -LiteralPath $brightDataSecretPath -Raw).Trim()
$supabasePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($supabaseSecure)
$brightDataPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($brightDataSecure)

try {
  $env:CPE_SUPABASE_URL = "https://wvwdiywtlbffumshbboa.supabase.co"
  $env:CPE_SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($supabasePointer)
  $env:BRIGHTDATA_BROWSER_WS_ENDPOINT = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($brightDataPointer)
  $env:CPE_PORTAL_HEADLESS = "true"

  Set-Location -LiteralPath $RepositoryPath
  & node "scripts/sync-portal-oficial-job.js" $JobId
  exit $LASTEXITCODE
}
finally {
  $env:CPE_SUPABASE_SECRET_KEY = $null
  $env:BRIGHTDATA_BROWSER_WS_ENDPOINT = $null
  $env:CPE_PORTAL_HEADLESS = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($supabasePointer)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($brightDataPointer)
}
