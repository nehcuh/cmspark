# computer-windows.ps1 — window enumeration / hwnd introspection for the
# whitelist-ownership gate (plan E.2.1: hwnd -> pid -> exe path -> AppEntry).
#
# Modes:
#   -ExePath <path> : list visible top-level windows whose process exe resolves
#                     to that path (normalized, case-insensitive).
#   -Hwnd <n>       : single-window info (ownership re-validation per action).
#
# stdout: single-line JSON. stderr: HWNDDEAD:<d> (exit 4) for dead -Hwnd.
param(
  [string]$ExePath = "",
  [long]$Hwnd = -1
)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

# A5: physical pixels everywhere — this process reports window rects in the
# SAME PerMonitorV2 space as capture/input (a DPI-unaware process gets
# virtualized, scaled-down rects and every coordinate would drift).
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr v);' -Name DPI -Namespace CUW
try { [CUW.DPI]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null } catch {}

Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text; using System.Collections.Generic;
public class WinEnum {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<IntPtr> Collect(){
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
}
'@

function Fail([string]$prefix, [string]$detail, [int]$code) {
  [Console]::Error.WriteLine("${prefix}:$detail")
  exit $code
}

function Get-WindowInfo([IntPtr]$h) {
  $pidOut = 0
  [WinEnum]::GetWindowThreadProcessId($h, [ref]$pidOut) | Out-Null
  $exePath = $null
  try { $exePath = (Get-Process -Id $pidOut -ErrorAction Stop).Path } catch { $exePath = $null }
  $len = [WinEnum]::GetWindowTextLength($h)
  $sb = New-Object System.Text.StringBuilder ($len + 1)
  [WinEnum]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null
  $r = New-Object WinEnum+RECT
  [WinEnum]::GetWindowRect($h, [ref]$r) | Out-Null
  return [ordered]@{
    hwnd = $h.ToInt64()
    pid = [int]$pidOut
    exePath = $exePath
    title = $sb.ToString()
    visible = [bool][WinEnum]::IsWindowVisible($h)
    rect = @{ x = $r.Left; y = $r.Top; width = ($r.Right - $r.Left); height = ($r.Bottom - $r.Top) }
  }
}

function Normalize-Path([string]$p) {
  if (-not $p) { return "" }
  return ([IO.Path]::GetFullPath($p)).Replace('/', '\').ToLower()
}

if ($Hwnd -ge 0) {
  $h = [IntPtr]::new($Hwnd)
  if (-not [WinEnum]::IsWindow($h)) { Fail "HWNDDEAD" "hwnd $Hwnd is not a live window" 4 }
  $info = Get-WindowInfo $h
  $info.alive = $true
  $info.foreground = ([WinEnum]::GetForegroundWindow() -eq $h)
  Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{ ok = $true; window = $info }))
  exit 0
}

if ($ExePath -ne "") {
  $want = Normalize-Path $ExePath
  $matches = @()
  foreach ($h in [WinEnum]::Collect()) {
    if (-not [WinEnum]::IsWindowVisible($h)) { continue }
    $info = Get-WindowInfo $h
    if ($info.exePath -and (Normalize-Path $info.exePath) -eq $want) {
      $matches += $info
    }
  }
  Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{ ok = $true; windows = $matches }))
  exit 0
}

# Foreground probe mode (no args).
Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
  ok = $true; foreground = [WinEnum]::GetForegroundWindow().ToInt64()
}))
exit 0
