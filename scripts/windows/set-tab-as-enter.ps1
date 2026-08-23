param(
  [switch]$Restore
)

$ErrorActionPreference = "Stop"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Ejecuta este script como administrador."
}

$keyboardLayout = "HKLM:\SYSTEM\CurrentControlSet\Control\Keyboard Layout"
if ($Restore) {
  Remove-ItemProperty -LiteralPath $keyboardLayout -Name "Scancode Map" -ErrorAction SilentlyContinue
  Write-Host "Mapeo eliminado. Reinicia Windows para recuperar la tecla Tab."
  exit 0
}

[byte[]]$mapping = @(
  0x00,0x00,0x00,0x00, 0x00,0x00,0x00,0x00,
  0x02,0x00,0x00,0x00,
  0x1C,0x00,0x0F,0x00,
  0x00,0x00,0x00,0x00
)
New-ItemProperty -LiteralPath $keyboardLayout -Name "Scancode Map" -PropertyType Binary -Value $mapping -Force | Out-Null
Write-Host "Tab funcionara como Enter despues de reiniciar Windows. Usa -Restore para revertirlo."
