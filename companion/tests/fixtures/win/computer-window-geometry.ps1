# Run in a dedicated Windows PowerShell -MTA process. Its thread attaches to a
# new, never-displayed desktop. Process exit releases the window and desktop.
param([Parameter(Mandatory=$true)][string]$Scripts)
$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GeometryFixture {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr CreateDesktop(string name, IntPtr device, IntPtr mode, int flags, uint access, IntPtr security);
  [DllImport("user32.dll")] public static extern bool SetThreadDesktop(IntPtr desktop);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr CreateWindowEx(int exStyle, string cls, string title, int style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr module, IntPtr param);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
}
'@
$zero = [IntPtr]::Zero
$desktop = [GeometryFixture]::CreateDesktop([guid]::NewGuid().ToString(), $zero, $zero, 0, 0x01ff, $zero)
if ($desktop -eq $zero -or -not [GeometryFixture]::SetThreadDesktop($desktop)) { throw 'Private desktop unavailable' }
[void][GeometryFixture]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))
$title = 'CMspark ' + [char]::ConvertFromUtf32(0x1f9ea) + [char]0x6d4b
$hwnd = [GeometryFixture]::CreateWindowEx(0, 'STATIC', $title, 0x10cf0000, 36, 48, 560, 400, $zero, $zero, $zero, $zero)
if ($hwnd -eq $zero) { throw 'Fixture window unavailable' }
# A console-suppressed child can inherit SW_HIDE as its initial show state.
[void][GeometryFixture]::ShowWindow($hwnd, 5)

$enumeration = & (Join-Path $Scripts 'computer-windows.ps1') -ExePath (Get-Process -Id $PID).Path | ConvertFrom-Json
$windows = @($enumeration.windows | Where-Object { $_.hwnd -eq $hwnd.ToInt64() })
if ($windows.Count -ne 1 -or $windows[0].title -cne $title) { throw 'Window title or identity lost during enumeration' }
function Assert-Geometry($rect) {
  if ($rect.x -ne 36 -or $rect.y -ne 48 -or $rect.width -ne 560 -or $rect.height -ne 400) { throw 'Window rectangle mismatch' }
}
Assert-Geometry $windows[0].rect

[void][GeometryFixture]::ShowWindow($hwnd, 6)
if (-not [GeometryFixture]::IsIconic($hwnd)) { throw 'Fixture was not minimized' }
$output = Join-Path ([IO.Path]::GetTempPath()) ('cmspark-geometry-' + [guid]::NewGuid() + '.png')
try {
  $capture = & (Join-Path $Scripts 'computer-capture.ps1') -Hwnd $hwnd.ToInt64() -OutPath $output | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or -not $capture.ok -or -not $capture.restoredFromIconic -or $capture.capture_method -ne 'printwindow') { throw 'Restored capture failed' }
  Assert-Geometry $capture.rect
  $bitmap = [System.Drawing.Image]::FromFile($output)
  try { if ($bitmap.Width -ne 560 -or $bitmap.Height -ne 400) { throw 'Restored bitmap dimensions mismatch' } }
  finally { $bitmap.Dispose() }
} finally { [IO.File]::Delete($output) }

[void][GeometryFixture]::ShowWindow($hwnd, 3)
if (-not [GeometryFixture]::IsZoomed($hwnd)) { throw 'Fixture was not maximized' }
[void][CapW32]::ForceForeground($hwnd)
if (-not [GeometryFixture]::IsZoomed($hwnd)) { throw 'Capture foreground helper resized target' }
$focus = & (Join-Path $Scripts 'computer-input.ps1') -Hwnd $hwnd.ToInt64() -Mode force-fg -Action click | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $focus.action -ne 'force-fg' -or -not [GeometryFixture]::IsZoomed($hwnd)) { throw 'Focus-only recovery resized target' }
'PASS'
