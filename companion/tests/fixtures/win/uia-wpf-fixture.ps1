# uia-wpf-fixture.ps1 — WPF acceptance fixture for #572.
#
# Why WPF and not WinForms: measured 2026-09-30 — a WinForms Button surfaces through UIA
# as a bare `Pane` with NO action patterns, so it cannot be a background target at all.
# WPF has a first-class UIA provider, so its controls expose real patterns
# (Button -> InvokePattern). This is the same reason cua-driver builds source-built
# native harness apps (WPF/WinUI3/WebView2/AppKit) instead of relying on ad-hoc windows.
#
# Clicking the button writes a marker file — the target-owned state-change oracle.
# Bounded lifetime; readiness reported to a FILE (stdout from a UI handler is unreliable).
param(
  [Parameter(Mandatory=$true)][string]$Marker,
  [Parameter(Mandatory=$true)][string]$Ready,
  [string]$ButtonText = 'SubmitTest',
  [int]$Seconds = 45
)
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$win = New-Object System.Windows.Window
$win.Title = 'CMspark UIA invoke fixture (WPF)'
$win.Width = 420; $win.Height = 180
$win.WindowStartupLocation = 'CenterScreen'

$btn = New-Object System.Windows.Controls.Button
$btn.Content = $ButtonText
$btn.Name = 'cmspark_fixture_button'
$btn.Width = 180; $btn.Height = 44
$btn.Add_Click({
  # The oracle, in two channels: a marker file (machine-checkable) and a visible label
  # change (eye-checkable — a screenshot can show the target-owned state change without
  # trusting any file the harness wrote).
  try { [IO.File]::WriteAllText($Marker, "clicked " + [DateTime]::UtcNow.ToString('o')) } catch {}
  try { $btn.Content = "Clicked OK" } catch {}
})
$win.Content = $btn

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds([Math]::Max(5, $Seconds))
$timer.Add_Tick({ $timer.Stop(); $win.Close() })
$timer.Start()

$win.Add_ContentRendered({
  try {
    $h = (New-Object System.Windows.Interop.WindowInteropHelper($win)).Handle
    [IO.File]::WriteAllText($Ready, [string]$h.ToInt64())
  } catch {}
})
[void]$win.ShowDialog()
