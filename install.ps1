<#
  Установка 1С DevOps Studio для запуска по ярлыку.
  - генерирует иконку icon.ico
  - создаёт ярлыки на Рабочем столе и в меню Пуск (Target -> electron.exe)
  Права администратора НЕ нужны. Для исключения Defender — add-defender-exclusion.ps1.

  Запуск: правый клик -> «Запустить с помощью PowerShell»
       или: powershell -ExecutionPolicy Bypass -File install.ps1
#>
$ErrorActionPreference = 'Stop'
$App   = $PSScriptRoot
$Exe   = Join-Path $App 'node_modules\electron\dist\electron.exe'
$Ico   = Join-Path $App 'icon.ico'
$Name  = '1С DevOps Studio'

if (-not (Test-Path $Exe)) {
    Write-Host "electron.exe не найден: $Exe" -ForegroundColor Red
    Write-Host "Сначала выполните: npm install (в папке приложения)." -ForegroundColor Yellow
    Read-Host 'Enter для выхода'; return
}

# ---------- 1. Иконка (чёрный квадрат + белое «1С», PNG-ICO 256px) ----------
Add-Type -AssemblyName System.Drawing
function New-RoundedPath([int]$x,[int]$y,[int]$w,[int]$h,[int]$r){
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r*2
    $p.AddArc($x,$y,$d,$d,180,90)
    $p.AddArc($x+$w-$d,$y,$d,$d,270,90)
    $p.AddArc($x+$w-$d,$y+$h-$d,$d,$d,0,90)
    $p.AddArc($x,$y+$h-$d,$d,$d,90,90)
    $p.CloseFigure(); return $p
}
$sz = 256
$bmp = New-Object System.Drawing.Bitmap($sz,$sz)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear([System.Drawing.Color]::Transparent)
$path = New-RoundedPath 12 12 232 232 46
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(13,17,23))), $path)
$g.DrawPath((New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(48,54,61),4)), $path)
$font = New-Object System.Drawing.Font('Segoe UI',96,[System.Drawing.FontStyle]::Bold,[System.Drawing.GraphicsUnit]::Pixel)
$sf = New-Object System.Drawing.StringFormat; $sf.Alignment='Center'; $sf.LineAlignment='Center'
$g.DrawString('1С',$font,[System.Drawing.Brushes]::White,(New-Object System.Drawing.RectangleF(0,-6,$sz,$sz)),$sf)
$g.Dispose()
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
$png = $ms.ToArray()
$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($out)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)     # reserved, type=icon, count
$bw.Write([Byte]0);  $bw.Write([Byte]0)                              # 256x256 (0=256)
$bw.Write([Byte]0);  $bw.Write([Byte]0)                              # colors, reserved
$bw.Write([UInt16]1); $bw.Write([UInt16]32)                         # planes, bpp
$bw.Write([UInt32]$png.Length); $bw.Write([UInt32]22)               # size, offset
$bw.Write($png); $bw.Flush()
[System.IO.File]::WriteAllBytes($Ico, $out.ToArray())
Write-Host "Иконка: $Ico" -ForegroundColor Green

# ---------- 2. Ярлыки ----------
function New-Shortcut([string]$lnkPath){
    $ws = New-Object -ComObject WScript.Shell
    $sc = $ws.CreateShortcut($lnkPath)
    $sc.TargetPath       = $Exe
    $sc.Arguments        = '"' + $App + '"'
    $sc.WorkingDirectory = $App
    $sc.IconLocation     = $Ico
    $sc.Description       = '1С DevOps Studio — git и сборка 1С'
    $sc.Save()
}
$desktop = [Environment]::GetFolderPath('Desktop')
New-Shortcut (Join-Path $desktop "$Name.lnk")
Write-Host "Ярлык на рабочем столе создан." -ForegroundColor Green

$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) "$Name"
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
New-Shortcut (Join-Path $startMenu "$Name.lnk")
Write-Host "Ярлык в меню Пуск создан." -ForegroundColor Green

Write-Host ""
Write-Host "Готово. Запускайте приложение по ярлыку «$Name»." -ForegroundColor Cyan
Write-Host "Совет: для защиты от удаления electron.exe антивирусом запустите add-defender-exclusion.ps1 (от админа)." -ForegroundColor DarkGray
