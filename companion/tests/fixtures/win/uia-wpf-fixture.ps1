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
  [int]$Seconds = 45,
  # Test-only finite receipt, not a production control/authorization channel.
  [string]$AcceptanceReady = '',
  [switch]$OwnForeground,
  [string]$AcceptanceTrace = '',
  [string]$AcceptanceRole = ''
)
Microsoft.PowerShell.Utility\Add-Type -AssemblyName PresentationFramework
Microsoft.PowerShell.Utility\Add-Type -AssemblyName PresentationCore
Microsoft.PowerShell.Utility\Add-Type -AssemblyName WindowsBase

$win = Microsoft.PowerShell.Utility\New-Object System.Windows.Window
$win.Title = 'CMspark UIA invoke fixture (WPF)'
$win.Width = 420; $win.Height = 180
$win.WindowStartupLocation = 'CenterScreen'

$btn = Microsoft.PowerShell.Utility\New-Object System.Windows.Controls.Button
$btn.Content = $ButtonText
$btn.Name = 'cmspark_fixture_button'
$btn.Width = 180; $btn.Height = 44
$btn.Add_Click({
  Write-WpfEvent572 'Click' 'enter'
  # The oracle, in two channels: a marker file (machine-checkable) and a visible label
  # change (eye-checkable — a screenshot can show the target-owned state change without
  # trusting any file the harness wrote).
  try {
    if ($AcceptanceReady -ne '') {
      # The acceptance reader observes a complete target-owned marker, never a partial write.
      [IO.File]::WriteAllText($Marker + '.pending', "clicked " + [DateTime]::UtcNow.ToString('o'))
      [IO.File]::Move($Marker + '.pending', $Marker)
    } else {
      [IO.File]::WriteAllText($Marker, "clicked " + [DateTime]::UtcNow.ToString('o'))
    }
  } catch {}
  try { $btn.Content = "Clicked OK" } catch {}
  Write-WpfEvent572 'Click' 'exit'
})
$win.Content = $btn

$timer = Microsoft.PowerShell.Utility\New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds([Math]::Max(5, $Seconds))
$timer.Add_Tick({ $timer.Stop(); $win.Close() })
$timer.Start()

if ($AcceptanceReady -ne '') {
  Microsoft.PowerShell.Utility\Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WpfAcceptanceForeground572 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
}
# Test-only bounded observations; no HWND/path/text is serialized and no focus API is called.
$script:wpfEventSequence572 = 0
function Write-WpfEvent572([string]$EventName, [string]$PhaseName) {
  try {
    if ($AcceptanceReady -eq '' -or $AcceptanceTrace -eq '' -or $AcceptanceRole -notin @('target','sibling')) { return }
    if ($script:wpfEventSequence572 -ge 16) { return }
    if (($EventName -eq 'Click' -and $PhaseName -notin @('enter','exit')) -or ($EventName -ne 'Click' -and ($EventName -notin @('Activated','Deactivated','ContentRendered') -or $PhaseName -ne 'event'))) { return }
    $script:wpfEventSequence572++
    $observedHandle = (Microsoft.PowerShell.Utility\New-Object System.Windows.Interop.WindowInteropHelper($win)).Handle
    $known = $observedHandle -ne [IntPtr]::Zero
    $own = $known -and ([WpfAcceptanceForeground572]::GetForegroundWindow() -eq $observedHandle)
    $record = [ordered]@{ sequence = $script:wpfEventSequence572; event = $EventName; phase = $PhaseName; active = [bool]$win.IsActive; foregroundKnown = [bool]$known; foregroundOwn = [bool]$own }
    $line = $record | Microsoft.PowerShell.Utility\ConvertTo-Json -Compress
    [IO.File]::AppendAllText($AcceptanceTrace, $line + [Environment]::NewLine)
  } catch { # Passive observation must not replace the original event or acceptance.
  }
}
$win.Add_Activated({ Write-WpfEvent572 'Activated' 'event' })
$win.Add_Deactivated({ Write-WpfEvent572 'Deactivated' 'event' })
$win.Add_ContentRendered({
  Write-WpfEvent572 'ContentRendered' 'event'
  try {
    $h = (Microsoft.PowerShell.Utility\New-Object System.Windows.Interop.WindowInteropHelper($win)).Handle
    [IO.File]::WriteAllText($Ready, [string]$h.ToInt64())
    if ($AcceptanceReady -ne '') {
      # One explicit activation of our own sibling; the receipt measures the result.
      if ($OwnForeground) { [void]$win.Activate() }
      $proof = @{ hwnd = $h.ToInt64(); foreground = [WpfAcceptanceForeground572]::GetForegroundWindow().ToInt64(); active = $win.IsActive }
      $json = $proof | Microsoft.PowerShell.Utility\ConvertTo-Json -Compress
      # Fresh owned sibling path. A rename publishes one complete record, not partial JSON.
      $temporary = $AcceptanceReady + '.pending'
      [IO.File]::WriteAllText($temporary, $json)
      [IO.File]::Move($temporary, $AcceptanceReady)
    }
  } catch {}
})
[void]$win.ShowDialog()
