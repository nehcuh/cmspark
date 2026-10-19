# Owned Windows-only acceptance controls; no production provider substitution.
param(
  [Parameter(Mandatory=$true)][ValidateSet('target','sibling')][string]$Role,
  [Parameter(Mandatory=$true)][ValidateSet('setvalue','select','toggle','scroll')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$Marker,
  [Parameter(Mandatory=$true)][string]$Ready
)
$ErrorActionPreference = 'Stop'
Microsoft.PowerShell.Utility\Add-Type -AssemblyName PresentationFramework
Microsoft.PowerShell.Utility\Add-Type -AssemblyName PresentationCore
Microsoft.PowerShell.Utility\Add-Type -AssemblyName WindowsBase
Microsoft.PowerShell.Utility\Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OwnedModesForeground572 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
$win = Microsoft.PowerShell.Utility\New-Object System.Windows.Window
$win.Title = 'CMspark owned UIA mode acceptance'
$win.Width = 640; $win.Height = 480
$win.WindowStartupLocation = 'CenterScreen'
$panel = Microsoft.PowerShell.Utility\New-Object System.Windows.Controls.StackPanel
$panel.Margin = [Windows.Thickness]::new(30)
$script:armed572 = $false
function Publish-OwnedMode572 {
  if (-not $script:armed572 -or [IO.File]::Exists($Marker)) { return }
  $value = [ordered]@{ schema = 1; role = $Role; mode = $Mode; changed = $true }
  [IO.File]::WriteAllText($Marker + '.pending', ($value | Microsoft.PowerShell.Utility\ConvertTo-Json -Compress))
  [IO.File]::Move($Marker + '.pending', $Marker)
}
if ($Role -eq 'sibling') {
  $control = Microsoft.PowerShell.Utility\New-Object System.Windows.Controls.Button
  $control.Content = 'ForegroundSibling'
  $control.Width = 200; $control.Height = 40
  $control.Add_Click({ Publish-OwnedMode572 })
  [void]$panel.Children.Add($control)
} elseif ($Mode -eq 'setvalue') {
  $control = Microsoft.PowerShell.Utility\New-Object System.Windows.Controls.TextBox
  $control.Width = 220; $control.Height = 40
  [Windows.Automation.AutomationProperties]::SetName($control, 'OwnedSetValue572')
  [Windows.Automation.AutomationProperties]::SetAutomationId($control, 'owned_setvalue572')
  $control.Add_TextChanged({ if ($control.Text -ceq 'Owned572 中文 value') { Publish-OwnedMode572 } })
  [void]$panel.Children.Add($control)
} elseif ($Mode -eq 'select') {
  $list = Microsoft.PowerShell.Utility\New-Object System.Windows.Controls.ListBox
  $list.Width = 220; $list.Height = 90
  $first = Microsoft.PowerShell.Utility\New-Object System.Windows.Controls.ListBoxItem
  $first.Content = 'Original selection'
  $control = Microsoft.PowerShell.Utility\New-Object System.Windows.Controls.ListBoxItem
  $control.Content = 'OwnedSelect572'
  [Windows.Automation.AutomationProperties]::SetName($control, 'OwnedSelect572')
  [Windows.Automation.AutomationProperties]::SetAutomationId($control, 'owned_select572')
  [void]$list.Items.Add($first); [void]$list.Items.Add($control); $list.SelectedIndex = 0
  $list.Add_SelectionChanged({ if ($list.SelectedItem -eq $control) { Publish-OwnedMode572 } })
  [void]$panel.Children.Add($list)
} elseif ($Mode -eq 'toggle') {
  $control = Microsoft.PowerShell.Utility\New-Object System.Windows.Controls.CheckBox
  $control.Content = 'OwnedToggle572'; $control.IsChecked = $false
  $control.Width = 220; $control.Height = 40
  [Windows.Automation.AutomationProperties]::SetName($control, 'OwnedToggle572')
  [Windows.Automation.AutomationProperties]::SetAutomationId($control, 'owned_toggle572')
  $control.Add_Checked({ if ($control.IsChecked -eq $true) { Publish-OwnedMode572 } })
  [void]$panel.Children.Add($control)
} else {
  $control = Microsoft.PowerShell.Utility\New-Object System.Windows.Controls.ScrollViewer
  $control.Width = 220; $control.Height = 100
  $control.VerticalScrollBarVisibility = 'Auto'; $control.HorizontalScrollBarVisibility = 'Disabled'
  [Windows.Automation.AutomationProperties]::SetName($control, 'OwnedScroll572')
  [Windows.Automation.AutomationProperties]::SetAutomationId($control, 'owned_scroll572')
  $content = Microsoft.PowerShell.Utility\New-Object System.Windows.Controls.StackPanel
  for ($i = 0; $i -lt 30; $i++) {
    $line = Microsoft.PowerShell.Utility\New-Object System.Windows.Controls.TextBlock
    $line.Text = 'Owned scroll content'; $line.Height = 25
    [void]$content.Children.Add($line)
  }
  $control.Content = $content
  $control.Add_ScrollChanged({ if ($control.VerticalOffset -gt 0) { Publish-OwnedMode572 } })
  [void]$panel.Children.Add($control)
}
$win.Content = $panel
$timer = Microsoft.PowerShell.Utility\New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(45)
$timer.Add_Tick({ $timer.Stop(); $win.Close() })
$timer.Start()
$script:rendered572 = $false
$script:siblingPublishAttempted572 = $false
function Publish-OwnedSiblingReady572 {
  if ($Role -ne 'sibling' -or -not $script:rendered572 -or $script:siblingPublishAttempted572 -or [IO.File]::Exists($Ready)) { return }
  $handle = ([Windows.Interop.WindowInteropHelper]::new($win)).Handle
  $active572 = [bool]$win.IsActive
  $foreground572 = [OwnedModesForeground572]::GetForegroundWindow().ToInt64()
  if ($handle.ToInt64() -le 0 -or -not $active572 -or $foreground572 -ne $handle.ToInt64()) { return }
  $script:siblingPublishAttempted572 = $true
  $script:armed572 = $true
  $proof = [ordered]@{ schema = 1; hwnd = $handle.ToInt64(); foreground = $foreground572; active = $active572; initialUnchanged = $true }
  [IO.File]::WriteAllText($Ready + '.pending', ($proof | Microsoft.PowerShell.Utility\ConvertTo-Json -Compress))
  [IO.File]::Move($Ready + '.pending', $Ready)
}
$win.Add_Activated({ Publish-OwnedSiblingReady572 })
$win.Add_ContentRendered({
  if ($Role -eq 'sibling') {
    if ($script:rendered572 -or [IO.File]::Exists($Ready)) { return }
    $script:rendered572 = $true
    [void]$win.Activate()
    Publish-OwnedSiblingReady572
    return
  }
  if ([IO.File]::Exists($Ready)) { return }
  $handle = ([Windows.Interop.WindowInteropHelper]::new($win)).Handle
  $baseline = $true
  if ($Role -eq 'target') {
    if ($Mode -eq 'setvalue') { $baseline = $control.Text -ceq '' }
    elseif ($Mode -eq 'select') { $baseline = $list.SelectedItem -ne $control }
    elseif ($Mode -eq 'toggle') { $baseline = $control.IsChecked -eq $false }
    elseif ($Mode -eq 'scroll') { $baseline = ($control.VerticalOffset -eq 0 -and $control.ScrollableHeight -gt 0) }
  }
  $script:armed572 = $true
  $proof = [ordered]@{ schema = 1; hwnd = $handle.ToInt64(); foreground = [OwnedModesForeground572]::GetForegroundWindow().ToInt64(); active = [bool]$win.IsActive; initialUnchanged = [bool]$baseline }
  [IO.File]::WriteAllText($Ready + '.pending', ($proof | Microsoft.PowerShell.Utility\ConvertTo-Json -Compress))
  [IO.File]::Move($Ready + '.pending', $Ready)
})
[void]$win.ShowDialog()
