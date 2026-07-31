<#
  Добавляет папку приложения в исключения Microsoft Defender,
  чтобы антивирус не удалял распакованный electron.exe.

  ЗАПУСК: правый клик по файлу -> «Запустить с помощью PowerShell»
  ИЛИ в админ-консоли: powershell -ExecutionPolicy Bypass -File add-defender-exclusion.ps1
  Требуются права администратора (появится запрос UAC).
#>
$path = $PSScriptRoot
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$admin = (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $admin) {
    Write-Host "Требуются права администратора — перезапускаю с UAC..." -ForegroundColor Yellow
    Start-Process powershell.exe "-ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    return
}
try {
    Add-MpPreference -ExclusionPath $path -ErrorAction Stop
    Write-Host "OK: папка добавлена в исключения Defender:`n  $path" -ForegroundColor Green
} catch {
    Write-Host "Ошибка: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host "Нажмите Enter для выхода..."; Read-Host | Out-Null
