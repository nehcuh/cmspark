# computer-probe.ps1 — WP2 (§T5-8) read-only security-environment probe.
#
# Reports the target window's process integrity level vs our own and the
# input desktop name, as JSON on stdout. READ-ONLY: no SendInput, no
# SetForegroundWindow, no window mutation of any kind — running this probe
# can never trigger a UAC prompt or change focus. The TS executor calls it
# between actions (the app may have been relaunched elevated mid-task, or
# the session switched to a secure desktop); computer-input.ps1 re-checks
# the same conditions at injection time as defense in depth.
#
# stdout contract: single-line JSON { hwnd, pid, ownIl, targetIl, desktop }
# stderr contract (same prefixes as computer-input.ps1):
#   HWNDDEAD:<d> (4)  ILDENIED:<d> (5)  DESKTOPDENIED:<d> (6)
param(
  [Parameter(Mandatory=$true)][long]$Hwnd
)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class ProbeW32 {
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentProcessId();
  [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformation(IntPtr hObj, int index, IntPtr buf, int len, out uint needed);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("advapi32.dll")] public static extern bool OpenProcessToken(IntPtr proc, uint access, out IntPtr token);
  [DllImport("advapi32.dll")] public static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr buf, uint len, out uint retLen);
  [DllImport("advapi32.dll")] public static extern IntPtr GetSidSubAuthority(IntPtr sid, uint n);
  [DllImport("advapi32.dll")] public static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);

  // IL of a process id; -1 on failure (fail-closed signal to the caller).
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

if (-not [ProbeW32]::IsWindow($hwndPtr)) { Fail "HWNDDEAD" "hwnd $Hwnd is not a live window" 4 }

$targetPid = 0
[ProbeW32]::GetWindowThreadProcessId($hwndPtr, [ref]$targetPid) | Out-Null
$ownIl = [ProbeW32]::ProcessIntegrityLevel([ProbeW32]::GetCurrentProcessId())
$targetIl = [ProbeW32]::ProcessIntegrityLevel($targetPid)
if ($ownIl -lt 0 -or $targetIl -lt 0) {
  Fail "ILDENIED" "integrity-level probe failed (own=$ownIl target=$targetIl) — fail-closed" 5
}

$desk = [ProbeW32]::InputDesktopName()
if ($null -eq $desk) { Fail "DESKTOPDENIED" "OpenInputDesktop failed" 6 }

Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
  hwnd = $Hwnd; pid = $targetPid; ownIl = $ownIl; targetIl = $targetIl; desktop = $desk
}))
exit 0
