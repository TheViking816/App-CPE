param(
  [ValidateSet("Common", "Normal", "Reduced")][string]$ScheduleType,
  [string]$RepositoryPath = "",
  [datetime]$Now = (Get-Date),
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

if (-not $holidaysByYear.ContainsKey($Now.Year)) {
  Write-Warning "No hay calendario de festivos configurado para $($Now.Year). Se omite la actualizacion por seguridad."
  exit 0
}

$holidaySet = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($date in $holidaysByYear[$Now.Year]) { $null = $holidaySet.Add($date) }

function Test-Holiday([datetime]$Date) {
  return $holidaySet.Contains($Date.ToString("yyyy-MM-dd"))
}

$todayIsHoliday = Test-Holiday $Now
$todayIsSunday = $Now.DayOfWeek -eq [DayOfWeek]::Sunday
$todayIsSaturday = $Now.DayOfWeek -eq [DayOfWeek]::Saturday
$tomorrowIsHoliday = Test-Holiday $Now.Date.AddDays(1)

if ($todayIsHoliday -or $todayIsSunday) {
  Write-Host "Actualizacion omitida: hoy es domingo o festivo en Valencia."
  exit 0
}

$dayType = if ($todayIsSaturday -or $tomorrowIsHoliday) { "Reduced" } else { "Normal" }
$shouldRun = $ScheduleType -eq "Common" -or $ScheduleType -eq $dayType
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
