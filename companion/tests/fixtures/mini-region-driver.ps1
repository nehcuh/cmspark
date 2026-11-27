# Exercise only a picker launched by this test Node process. No system-wide input is injected.
param([int]$OwnerPid, [ValidateSet('select','cancel','delayed')][string]$Mode, [string]$Finished)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
public class MiniRegionDriver {
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  public static IntPtr FindPicker() { return FindWindow(null, "CMspark Mini - Select region"); }
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr hwnd, ref Point p);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
  public static void Mouse(IntPtr h, Point p, uint msg, int button) {
    if (WindowFromPoint(p) != h || !ScreenToClient(h,ref p)) throw new Exception("picker not at test coordinates");
    int packed = ((p.Y & 65535) << 16) | (p.X & 65535);
    if (!PostMessage(h,msg,new IntPtr(button),new IntPtr(packed))) throw new Exception("could not deliver test event");
  }
}
'@ -ReferencedAssemblies System.Drawing
$null = [MiniRegionDriver]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
$form = New-Object Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.StartPosition = 'Manual'
$form.AutoScaleMode = 'None'
$form.ClientSize = New-Object Drawing.Size(240,160)
$screen = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.Location = New-Object Drawing.Point(($screen.Left + 100),($screen.Top + 150))
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.BackColor = [Drawing.Color]::FromArgb(25,89,171)
$form.Add_MouseDown({
  $form.BackColor = [Drawing.Color]::FromArgb(120,35,180)
  $form.Refresh()
})
$stripe = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(219,113,44))
$form.Add_Paint({ param($sender,$e) $e.Graphics.FillRectangle($stripe,79,0,161,160) })
$watch = [Diagnostics.Stopwatch]::StartNew()
$clock = New-Object Windows.Forms.Timer
$clock.Interval = 150
$sent = $false
$clicked = $false
$failure = $null
$form.Add_Shown({
  $form.Refresh()
  $form.Activate()
  $spot = $form.PointToScreen([Drawing.Point]::new(70,60))
  if ([MiniRegionDriver]::WindowFromPoint($spot) -ne $form.Handle) {
    $script:failure = 'fixture is not visible'
    $form.Close()
    return
  }
  [Console]::WriteLine('READY')
  $clock.Start()
})
$clock.Add_Tick({
  try {
    if ($watch.Elapsed.TotalSeconds -gt 30) { throw 'picker did not complete' }
    if (Test-Path -LiteralPath $Finished) { $form.Close(); return }
    if ($sent) {
      if ($Mode -eq 'delayed' -and -not $clicked) {
        $spot = $form.PointToScreen([Drawing.Point]::new(70,60))
        if ([MiniRegionDriver]::WindowFromPoint($spot) -eq $form.Handle) {
          [MiniRegionDriver]::Mouse($form.Handle,$spot,0x201,1)
          [MiniRegionDriver]::Mouse($form.Handle,$spot,0x202,0)
          $script:clicked = $true
        }
      }
      return
    }
    $h = [MiniRegionDriver]::FindPicker()
    if ($h -eq [IntPtr]::Zero) { return }
    [uint32]$pickerPid = 0
    $null = [MiniRegionDriver]::GetWindowThreadProcessId($h,[ref]$pickerPid)
    $candidate = Get-CimInstance Win32_Process -Filter "ProcessId=$pickerPid"
    if ($candidate.ParentProcessId -ne $OwnerPid -or $candidate.Name -ne 'powershell.exe' -or
      $candidate.CommandLine -notmatch 'mini-region\.ps1"?\s+-OwnerPid\s+\d+') { return }
    $script:sent = $true
    if ($Mode -eq 'cancel') {
      if (![MiniRegionDriver]::PostMessage($h,0x100,[IntPtr]27,[IntPtr]1)) { throw 'could not deliver Escape' }
    } else {
      $a = $form.PointToScreen([Drawing.Point]::new(101,83))
      $b = $form.PointToScreen([Drawing.Point]::new(70,60))
      [MiniRegionDriver]::Mouse($h,$a,0x201,1)
      [MiniRegionDriver]::Mouse($h,$b,0x200,1)
      [MiniRegionDriver]::Mouse($h,$b,0x202,0)
    }
  } catch {
    $script:failure = $_.Exception.Message
    $form.Close()
  }
})
try { [void]$form.ShowDialog() } finally { $clock.Dispose(); $form.Dispose(); $stripe.Dispose() }
if ($failure) { [Console]::Error.WriteLine($failure); exit 1 }
