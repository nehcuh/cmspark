# uia-invoke-fixture.ps1 — self-contained UIA acceptance fixture for #572.
# One WinForms window, one Button. Clicking it writes a marker file (the target-owned
# state-change oracle). Bounded lifetime so a failed test leaves no stray window.
# Readiness is reported to a FILE (stdout from a WinForms handler is unreliable).
param(
  [Parameter(Mandatory=$true)][string]$Marker,
  [string]$ButtonText = 'SubmitTest',
  [Parameter(Mandatory=$true)][string]$Ready,
  [int]$Seconds = 40
)
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = 'CMspark UIA invoke fixture'
$form.Width = 420; $form.Height = 180
$form.StartPosition = 'CenterScreen'
$btn = New-Object System.Windows.Forms.Button
$btn.Text = $ButtonText
$btn.Name = 'cmspark_fixture_button'
$btn.Width = 160; $btn.Height = 40; $btn.Left = 120; $btn.Top = 60
$btn.Add_Click({
  try { Set-Content -Path $Marker -Value ("clicked " + [DateTime]::UtcNow.ToString('o')) -Encoding UTF8 } catch {}
})
$form.Controls.Add($btn)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = [Math]::Max(5000, $Seconds * 1000)
$timer.Add_Tick({ $timer.Stop(); $form.Close() })
$timer.Start()
$form.Add_Shown({
  try { [IO.File]::WriteAllText($Ready, [string]$form.Handle.ToInt64()) } catch {}
})
[void]$form.ShowDialog()
