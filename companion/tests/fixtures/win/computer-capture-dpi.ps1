# Run in a fresh Windows PowerShell -MTA process on a never-displayed desktop.
# The STATIC control paints a known bitmap in the target window's own DPI units.
param(
  [Parameter(Mandatory=$true)][ValidateSet('unaware','system','per-monitor')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$Capture
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CaptureDpiFixture {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr CreateDesktop(string name, IntPtr device, IntPtr mode, int flags, uint access, IntPtr security);
  [DllImport("user32.dll")] public static extern bool SetThreadDesktop(IntPtr desktop);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern IntPtr GetThreadDpiAwarenessContext();
  [DllImport("user32.dll")] public static extern IntPtr GetWindowDpiAwarenessContext(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AreDpiAwarenessContextsEqual(IntPtr first, IntPtr second);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr CreateWindowEx(int exStyle, string cls, string title, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr module, IntPtr param);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int mode);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect rect);
  public static bool MatchesTarget(IntPtr h) {
    return AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(), GetWindowDpiAwarenessContext(h));
  }
}
'@
$zero = [IntPtr]::Zero
$desktop = [CaptureDpiFixture]::CreateDesktop([guid]::NewGuid().ToString(), $zero, $zero, 0, 0x01ff, $zero)
if ($desktop -eq $zero -or -not [CaptureDpiFixture]::SetThreadDesktop($desktop)) { throw 'Private desktop unavailable' }
$physical = [IntPtr]::new(-4)
[void][CaptureDpiFixture]::SetProcessDpiAwarenessContext($physical)
$context = @{ 'unaware' = -1; 'system' = -2; 'per-monitor' = -4 }[$Mode]
if ([CaptureDpiFixture]::SetThreadDpiAwarenessContext([IntPtr]::new($context)) -eq $zero) { throw 'Target DPI context unavailable' }
# WS_POPUP | WS_VISIBLE | SS_BITMAP, no title bar or client border.
$hwnd = [CaptureDpiFixture]::CreateWindowEx(0, 'STATIC', 'CMspark DPI fixture', 0x9000000eL, 20, 20, 360, 240, $zero, $zero, $zero, $zero)
if ($hwnd -eq $zero -or -not [CaptureDpiFixture]::MatchesTarget($hwnd)) { throw 'Window did not acquire target DPI context' }
$pattern = New-Object Drawing.Bitmap(360, 240)
$graphics = [Drawing.Graphics]::FromImage($pattern)
try {
  $graphics.Clear([Drawing.Color]::White)
  $graphics.FillRectangle([Drawing.Brushes]::Red, 270, 168, 60, 50)
  [void][CaptureDpiFixture]::SendMessage($hwnd, 0x172, $zero, $pattern.GetHbitmap()) # STM_SETIMAGE
} finally { $graphics.Dispose(); $pattern.Dispose() }
[void][CaptureDpiFixture]::ShowWindow($hwnd, 5)
$targetRect = New-Object CaptureDpiFixture+Rect
if (-not [CaptureDpiFixture]::GetWindowRect($hwnd, [ref]$targetRect)) { throw 'Target bounds unavailable' }
if ([CaptureDpiFixture]::SetThreadDpiAwarenessContext($physical) -eq $zero) { throw 'Physical DPI context unavailable' }
$rect = New-Object CaptureDpiFixture+Rect
if (-not [CaptureDpiFixture]::GetWindowRect($hwnd, [ref]$rect)) { throw 'Physical bounds unavailable' }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
$png = Join-Path ([IO.Path]::GetTempPath()) ('cmspark-dpi-' + [guid]::NewGuid() + '.png')
$variant = $png + '.ps1'
try {
  # At equal scales the pixels alone cannot distinguish a wrong caller context.
  # Observe that context immediately before the original, unaltered PrintWindow.
  $observe = $width -eq ($targetRect.Right - $targetRect.Left) -and -not [CaptureDpiFixture]::MatchesTarget($hwnd)
  if ($observe) {
    $source = [IO.File]::ReadAllText($Capture)
    $call = '$printed = [CapW32]::PrintWindow($hwndPtr, $hdc, 2)'
    if ($source.IndexOf($call) -lt 0 -or $source.IndexOf($call) -ne $source.LastIndexOf($call)) { throw 'Expected one native PrintWindow call' }
    $check = 'if (-not [CaptureDpiFixture]::MatchesTarget($hwndPtr)) { throw "PrintWindow caller DPI differs from target" }'
    [IO.File]::WriteAllText($variant, $source.Replace($call, $check + [Environment]::NewLine + $call), [Text.UTF8Encoding]::new($true))
    $Capture = $variant
  }
  $meta = & $Capture -Hwnd $hwnd.ToInt64() -OutPath $png -Passive | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or -not $meta.ok -or $meta.capture_method -ne 'printwindow' -or $meta.fallbackUsed) { throw 'Native PrintWindow required' }
  if (-not [CaptureDpiFixture]::AreDpiAwarenessContextsEqual([CaptureDpiFixture]::GetThreadDpiAwarenessContext(), $physical)) { throw 'Physical DPI context was not restored' }
  if ($meta.rect.x -ne $rect.Left -or $meta.rect.y -ne $rect.Top -or $meta.rect.width -ne $width -or $meta.rect.height -ne $height) { throw 'Capture rectangle differs from physical window' }
  if ($meta.client.x -ne 0 -or $meta.client.y -ne 0 -or $meta.client.width -ne $width -or $meta.client.height -ne $height) { throw 'Client rectangle differs from physical client' }
  $image = [Drawing.Bitmap]::FromFile($png)
  try {
    if ($image.Width -ne $width -or $image.Height -ne $height) { throw 'PNG differs from physical window size' }
    $red = $image.GetPixel([int]($width * 300 / 360), [int]($height * 192 / 240))
    $white = $image.GetPixel([int]($width * 0.94), [int]($height * 0.94))
    if ($red.ToArgb() -ne [Drawing.Color]::Red.ToArgb() -or $white.ToArgb() -ne [Drawing.Color]::White.ToArgb()) { throw 'Known target pixels missing at physical coordinates' }
  } finally { $image.Dispose() }
  @{ mode=$Mode; targetDpi=$meta.dpi; activityDpi=$meta.activity_dpi; width=$width; height=$height; observedCall=$observe } | ConvertTo-Json -Compress
} finally { [IO.File]::Delete($png); [IO.File]::Delete($variant) }
