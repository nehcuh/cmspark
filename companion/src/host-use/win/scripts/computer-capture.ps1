# computer-capture.ps1 — coordinate computer-use WP1 screenshot capture.
# Strategy (plan D.1): PrintWindow(PW_RENDERFULLCONTENT) first -> black-image
# detection (near-zero pixel variance = S-4 OSR marker) -> optional BitBlt
# fallback after force-foregrounding the target window.
# DPI: PerMonitorV2 process context; ALL coordinates are physical pixels.
#
# stdout contract: single-line JSON metadata document.
# stderr contract: typed prefixes on failure —
#   HWNDDEAD:<detail>     target hwnd is not a live window
#   CAPTUREFAILED:<detail> all strategies failed (e.g. minimized + PrintWindow black w/o fallback)
param(
  [Parameter(Mandatory=$true)][long]$Hwnd,
  [Parameter(Mandatory=$true)][string]$OutPath,
  # Allow the BitBlt fallback (force-foregrounds the window — visible side effect).
  [switch]$AllowFallback,
  # Internal: crop an EXISTING image file instead of capturing (used by the
  # evidence/danger pipeline for region crops; no window interaction).
  [string]$CropOf = "",
  [int]$CropX = 0, [int]$CropY = 0, [int]$CropW = 0, [int]$CropH = 0
)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr v);' -Name DPI -Namespace CU
try { [CU.DPI]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null } catch {}

Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class CapW32 {
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  public const uint SRCCOPY = 0x00CC0020;
  public static bool ForceForeground(IntPtr hwnd){
    ShowWindow(hwnd, 9); // SW_RESTORE
    IntPtr fg = GetForegroundWindow(); uint dummy;
    uint fgTid = GetWindowThreadProcessId(fg, out dummy);
    uint myTid = GetCurrentThreadId(); bool ok = false;
    if (fgTid != myTid) AttachThreadInput(myTid, fgTid, true);
    try { ok = SetForegroundWindow(hwnd); BringWindowToTop(hwnd); }
    finally { if (fgTid != myTid) AttachThreadInput(myTid, fgTid, false); }
    return ok;
  }
}
'@

function Fail([string]$prefix, [string]$detail, [int]$code) {
  [Console]::Error.WriteLine("${prefix}:$detail")
  exit $code
}

function Test-BlackImage([System.Drawing.Bitmap]$bmp) {
  # Near-zero variance across a sparse sample = black/failed render (S-4 marker).
  $w = $bmp.Width; $h = $bmp.Height
  if ($w -lt 2 -or $h -lt 2) { return $true }
  $step = [Math]::Max(1, [int]([Math]::Min($w, $h) / 48))
  $min = 255; $max = 0; $sum = 0.0; $sum2 = 0.0; $n = 0
  for ($y = 0; $y -lt $h; $y += $step) {
    for ($x = 0; $x -lt $w; $x += $step) {
      $c = $bmp.GetPixel($x, $y)
      $lum = [int](($c.R + $c.G + $c.B) / 3)
      if ($lum -lt $min) { $min = $lum }
      if ($lum -gt $max) { $max = $lum }
      $sum += $lum; $sum2 += ($lum * $lum); $n++
    }
  }
  if ($n -eq 0) { return $true }
  $mean = $sum / $n
  $var = ($sum2 / $n) - ($mean * $mean)
  return (($max - $min) -le 4 -and $var -le 4.0)
}

# ---- crop-only mode (no window interaction) --------------------------------
if ($CropOf -ne "") {
  try {
    $src = [System.Drawing.Bitmap]::FromFile($CropOf)
    $cx = [Math]::Max(0, $CropX); $cy = [Math]::Max(0, $CropY)
    $cw = [Math]::Min($CropW, $src.Width - $cx); $ch = [Math]::Min($CropH, $src.Height - $cy)
    if ($cw -le 0 -or $ch -le 0) { Fail "CAPTUREFAILED" "crop rect outside image ($CropX,$CropY,$CropW,$CropH of $($src.Width)x$($src.Height))" 6 }
    $dst = New-Object System.Drawing.Bitmap($cw, $ch)
    $g = [System.Drawing.Graphics]::FromImage($dst)
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $cw, $ch)), (New-Object System.Drawing.Rectangle($cx, $cy, $cw, $ch)), [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    $outDir = Split-Path $OutPath -Parent
    if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
    $dst.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $sha = (Get-FileHash $OutPath -Algorithm SHA256).Hash.ToLower()
    $dst.Dispose(); $src.Dispose()
    Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
      ok = $true; mode = "crop"; path = $OutPath; sha256 = $sha
      rect = @{ x = 0; y = 0; width = $cw; height = $ch }
    }))
    exit 0
  } catch {
    Fail "CAPTUREFAILED" "crop: $($_.Exception.Message)" 6
  }
}

# ---- capture mode -----------------------------------------------------------
$hwndPtr = [IntPtr]::new($Hwnd)
if (-not [CapW32]::IsWindow($hwndPtr)) { Fail "HWNDDEAD" "hwnd $Hwnd is not a live window" 4 }

$r = New-Object CapW32+RECT
[CapW32]::GetWindowRect($hwndPtr, [ref]$r) | Out-Null
$width = $r.Right - $r.Left; $height = $r.Bottom - $r.Top
if ($width -le 0 -or $height -le 0) { Fail "HWNDDEAD" "hwnd $Hwnd has an empty rect" 4 }

$wasIconic = [CapW32]::IsIconic($hwndPtr)
if ($wasIconic) { [CapW32]::ShowWindow($hwndPtr, 9) | Out-Null; Start-Sleep -Milliseconds 250 }

$dpi = 96
try { $dpi = [int][CapW32]::GetDpiForWindow($hwndPtr); if ($dpi -le 0) { $dpi = 96 } } catch {}

$outDir = Split-Path $OutPath -Parent
if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

# Strategy 1: PrintWindow(PW_RENDERFULLCONTENT = 2)
$bmp = New-Object System.Drawing.Bitmap($width, $height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$printed = [CapW32]::PrintWindow($hwndPtr, $hdc, 2)
$g.ReleaseHdc($hdc); $g.Dispose()
$black = $true
if ($printed) { $black = Test-BlackImage $bmp }

$fallbackUsed = $false
$osrBlackSuspected = $false
if ((-not $printed) -or $black) {
  # S-4: PrintWindow path failed or returned an all-black frame (typical for
  # OSR/CEF owner-drawn surfaces). Record it, then BitBlt fallback if allowed.
  $osrBlackSuspected = $true
  if (-not $AllowFallback) {
    $bmp.Dispose()
    Fail "CAPTUREFAILED" "PrintWindow produced no usable pixels (black=$black, printed=$printed) and fallback is disabled" 6
  }
  $bmp.Dispose()
  [CapW32]::ForceForeground($hwndPtr) | Out-Null
  Start-Sleep -Milliseconds 250
  # Re-read rect after restore/foreground.
  [CapW32]::GetWindowRect($hwndPtr, [ref]$r) | Out-Null
  $width = $r.Right - $r.Left; $height = $r.Bottom - $r.Top
  if ($width -le 0 -or $height -le 0) { Fail "HWNDDEAD" "hwnd $Hwnd rect collapsed after foreground" 4 }
  $bmp = New-Object System.Drawing.Bitmap($width, $height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdcDst = $g.GetHdc()
  $hdcSrc = [CapW32]::GetDC([IntPtr]::Zero)
  $ok = [CapW32]::BitBlt($hdcDst, 0, 0, $width, $height, $hdcSrc, $r.Left, $r.Top, [CapW32]::SRCCOPY)
  $g.ReleaseHdc($hdcDst); [CapW32]::ReleaseDC([IntPtr]::Zero, $hdcSrc) | Out-Null; $g.Dispose()
  if (-not $ok) { $bmp.Dispose(); Fail "CAPTUREFAILED" "BitBlt fallback failed" 6 }
  $black = Test-BlackImage $bmp
  if ($black) { $bmp.Dispose(); Fail "CAPTUREFAILED" "BitBlt fallback still black (window occluded or hardware-excluded)" 6 }
  $fallbackUsed = $true
}

$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$sha = (Get-FileHash $OutPath -Algorithm SHA256).Hash.ToLower()

# Client area in IMAGE coordinates (the bitmap covers the FULL window rect,
# title bar included): OCR word boxes are image-space; the input injector
# wants client-space — subtract this offset. (A5: physical pixels, PerMonitorV2.)
$cr = New-Object CapW32+RECT
[CapW32]::GetClientRect($hwndPtr, [ref]$cr) | Out-Null
$cpt = New-Object CapW32+POINT
$cpt.X = 0; $cpt.Y = 0
[CapW32]::ClientToScreen($hwndPtr, [ref]$cpt) | Out-Null
$clientOffX = $cpt.X - $r.Left; $clientOffY = $cpt.Y - $r.Top

Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
  ok = $true
  hwnd = $Hwnd
  rect = @{ x = $r.Left; y = $r.Top; width = $width; height = $height }
  client = @{ x = $clientOffX; y = $clientOffY; width = ($cr.Right - $cr.Left); height = ($cr.Bottom - $cr.Top) }
  dpi = $dpi
  path = $OutPath
  sha256 = $sha
  black = $black
  fallbackUsed = $fallbackUsed
  osrBlackSuspected = $osrBlackSuspected
  restoredFromIconic = $wasIconic
}))
exit 0
