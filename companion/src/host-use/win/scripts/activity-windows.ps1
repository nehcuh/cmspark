# Read-only recorder identity. No activation, input, UIA pattern invocation or screenshot.
param([ValidateSet('Apps','Probe')][string]$Mode = 'Probe')
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
if ($Mode -eq 'Probe') { Add-Type -AssemblyName UIAutomationClient }
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class ActivityWindows758 {
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern IntPtr GetThreadDpiAwarenessContext();
  [DllImport("user32.dll")] public static extern bool AreDpiAwarenessContextsEqual(IntPtr first, IntPtr second);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint command);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformation(IntPtr h, int index, IntPtr buf, int len, out uint needed);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);
  public static string Desktop() {
    IntPtr h=OpenInputDesktop(0,false,1); if(h==IntPtr.Zero) return null;
    try { uint n; GetUserObjectInformation(h,2,IntPtr.Zero,0,out n); if(n==0 || n>4096) return null;
      IntPtr p=Marshal.AllocHGlobal((int)n);
      try { return GetUserObjectInformation(h,2,p,(int)n,out n)?Marshal.PtrToStringUni(p):null; } finally { Marshal.FreeHGlobal(p); }
    } finally { CloseDesktop(h); }
  }
  public static IntPtr[] Windows() { var a=new List<IntPtr>(); EnumWindows((h,l)=>{ if(a.Count<4097) a.Add(h); return a.Count<4097; },IntPtr.Zero); return a.ToArray(); }
  public static string Geometry(IntPtr h) { RECT r; return GetWindowRect(h,out r) && r.Right>r.Left && r.Bottom>r.Top ? r.Left+","+r.Top+","+r.Right+","+r.Bottom : null; }
  public static bool Unobscured(IntPtr target) {
    RECT r; if(!GetWindowRect(target,out r)) return false;
    var seen=new HashSet<IntPtr>(); IntPtr h=target;
    for(int n=0;n<4096;n++) {
      h=GetWindow(h,3); if(h==IntPtr.Zero) return true;
      if(!seen.Add(h)) return false;
      if(!IsWindowVisible(h) || IsIconic(h)) continue;
      int cloaked; if(DwmGetWindowAttribute(h,14,out cloaked,4)!=0) return false;
      if(cloaked!=0) continue;
      RECT a; if(!GetWindowRect(h,out a)) return false;
      if(a.Left<r.Right && a.Top<r.Bottom && a.Right>r.Left && a.Bottom>r.Top) return false;
    } return false;
  }
}
'@
if ($Mode -eq 'Probe') {
  [ActivityWindows758]::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null
  if (-not [ActivityWindows758]::AreDpiAwarenessContextsEqual([ActivityWindows758]::GetThreadDpiAwarenessContext(),[IntPtr]::new(-4))) { throw 'ACTIVITY_DPI_UNAVAILABLE' }
}
if ([ActivityWindows758]::Desktop() -cne 'Default') { throw 'ACTIVITY_DESKTOP_UNAVAILABLE' }
$ownSession = (Get-Process -Id $PID).SessionId
function Process-Identity($p) {
  try {
    if ($p.SessionId -ne $ownSession -or -not $p.Path) { return $null }
    # Keep the established executable-path identity shared by Apps and Probe.
    $exe = [IO.Path]::GetFullPath($p.Path).Replace('/','\').ToLowerInvariant()
    if ($exe -match 'keychain|1password|onepassword|bitwarden|lastpass|keepass|dashlane|authy|authenticator|securityagent|passwords|wallet|metamask|ledger|exodus|secretive|systempreferences|loginwindow|screenlock|authorizationhost|screensaver|kscreenlocker|gnome-shell|gdm|lightdm|sddm|logonui|credentialuibroker|lockapp|winlogon|consent.exe') { return $null }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($exe)))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
    return [ordered]@{ app_id=('win.'+$hash); exe=$exe }
  } catch { return $null }
}
function App-Name($p, [string]$exe) {
  $info = $null
  try { $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($exe) } catch { }
  foreach ($candidate in @($info.ProductName, $info.FileDescription, $p.ProcessName)) {
    if (-not [string]::IsNullOrWhiteSpace([string]$candidate)) {
      $name = ([string]$candidate -replace '[\x00-\x1F\x7F]', ' ').Trim()
      if ($name.Length -gt 0) { return $name.Substring(0,[Math]::Min(200,$name.Length)) }
    }
  }
  return $null
}
function Window-Info([IntPtr]$h) {
  if ($h -eq [IntPtr]::Zero -or -not [ActivityWindows758]::IsWindowVisible($h) -or [ActivityWindows758]::IsIconic($h)) { return $null }
  $processId = [uint32]0
  [ActivityWindows758]::GetWindowThreadProcessId($h,[ref]$processId) | Out-Null
  try {
    $p = Get-Process -Id $processId -ErrorAction Stop
    $identity = Process-Identity $p
    if ($null -eq $identity) { return $null }
    $exe = $identity.exe
    $title = New-Object Text.StringBuilder 501
    if ($Mode -eq 'Probe') { [ActivityWindows758]::GetWindowText($h,$title,$title.Capacity) | Out-Null }
    $geometry = [ActivityWindows758]::Geometry($h)
    if (-not $geometry) { return $null }
    $class = New-Object Text.StringBuilder 257
    [ActivityWindows758]::GetClassName($h,$class,$class.Capacity) | Out-Null
    return [ordered]@{ hwnd=$h.ToInt64(); pid=[int]$processId; started=[string]$p.StartTime.ToUniversalTime().Ticks; app_id=$identity.app_id; app_name=[string]$p.ProcessName; exe=$exe; title=$title.ToString(); window_class=$class.ToString(); geometry=$geometry; safe=$true }
  } catch { return $null }
}
if ($Mode -eq 'Apps') {
  # Window observations describe a process; they never decide whether it is listed.
  $windows = [ActivityWindows758]::Windows()
  if ($windows.Length -gt 4096) { throw 'APP_LIST_LIMIT_EXCEEDED' }
  $windowStates = @{}
  $ranks = @{ none=0; hidden=1; minimized=2; visible=3 }
  foreach ($h in $windows) {
    $processId = [uint32]0
    [ActivityWindows758]::GetWindowThreadProcessId($h,[ref]$processId) | Out-Null
    $state = 'hidden'
    if ([ActivityWindows758]::IsIconic($h)) { $state = 'minimized' }
    elseif ([ActivityWindows758]::IsWindowVisible($h)) {
      $cloaked = 0
      if ([ActivityWindows758]::DwmGetWindowAttribute($h,14,[ref]$cloaked,4) -eq 0 -and $cloaked -eq 0) { $state = 'visible' }
    }
    $key = [string]$processId
    if (-not $windowStates.ContainsKey($key) -or $ranks[$state] -gt $ranks[$windowStates[$key]]) { $windowStates[$key] = $state }
  }
  $apps = @{}
  foreach ($p in @(Get-Process -ErrorAction Stop)) {
    try {
      $identity = Process-Identity $p
      if ($null -eq $identity) { continue }
      $name = App-Name $p $identity.exe
      if ([string]::IsNullOrWhiteSpace($name)) { continue }
      $key = [string]$p.Id
      $state = if ($windowStates.ContainsKey($key)) { $windowStates[$key] } else { 'none' }
      $id = $identity.app_id
      if ($apps.ContainsKey($id)) {
        if ([StringComparer]::Ordinal.Compare($name,[string]$apps[$id].app_name) -lt 0) { $apps[$id].app_name = $name }
        if ($ranks[$state] -gt $ranks[$apps[$id].window_state]) { $apps[$id].window_state = $state }
      } else { $apps[$id] = [ordered]@{ app_id=$id; app_name=$name; window_state=$state } }
    } catch { continue }
  }
  if ($apps.Count -gt 4096) { throw 'APP_LIST_LIMIT_EXCEEDED' }
  $rows = New-Object 'System.Collections.Generic.List[object]'
  foreach ($row in $apps.Values) { $rows.Add($row) }
  $rows.Sort([Comparison[object]]{
    param($left,$right)
    $order = [StringComparer]::Ordinal.Compare([string]$left.app_name,[string]$right.app_name)
    if ($order -ne 0) { return $order }
    return [StringComparer]::Ordinal.Compare([string]$left.app_id,[string]$right.app_id)
  })
  if ([ActivityWindows758]::Desktop() -cne 'Default') { throw 'ACTIVITY_DESKTOP_UNAVAILABLE' }
  ConvertTo-Json -Depth 4 -Compress -InputObject ([ordered]@{ok=$true; apps=@($rows.ToArray())})
} else {
  $h = [ActivityWindows758]::GetForegroundWindow()
  $row = Window-Info $h
  if ($null -ne $row) {
    try {
      $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
      if ($null -eq $focused -or $focused.Current.ProcessId -ne $row.pid -or $focused.Current.IsPassword -or -not [ActivityWindows758]::Unobscured($h)) { $row=$null }
    } catch { $row=$null }
  }
  if ([ActivityWindows758]::Desktop() -cne 'Default' -or [ActivityWindows758]::GetForegroundWindow() -ne $h) { $row=$null }
  ConvertTo-Json -Depth 4 -Compress -InputObject ([ordered]@{ok=$true; window=$row})
}
