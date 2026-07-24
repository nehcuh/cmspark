# computer-input.ps1 — coordinate computer-use WP1/WP2 SendInput injection.
# Built on the S-5 spike actor (scripts/spike/s5-sendinput/s5-actor.ps1, gate
# PASS): unsigned medium-IL same-IL SendInput + AttachThreadInput foregrounding
# + MOUSEEVENTF_VIRTUALDESK|ABSOLUTE normalization + KEYEVENTF_UNICODE typing.
#
# HARD preconditions (fail-closed, plan D.2 / N4) — checked HERE as defense in
# depth (the TS executor checks them again with mockable providers):
#   1. target hwnd is a live window
#   2. target process integrity level <= our integrity level (cross-IL denied)
#   3. input desktop name == "Default" (UAC / secure desktop / lock denied)
#   4. client coords within the target client rect (reject, never clamp)
#   5. type: foreground hwnd re-checked every batch; drift aborts (A1.4)
#   6. ForceForeground must report success (X2 — foreground lock = no blind inject)
#   7. click/scroll/drag: target must be foreground AND own the root window at
#      the landing point (WindowFromPoint + GetAncestor GA_ROOT; X2); drag
#      checks BOTH endpoints
#   8. key: named-key WHITELIST chords only (WP2 — no arbitrary VK; printable
#      text goes through 'type' with its A3 corpus gate) + foreground
#      re-verified immediately before SendBatch (adversary WP2 X2 — keys go
#      to the FOCUS window; a popup in the settle window would eat
#      enter/space/alt,f4). Residual backstop: post-action A2.1, same as type.
#
# stdout contract: single-line JSON { ok, action, ... }
# stderr contract:
#   HWNDDEAD:<d> (4)  ILDENIED:<d> (5)  DESKTOPDENIED:<d> (6)
#   OUTOFBOUNDS:<d> (7)  FOCUSLOST:<d> (8)  SENDFAILED:<d> (9)
#   OCCLUDED:<d> (10)  STOPPED:<d> (11)  BADARGS:<d> (2)
param(
  [Parameter(Mandatory=$true)][long]$Hwnd,
  [Parameter(Mandatory=$true)][ValidateSet('click','double_click','right_click','type','key','scroll','drag')] [string]$Action,
  # Client-area physical pixels (point actions: click kinds, scroll, drag start).
  [int]$X = -1,
  [int]$Y = -1,
  # Text for -Action type (argv-only — never interpolated into script source).
  [string]$Text = "",
  # Comma-separated key names for -Action key (whitelist, e.g. "ctrl,enter").
  [string]$Keys = "",
  # Wheel delta for -Action scroll (non-zero, ±1200 max).
  [int]$Delta = 0,
  # Drag endpoint, client px.
  [int]$X2 = -1,
  [int]$Y2 = -1,
  # Per-key throttle jitter bounds (ms). OSR apps drop instantaneous bursts (S-5).
  [int]$ThrottleMinMs = 30,
  [int]$ThrottleMaxMs = 80,
  # Foreground re-check cadence for type (A1.4).
  [int]$FocusCheckEvery = 16,
  # WP2 (E.6): emergency-stop flag file — polled before injection and between
  # type characters; its mere presence aborts the run with STOPPED (exit 11).
  [string]$StopFile = "",
  # UX-spike 2026-07-23: focus-only mode. -Mode force-fg performs ONLY the
  # ForceForeground retry loop + post-raise foreground assertion and emits
  # {ok, action:"force-fg", foreground:<bool>}. No bounds check, no landing
  # check, NO input injection — this is a pure focus recovery used after the
  # sidepanel snatched the foreground (FOREGROUND-YIELD self-UI path).
  [ValidateSet('inject','force-fg')][string]$Mode = 'inject'
)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr v);' -Name DPI -Namespace CUI
try { [CUI.DPI]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null } catch {}

Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class InpW32 {
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll")] public static extern uint GetCurrentProcessId();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] p, int cb);
  [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformation(IntPtr hObj, int index, IntPtr buf, int len, out uint needed);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("advapi32.dll")] public static extern bool OpenProcessToken(IntPtr proc, uint access, out IntPtr token);
  [DllImport("advapi32.dll")] public static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr buf, uint len, out uint retLen);
  [DllImport("advapi32.dll")] public static extern IntPtr GetSidSubAuthority(IntPtr sid, uint n);
  [DllImport("advapi32.dll")] public static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL, wParamH; }
  [StructLayout(LayoutKind.Explicit)] public struct U { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public HARDWAREINPUT hi; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public U u; }

  public const uint MOUSEEVENTF_MOVE=0x1, MOUSEEVENTF_LEFTDOWN=0x2, MOUSEEVENTF_LEFTUP=0x4,
                    MOUSEEVENTF_RIGHTDOWN=0x8, MOUSEEVENTF_RIGHTUP=0x10,
                    MOUSEEVENTF_WHEEL=0x0800,
                    MOUSEEVENTF_ABSOLUTE=0x8000, MOUSEEVENTF_VIRTUALDESK=0x4000,
                    KEYEVENTF_KEYUP=0x2, KEYEVENTF_UNICODE=0x4;

  public static INPUT Mouse(int x, int y, uint flags){
    int vsx=GetSystemMetrics(76), vsy=GetSystemMetrics(77), vsw=GetSystemMetrics(78), vsh=GetSystemMetrics(79);
    int nx = (int)((x - vsx) * 65535L / (vsw - 1));
    int ny = (int)((y - vsy) * 65535L / (vsh - 1));
    INPUT i = new INPUT(); i.type = 0;
    i.u.mi = new MOUSEINPUT(); i.u.mi.dx = nx; i.u.mi.dy = ny;
    i.u.mi.dwFlags = flags | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
    return i;
  }
  public static INPUT Key(ushort scan, uint flags){
    INPUT i = new INPUT(); i.type = 1;
    i.u.ki = new KEYBDINPUT(); i.u.ki.wVk = 0; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags | KEYEVENTF_UNICODE;
    return i;
  }
  // WP2: named-VK key event (key chords) — wVk, NOT the UNICODE channel.
  public static INPUT KeyVk(ushort vk, uint flags){
    INPUT i = new INPUT(); i.type = 1;
    i.u.ki = new KEYBDINPUT(); i.u.ki.wVk = vk; i.u.ki.wScan = 0; i.u.ki.dwFlags = flags;
    return i;
  }
  // WP2: wheel event at a point (delta in wheel units, mouseData carries it).
  public static INPUT Wheel(int x, int y, int delta){
    INPUT i = Mouse(x, y, MOUSEEVENTF_WHEEL);
    i.u.mi.mouseData = (uint)delta;
    return i;
  }
  public static uint SendBatch(INPUT[] arr){ return SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT))); }
  public static bool ForceForeground(IntPtr hwnd){
    ShowWindow(hwnd, 9);
    IntPtr fg = GetForegroundWindow(); uint dummy;
    uint fgTid = GetWindowThreadProcessId(fg, out dummy);
    uint myTid = GetCurrentThreadId(); bool ok = false;
    if (fgTid != myTid) AttachThreadInput(myTid, fgTid, true);
    try { ok = SetForegroundWindow(hwnd); BringWindowToTop(hwnd); }
    finally { if (fgTid != myTid) AttachThreadInput(myTid, fgTid, false); }
    return ok;
  }

  // IL of a process id; -1 on failure.
  public static int ProcessIntegrityLevel(uint pid){
    IntPtr proc = OpenProcess(0x0400 /*QUERY_LIMITED_INFORMATION*/, false, pid);
    if (proc == IntPtr.Zero) return -1;
    try {
      IntPtr token;
      if (!OpenProcessToken(proc, 0x8 /*TOKEN_QUERY*/, out token)) return -1;
      try {
        uint need;
        GetTokenInformation(token, 25 /*TokenIntegrityLevel*/, IntPtr.Zero, 0, out need);
        if (need == 0) return -1;
        IntPtr buf = Marshal.AllocHGlobal((int)need);
        try {
          if (!GetTokenInformation(token, 25, buf, need, out need)) return -1;
          IntPtr sid = Marshal.ReadIntPtr(buf); // TOKEN_MANDATORY_LABEL.Label
          IntPtr countPtr = GetSidSubAuthorityCount(sid);
          int count = Marshal.ReadByte(countPtr);
          if (count < 1) return -1;
          IntPtr last = GetSidSubAuthority(sid, (uint)(count - 1));
          return Marshal.ReadInt32(last);
        } finally { Marshal.FreeHGlobal(buf); }
      } finally { CloseHandle(token); }
    } finally { CloseHandle(proc); }
  }

  public static string InputDesktopName(){
    IntPtr d = OpenInputDesktop(0, false, 0x0001 /*DESKTOP_READOBJECTS*/);
    if (d == IntPtr.Zero) return null;
    try {
      uint need;
      GetUserObjectInformation(d, 2 /*UOI_NAME*/, IntPtr.Zero, 0, out need);
      if (need == 0) return "";
      IntPtr buf = Marshal.AllocHGlobal((int)need);
      try {
        if (!GetUserObjectInformation(d, 2, buf, (int)need, out need)) return "";
        return Marshal.PtrToStringUni(buf);
      } finally { Marshal.FreeHGlobal(buf); }
    } finally { CloseDesktop(d); }
  }
}
'@

function Fail([string]$prefix, [string]$detail, [int]$code) {
  [Console]::Error.WriteLine("${prefix}:$detail")
  exit $code
}

# Diagnostics (UX-spike 2026-07-23): the search-box "won't click" symptom on
# OSR apps like NetEase CloudMusic is almost always a fail-closed rejection
# from ForceForeground / Assert-Landing (foreground yielded to the sidepanel,
# or WindowFromPoint at the search box lands on a sibling/overlay). The bare
# "FOCUSLOST:target hwnd ... not foreground" line names neither the usurper
# nor where the point actually landed. Append a compact key=value diagnostic
# tail to the detail so a single log line pins the cause — diagnosis only,
# the fail-closed decision is unchanged.
function Get-FgDiag([int]$sx = -1, [int]$sy = -1) {
  $fgPtr = [InpW32]::GetForegroundWindow()
  $fgId = if ($fgPtr -ne [IntPtr]::Zero) { $fgPtr.ToInt64() } else { 0 }
  $fgPid = 0
  if ($fgId -ne 0) { [InpW32]::GetWindowThreadProcessId($fgPtr, [ref]$fgPid) | Out-Null }
  # exe basename only (never the full path / window title — privacy parity
  # with the UIA watcher, which omits Name).
  $fgExe = ""
  if ($fgPid -ne 0) {
    try { $fgExe = (Get-Process -Id $fgPid -ErrorAction Stop).ProcessName } catch {}
  }
  $tail = " | fg_hwnd=$fgId fg_pid=$fgPid fg_exe=$fgExe target_hwnd=$Hwnd"
  if ($sx -ge 0 -and $sy -ge 0) {
    $pt = New-Object InpW32+POINT
    $pt.X = $sx; $pt.Y = $sy
    $wfp = [InpW32]::WindowFromPoint($pt)
    $wfpId = if ($wfp -ne [IntPtr]::Zero) { $wfp.ToInt64() } else { 0 }
    $root = [InpW32]::GetAncestor($wfp, 2) # GA_ROOT
    $rootId = if ($root -ne [IntPtr]::Zero) { $root.ToInt64() } else { 0 }
    $tail += " wfp_hwnd=$wfpId wfp_root=$rootId pt=($sx,$sy)"
  }
  return $tail
}

# WP2 (E.6): emergency-stop flag — its mere presence aborts the injection,
# fail-closed. Checked after the foreground force (single-shot actions) and
# between type characters (the long-running channel).
function Test-StopFlag {
  if ($StopFile -ne "" -and (Test-Path -LiteralPath $StopFile)) {
    Fail "STOPPED" "emergency-stop flag present — injection aborted" 11
  }
}

$hwndPtr = [IntPtr]::new($Hwnd)

# --- 1. live window ------------------------------------------------------------
if (-not [InpW32]::IsWindow($hwndPtr)) { Fail "HWNDDEAD" "hwnd $Hwnd is not a live window" 4 }

# --- force-fg short-circuit (UX-spike 2026-07-23) ------------------------------
# Focus-only recovery: no IL/desktop/bounds/landing checks, NO input injection.
# The YIELD self-UI path already validated the target moments earlier; this
# only re-asserts foreground after the sidepanel stole it. Emits a single-line
# JSON and exits — the inject path below never runs in this mode.
if ($Mode -eq 'force-fg') {
  $ok = $false
  for ($fgTry = 1; $fgTry -le 3; $fgTry++) {
    if ([InpW32]::ForceForeground($hwndPtr)) { $ok = $true; break }
    Start-Sleep -Milliseconds 150
  }
  Start-Sleep -Milliseconds 80
  $isFg = ([InpW32]::GetForegroundWindow() -eq $hwndPtr)
  Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
    ok = $true; action = "force-fg"; raised = $ok; foreground = $isFg
  }))
  exit 0
}

# --- 2. IL: target process IL must be <= ours (cross-IL = UIPI boundary) -------
$targetPid = 0
[InpW32]::GetWindowThreadProcessId($hwndPtr, [ref]$targetPid) | Out-Null
$ownIl = [InpW32]::ProcessIntegrityLevel([InpW32]::GetCurrentProcessId())
$targetIl = [InpW32]::ProcessIntegrityLevel($targetPid)
if ($ownIl -lt 0 -or $targetIl -lt 0) {
  Fail "ILDENIED" "integrity-level probe failed (own=$ownIl target=$targetIl) — fail-closed" 5
}
if ($targetIl -gt $ownIl) {
  Fail "ILDENIED" "target pid $targetPid IL=$targetIl above own IL=$ownIl (cross-IL injection is never attempted)" 5
}

# --- 3. input desktop must be "Default" (UAC/secure desktop/lock = deny) -------
$desk = [InpW32]::InputDesktopName()
if ($null -eq $desk) { Fail "DESKTOPDENIED" "OpenInputDesktop failed" 6 }
if ($desk -ne "Default") { Fail "DESKTOPDENIED" "input desktop is '$desk', not 'Default'" 6 }

# --- 4. bounds (point actions: click kinds / scroll / drag) -------------------
$screenX = 0; $screenY = 0; $screenX2 = 0; $screenY2 = 0
$needsPoint = $Action -in 'click','double_click','right_click','scroll','drag'
if ($needsPoint) {
  if ($X -lt 0 -or $Y -lt 0) { Fail "BADARGS" "$Action requires -X/-Y client coords" 2 }
  $cr = New-Object InpW32+RECT
  [InpW32]::GetClientRect($hwndPtr, [ref]$cr) | Out-Null
  $cw = $cr.Right - $cr.Left; $ch = $cr.Bottom - $cr.Top
  if ($X -ge $cw -or $Y -ge $ch) {
    Fail "OUTOFBOUNDS" "($X,$Y) outside client rect ${cw}x${ch}" 7
  }
  $pt = New-Object InpW32+POINT
  $pt.X = $cr.Left + $X; $pt.Y = $cr.Top + $Y
  [InpW32]::ClientToScreen($hwndPtr, [ref]$pt) | Out-Null
  $screenX = $pt.X; $screenY = $pt.Y
  if ($Action -eq 'drag') {
    if ($X2 -lt 0 -or $Y2 -lt 0) { Fail "BADARGS" "drag requires -X2/-Y2 client coords" 2 }
    if ($X2 -ge $cw -or $Y2 -ge $ch) {
      Fail "OUTOFBOUNDS" "drag endpoint ($X2,$Y2) outside client rect ${cw}x${ch}" 7
    }
    $pt2 = New-Object InpW32+POINT
    $pt2.X = $cr.Left + $X2; $pt2.Y = $cr.Top + $Y2
    [InpW32]::ClientToScreen($hwndPtr, [ref]$pt2) | Out-Null
    $screenX2 = $pt2.X; $screenY2 = $pt2.Y
  }
}

# WP2 key whitelist (named VK only — printable text goes through 'type').
$VkMap = @{
  ctrl = 0x11; alt = 0x12; shift = 0x10; win = 0x5B
  enter = 0x0D; escape = 0x1B; tab = 0x09; space = 0x20; backspace = 0x08; delete = 0x2E
  up = 0x26; down = 0x28; left = 0x25; right = 0x27
  home = 0x24; end = 0x23; pageup = 0x21; pagedown = 0x22
  f1 = 0x70; f2 = 0x71; f3 = 0x72; f4 = 0x73; f5 = 0x74; f6 = 0x75
  f7 = 0x76; f8 = 0x77; f9 = 0x78; f10 = 0x79; f11 = 0x7A; f12 = 0x7B
}

# X2: landing-window ownership — the event must land on the TARGET, not on an
# overlay. Both checks fail closed:
#   a) the target must actually BE foreground after the force;
#   b) the root window at the landing point must be the target hwnd
#      (WindowFromPoint sees through nothing — an AlwaysOnTop/notification
#      window covering the point reports itself).
# Residual (documented): a millisecond race remains between these checks and
# SendInput; the post-action A2.1 dialog invariant is the backstop. The key
# branch re-checks the same foreground half immediately before its SendBatch
# (adversary WP2 X2) — keys have no landing point, so its residual backstop
# is likewise the A2.1 dialog channel.
function Assert-Landing([int]$sx, [int]$sy) {
  if ([InpW32]::GetForegroundWindow() -ne $hwndPtr) {
    Fail "FOCUSLOST" "target hwnd $Hwnd is not foreground after force — refusing to inject$(Get-FgDiag)" 8
  }
  $ptCheck = New-Object InpW32+POINT
  $ptCheck.X = $sx; $ptCheck.Y = $sy
  $landed = [InpW32]::GetAncestor([InpW32]::WindowFromPoint($ptCheck), 2) # GA_ROOT
  if ($landed -ne $hwndPtr) {
    $landedId = 0
    if ($landed -ne [IntPtr]::Zero) { $landedId = $landed.ToInt64() }
    Fail "OCCLUDED" "point ($sx,$sy) lands on hwnd $landedId, not target hwnd $Hwnd — injection would be intercepted by another window$(Get-FgDiag $sx $sy)" 10
  }
}

# --- execute ---------------------------------------------------------------------
# X2: ForceForeground's return was previously discarded — a silent foreground
# lock failure meant the click/type went to whatever WAS foreground.
# WP2: retry — on 24H2 the foreground lock (LockSetForegroundWindow style
# heuristics) can reject a first SetForegroundWindow while another app holds
# focus; the AttachThreadInput pattern inside ForceForeground plus a short
# retry absorbs the transient failure. Persistent failure = honest FOCUSLOST,
# never a blind inject.
$fgOk = $false
for ($fgTry = 1; $fgTry -le 3; $fgTry++) {
  if ([InpW32]::ForceForeground($hwndPtr)) { $fgOk = $true; break }
  Start-Sleep -Milliseconds 150
}
if (-not $fgOk) {
  Fail "FOCUSLOST" "SetForegroundWindow failed after 3 attempts (foreground lock) — refusing to inject blind$(Get-FgDiag)" 8
}
Start-Sleep -Milliseconds 120
Test-StopFlag

switch ($Action) {
  { $_ -in 'click','double_click','right_click' } {
    Assert-Landing $screenX $screenY
    $down = [InpW32]::MOUSEEVENTF_LEFTDOWN; $up = [InpW32]::MOUSEEVENTF_LEFTUP
    if ($_ -eq 'right_click') { $down = [InpW32]::MOUSEEVENTF_RIGHTDOWN; $up = [InpW32]::MOUSEEVENTF_RIGHTUP }
    $batch = @([InpW32]::Mouse($screenX, $screenY, [InpW32]::MOUSEEVENTF_MOVE),
               [InpW32]::Mouse($screenX, $screenY, $down),
               [InpW32]::Mouse($screenX, $screenY, $up))
    if ($_ -eq 'double_click') {
      $batch += [InpW32]::Mouse($screenX, $screenY, $down)
      $batch += [InpW32]::Mouse($screenX, $screenY, $up)
    }
    $sent = [InpW32]::SendBatch($batch)
    if ($sent -ne $batch.Length) { Fail "SENDFAILED" "SendInput delivered $sent/$($batch.Length) events" 9 }
    Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
      ok = $true; action = $_; x = $X; y = $Y; screenX = $screenX; screenY = $screenY; sent = $sent
    }))
    exit 0
  }
  'key' {
    # WP2: whitelist chord — press in order, release in reverse.
    if ($Keys -eq "") { Fail "BADARGS" "key action requires -Keys (comma-separated names)" 2 }
    $names = @($Keys.Split(',') | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ -ne "" })
    if ($names.Count -eq 0 -or $names.Count -gt 4) { Fail "BADARGS" "key chord must be 1..4 names" 2 }
    foreach ($n in $names) {
      if (-not $VkMap.ContainsKey($n)) { Fail "BADARGS" "key name '$n' is not in the whitelist" 2 }
    }
    $batch = @()
    foreach ($n in $names) { $batch += [InpW32]::KeyVk([uint16]$VkMap[$n], 0) }
    $rev = @($names); [array]::Reverse($rev)
    foreach ($n in $rev) { $batch += [InpW32]::KeyVk([uint16]$VkMap[$n], [InpW32]::KEYEVENTF_KEYUP) }
    # X2 (adversary WP2): key events go to the FOCUS window, not a screen
    # point — a dialog that popped during the 120ms settle above would eat
    # the chord (enter/space = confirm default button, alt,f4 = close
    # foreground). Re-verify foreground immediately before SendBatch — the
    # same check as Assert-Landing's foreground half (WindowFromPoint does
    # not apply to keys). Drift = FOCUSLOST, fail-closed; the post-action
    # A2.1 dialog invariant is the residual backstop, same as type.
    if ([InpW32]::GetForegroundWindow() -ne $hwndPtr) {
      Fail "FOCUSLOST" "foreground hwnd changed before key chord — refusing to inject into a possible popup" 8
    }
    $sent = [InpW32]::SendBatch($batch)
    if ($sent -ne $batch.Length) { Fail "SENDFAILED" "SendInput delivered $sent/$($batch.Length) events" 9 }
    Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
      ok = $true; action = "key"; keys = $names; sent = $sent
    }))
    exit 0
  }
  'scroll' {
    if ($Delta -eq 0 -or [Math]::Abs($Delta) -gt 1200) {
      Fail "BADARGS" "scroll delta must be a non-zero integer within ±1200" 2
    }
    Assert-Landing $screenX $screenY
    $batch = @([InpW32]::Mouse($screenX, $screenY, [InpW32]::MOUSEEVENTF_MOVE),
               [InpW32]::Wheel($screenX, $screenY, $Delta))
    $sent = [InpW32]::SendBatch($batch)
    if ($sent -ne $batch.Length) { Fail "SENDFAILED" "SendInput delivered $sent/$($batch.Length) events" 9 }
    Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
      ok = $true; action = "scroll"; x = $X; y = $Y; delta = $Delta; sent = $sent
    }))
    exit 0
  }
  'drag' {
    # WP2: BOTH endpoints must be owned by the target (a drag ending on an
    # overlay would drop onto the wrong window).
    Assert-Landing $screenX $screenY
    Assert-Landing $screenX2 $screenY2
    $first = @([InpW32]::Mouse($screenX, $screenY, [InpW32]::MOUSEEVENTF_MOVE),
               [InpW32]::Mouse($screenX, $screenY, [InpW32]::MOUSEEVENTF_LEFTDOWN))
    $sent = [InpW32]::SendBatch($first)
    if ($sent -ne $first.Length) { Fail "SENDFAILED" "SendInput delivered $sent/$($first.Length) events" 9 }
    # Interpolated move steps with small sleeps — a single burst risks the OSR
    # target dropping the drag mid-way (same lesson as type throttle, S-5).
    $steps = 16
    for ($s = 1; $s -le $steps; $s++) {
      $ix = [int]($screenX + ($screenX2 - $screenX) * $s / $steps)
      $iy = [int]($screenY + ($screenY2 - $screenY) * $s / $steps)
      $m = @([InpW32]::Mouse($ix, $iy, [InpW32]::MOUSEEVENTF_MOVE))
      $sent = [InpW32]::SendBatch($m)
      if ($sent -ne 1) { Fail "SENDFAILED" "SendInput delivered $sent/1 move events at step $s" 9 }
      Start-Sleep -Milliseconds 8
    }
    $last = @([InpW32]::Mouse($screenX2, $screenY2, [InpW32]::MOUSEEVENTF_LEFTUP))
    $sent = [InpW32]::SendBatch($last)
    if ($sent -ne $last.Length) { Fail "SENDFAILED" "SendInput delivered $sent/$($last.Length) events" 9 }
    Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
      ok = $true; action = "drag"; x = $X; y = $Y; x2 = $X2; y2 = $Y2
    }))
    exit 0
  }
  'type' {
    if ($Text -eq "") { Fail "BADARGS" "type action requires non-empty -Text" 2 }
    $chars = $Text.ToCharArray()
    # X4: hard injection-window cap, layer 3 (zod schema + TS executor enforce
    # the same 2000-char limit; this guards hand-rolled callers). 2000 chars ×
    # ≤80ms throttle ≈ 110s — under the 120s absolute ceiling below.
    if ($chars.Length -gt 2000) { Fail "SENDFAILED" "type text is $($chars.Length) chars — exceeds the 2000-char cap (X4)" 9 }
    $estimatedMs = $chars.Length * $ThrottleMaxMs
    if ($estimatedMs -gt 120000) { Fail "SENDFAILED" "estimated inject time ${estimatedMs}ms exceeds the 120s hard cap (X4)" 9 }
    $rand = New-Object Random
    $sentChars = 0
    # Y4 (WP2): REAL per-char throttle — every character is its own SendInput
    # call and the jittered sleep happens BETWEEN sends. The WP1 code slept
    # while ACCUMULATING a batch and then burst the whole batch (32 events for
    # 16 chars) — against OSR apps that drop instantaneous event streams, that
    # was the exact failure mode the throttle was meant to prevent.
    for ($i = 0; $i -lt $chars.Length; $i++) {
      # WP2 (E.6): emergency stop — polled between EVERY character; a pressed
      # stop flag ends the batch here, not after the remaining chars spray.
      Test-StopFlag
      # A1.4: foreground drift mid-type = abort remaining events (the text must
      # never spray into a popup dialog / password field that appeared mid-task).
      if ($i % $FocusCheckEvery -eq 0) {
        if ([InpW32]::GetForegroundWindow() -ne $hwndPtr) {
          Fail "FOCUSLOST" "foreground hwnd changed after $sentChars/$($chars.Length) chars" 8
        }
      }
      $scan = [uint16]$chars[$i]
      $pair = @([InpW32]::Key($scan, 0), [InpW32]::Key($scan, [InpW32]::KEYEVENTF_KEYUP))
      $sent = [InpW32]::SendBatch($pair)
      if ($sent -ne $pair.Length) { Fail "SENDFAILED" "SendInput delivered $sent/$($pair.Length) events at char $i" 9 }
      $sentChars++
      if ($i -lt $chars.Length - 1) {
        $th = $ThrottleMinMs + $rand.Next([Math]::Max(1, $ThrottleMaxMs - $ThrottleMinMs + 1))
        Start-Sleep -Milliseconds $th
      }
    }
    Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
      ok = $true; action = "type"; chars = $sentChars
    }))
    exit 0
  }
}
