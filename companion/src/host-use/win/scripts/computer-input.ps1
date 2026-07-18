# computer-input.ps1 — coordinate computer-use WP1 SendInput injection.
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
#
# stdout contract: single-line JSON { ok, action, ... }
# stderr contract:
#   HWNDDEAD:<d> (4)  ILDENIED:<d> (5)  DESKTOPDENIED:<d> (6)
#   OUTOFBOUNDS:<d> (7)  FOCUSLOST:<d> (8)  SENDFAILED:<d> (9)  BADARGS:<d> (2)
param(
  [Parameter(Mandatory=$true)][long]$Hwnd,
  [Parameter(Mandatory=$true)][ValidateSet('click','double_click','right_click','type')] [string]$Action,
  # Client-area physical pixels (click kinds only).
  [int]$X = -1,
  [int]$Y = -1,
  # Text for -Action type (argv-only — never interpolated into script source).
  [string]$Text = "",
  # Per-key throttle jitter bounds (ms). OSR apps drop instantaneous bursts (S-5).
  [int]$ThrottleMinMs = 30,
  [int]$ThrottleMaxMs = 80,
  # Foreground re-check cadence for type (A1.4).
  [int]$FocusCheckEvery = 16
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

$hwndPtr = [IntPtr]::new($Hwnd)

# --- 1. live window ------------------------------------------------------------
if (-not [InpW32]::IsWindow($hwndPtr)) { Fail "HWNDDEAD" "hwnd $Hwnd is not a live window" 4 }

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

# --- 4. bounds (click kinds) ----------------------------------------------------
$screenX = 0; $screenY = 0
if ($Action -ne 'type') {
  if ($X -lt 0 -or $Y -lt 0) { Fail "BADARGS" "click action requires -X/-Y client coords" 2 }
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
}

# --- execute ---------------------------------------------------------------------
[InpW32]::ForceForeground($hwndPtr) | Out-Null
Start-Sleep -Milliseconds 120

switch ($Action) {
  { $_ -in 'click','double_click','right_click' } {
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
    for ($i = 0; $i -lt $chars.Length; $i += $FocusCheckEvery) {
      # A1.4: foreground drift mid-type = abort remaining events (the text must
      # never spray into a popup dialog / password field that appeared mid-task).
      if ([InpW32]::GetForegroundWindow() -ne $hwndPtr) {
        Fail "FOCUSLOST" "foreground hwnd changed after $sentChars/$($chars.Length) chars" 8
      }
      $batch = @()
      $end = [Math]::Min($i + $FocusCheckEvery, $chars.Length)
      for ($j = $i; $j -lt $end; $j++) {
        $scan = [uint16]$chars[$j]
        $batch += [InpW32]::Key($scan, 0)
        $batch += [InpW32]::Key($scan, [InpW32]::KEYEVENTF_KEYUP)
        $th = $ThrottleMinMs + $rand.Next([Math]::Max(1, $ThrottleMaxMs - $ThrottleMinMs + 1))
        Start-Sleep -Milliseconds $th
      }
      $sent = [InpW32]::SendBatch($batch)
      if ($sent -ne $batch.Length) { Fail "SENDFAILED" "SendInput delivered $sent/$($batch.Length) events" 9 }
      $sentChars += ($end - $i)
    }
    Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
      ok = $true; action = "type"; chars = $sentChars
    }))
    exit 0
  }
}
