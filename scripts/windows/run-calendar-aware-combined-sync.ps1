param(
  [ValidateSet("Common", "Normal", "Reduced", "MonthRollover")][string]$ScheduleType,
  [string]$RepositoryPath = "",
  [datetime]$Now = (Get-Date),
  [string]$RolloverStatePath = "",
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"
if (-not $RepositoryPath) {
  $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
  $RepositoryPath = (Resolve-Path (Join-Path $scriptDirectory "..\.." )).Path
}

# Festivos nacionales, autonomicos y locales de la ciudad de Valencia para 2026.
# Fuente: calendario de dias inhabiles y festivos de la Sede del Ayuntamiento.
$holidaysByYear = @{
  2026 = @(
    "2026-01-01", "2026-01-06", "2026-01-22", "2026-03-19",
    "2026-04-03", "2026-04-06", "2026-04-13", "2026-05-01",
    "2026-06-24", "2026-08-15", "2026-10-09", "2026-10-12",
    "2026-12-08", "2026-12-25"
  )
}

$isMonthRollover = $ScheduleType -eq "MonthRollover"
if ($isMonthRollover) {
  if (-not $RolloverStatePath) {
    $RolloverStatePath = Join-Path $env:LOCALAPPDATA "AppCPE\calendar-sync-state.json"
  }
  $monthKey = $Now.ToString("yyyy-MM")
  $lastRolloverMonth = ""
  if (Test-Path -LiteralPath $RolloverStatePath) {
    try {
      $lastRolloverMonth = [string]((Get-Content -LiteralPath $RolloverStatePath -Raw | ConvertFrom-Json).lastRolloverMonth)
    } catch {
      Write-Warning "No se pudo leer el estado del cambio de mes; se reintentara la actualizacion."
    }
  }
  if ($lastRolloverMonth -eq $monthKey) {
    Write-Host "Actualizacion omitida: el cambio de mes $monthKey ya se completo."
    exit 0
  }
}

if (-not $isMonthRollover -and -not $holidaysByYear.ContainsKey($Now.Year)) {
  Write-Warning "No hay calendario de festivos configurado para $($Now.Year). Se omite la actualizacion por seguridad."
  exit 0
}

$holidaySet = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($date in @($holidaysByYear[$Now.Year])) { $null = $holidaySet.Add($date) }

function Test-Holiday([datetime]$Date) {
  return $holidaySet.Contains($Date.ToString("yyyy-MM-dd"))
}

$todayIsHoliday = Test-Holiday $Now
$todayIsSunday = $Now.DayOfWeek -eq [DayOfWeek]::Sunday
$todayIsSaturday = $Now.DayOfWeek -eq [DayOfWeek]::Saturday
$tomorrowIsHoliday = Test-Holiday $Now.Date.AddDays(1)

if (-not $isMonthRollover -and ($todayIsHoliday -or $todayIsSunday)) {
  Write-Host "Actualizacion omitida: hoy es domingo o festivo en Valencia."
  exit 0
}

$dayType = if ($todayIsSaturday -or $tomorrowIsHoliday) { "Reduced" } else { "Normal" }
$shouldRun = $isMonthRollover -or $ScheduleType -eq "Common" -or $ScheduleType -eq $dayType
if (-not $shouldRun) {
  Write-Host "Actualizacion omitida: el horario $ScheduleType no corresponde a una jornada $dayType."
  exit 0
}

Write-Host "Calendario validado: jornada $dayType, horario $ScheduleType."
if ($CheckOnly) { exit 0 }

$combinedRunner = Join-Path $RepositoryPath "scripts\windows\run-combined-current-sync.ps1"
if (-not (Test-Path -LiteralPath $combinedRunner)) { throw "No existe el script de actualizacion combinada." }

# Se ejecuta de forma sincrona para que el Programador de tareas reciba el
# resultado real. El runner operativo prepara su propio Chrome gateway.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $combinedRunner -RepositoryPath $RepositoryPath
$combinedExitCode = $LASTEXITCODE
if ($combinedExitCode -ne 0) {
  throw "La actualizacion combinada termino con codigo $combinedExitCode."
}

if ($isMonthRollover) {
  $secretPath = Join-Path $env:LOCALAPPDATA "AppCPE\portal-worker\supabase-secret.dpapi"
  if (-not (Test-Path -LiteralPath $secretPath)) {
    throw "No existe la clave cifrada para validar el cambio de mes."
  }
  $secureSecret = ConvertTo-SecureString (Get-Content -LiteralPath $secretPath -Raw).Trim()
  $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
  try {
    $env:CPE_SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    & node (Join-Path $RepositoryPath "scripts\verify-rest-month-window.js") $monthKey
    $validationExitCode = $LASTEXITCODE
  } finally {
    $env:CPE_SUPABASE_SECRET_KEY = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  }
  if ($validationExitCode -ne 0) {
    throw "El cambio de mes sigue incompleto para uno o mas perfiles; se reintentara en la proxima ejecucion."
  }

  $stateDirectory = Split-Path -Parent $RolloverStatePath
  if (-not (Test-Path -LiteralPath $stateDirectory)) {
    New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
  }
  @{
    lastRolloverMonth = $monthKey
    completedAt = (Get-Date).ToString("o")
  } | ConvertTo-Json | Set-Content -LiteralPath $RolloverStatePath -Encoding UTF8
  Write-Host "Cambio de mes $monthKey marcado como completado."
}
