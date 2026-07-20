# s3-fixture-render.ps1 — S-3 golden fixture: owner-draw 960x640 Chinese UI
# rendered DIRECTLY to PNG (DrawToBitmap of the client area) so ground-truth
# pixel coords are exact by construction. No window interaction of any kind.
# Layout: 4 corner buttons + center button + search input + long text label.
param([string]$OutDir = $PSScriptRoot)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr v);' -Name DPI -Namespace FX
try { [FX.DPI]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null } catch {}
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$W = 960; $H = 640
# rect: x,y,w,h  (exact client px)
$rects = [ordered]@{
  btn_file    = @{ r = @(16,  16, 120, 44); text = '文件' }
  btn_setting = @{ r = @(824, 16, 120, 44); text = '设置' }
  btn_help    = @{ r = @(16,  580,120, 44); text = '帮助' }
  btn_ok      = @{ r = @(824, 580,120, 44); text = '确定' }
  btn_play    = @{ r = @(420, 290,120, 60); text = '播放' }
  input_search= @{ r = @(330, 80, 300, 44); text = '' }
  lbl_long    = @{ r = @(16,  200,700, 36); text = '这是一段用于验证长命令定位能力的中文说明文字，请忽略其语义内容。' }
}

$bmp = New-Object Drawing.Bitmap $W, $H
$g = [Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([Drawing.Color]::FromArgb(240, 240, 240))

$fontBtn = New-Object Drawing.Font('Microsoft YaHei', 14)
$fontLbl = New-Object Drawing.Font('Microsoft YaHei', 12)
$brushText = [Drawing.Brushes]::Black
$brushBtn = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(225, 225, 225))
$penBorder = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(90, 90, 90)), 2
$brushInput = [Drawing.Brushes]::White
$fmt = New-Object Drawing.StringFormat
$fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'

foreach ($k in $rects.Keys) {
  $it = $rects[$k]; [int]$x = $it.r[0]; [int]$y = $it.r[1]; [int]$w = $it.r[2]; [int]$h = $it.r[3]
  if ($k -like 'btn_*') {
    $g.FillRectangle($brushBtn, $x, $y, $w, $h)
    $g.DrawRectangle($penBorder, $x, $y, $w, $h)
    $g.DrawString($it.text, $fontBtn, $brushText, (New-Object Drawing.RectangleF($x, $y, $w, $h)), $fmt)
  } elseif ($k -eq 'input_search') {
    $g.FillRectangle($brushInput, $x, $y, $w, $h)
    $g.DrawRectangle($penBorder, $x, $y, $w, $h)
    $fmtL = New-Object Drawing.StringFormat; $fmtL.Alignment = 'Near'; $fmtL.LineAlignment = 'Center'
    $g.DrawString('搜索…', $fontLbl, [Drawing.Brushes]::Gray, (New-Object Drawing.RectangleF(($x+8), $y, ($w-8), $h)), $fmtL)
  } else {
    $fmtL2 = New-Object Drawing.StringFormat; $fmtL2.Alignment = 'Near'; $fmtL2.LineAlignment = 'Center'
    $g.DrawString($it.text, $fontLbl, $brushText, (New-Object Drawing.RectangleF($x, $y, $w, $h)), $fmtL2)
  }
}

# small colored icon-like square top-center (extra non-text target)
$g.FillRectangle([Drawing.Brushes]::CornflowerBlue, 470, 160, 24, 24)
$rects['icon_square'] = @{ r = @(470, 160, 24, 24); text = '' }

$pngPath = Join-Path $OutDir 'fixture.png'
$bmp.Save($pngPath, [Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

# ground truth: center + size per target
$gt = [ordered]@{}
foreach ($k in $rects.Keys) {
  [int]$x = $rects[$k].r[0]; [int]$y = $rects[$k].r[1]; [int]$w = $rects[$k].r[2]; [int]$h = $rects[$k].r[3]
  $gt[$k] = @{ cx = [int]($x + $w / 2); cy = [int]($y + $h / 2); w = $w; h = $h }
}
($gt | ConvertTo-Json -Depth 4) | Out-File -Encoding utf8 (Join-Path $OutDir 'fixture-gt.json')
Write-Output "WROTE $pngPath and fixture-gt.json"
