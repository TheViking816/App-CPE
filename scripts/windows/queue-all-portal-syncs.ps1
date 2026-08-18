param(
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path
)

$ErrorActionPreference = "Stop"
$taskName = "App CPE Portal Worker"
$secretPath = Join-Path $env:LOCALAPPDATA "AppCPE\portal-worker\supabase-secret.dpapi"

if (-not (Test-Path -LiteralPath $secretPath)) {
  throw "No existe la clave cifrada del worker."
}

$encryptedSecret = (Get-Content -LiteralPath $secretPath -Raw).Trim()
$secureSecret = ConvertTo-SecureString $encryptedSecret
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)

try {
  $env:CPE_SUPABASE_URL = "https://wvwdiywtlbffumshbboa.supabase.co"
  $env:CPE_SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  Set-Location -LiteralPath $RepositoryPath
  & node "scripts/queue-all-portal-syncs.js"
  if ($LASTEXITCODE -ne 0) { throw "No se pudieron crear los trabajos." }

  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  if ($task.State -ne "Running") {
    Start-ScheduledTask -TaskName $taskName
    Write-Host "Worker iniciado."
  }
  Write-Host "La cola se procesara en tandas de hasta 10."
}
finally {
  $env:CPE_SUPABASE_SECRET_KEY = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
}
