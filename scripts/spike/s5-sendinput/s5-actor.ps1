# S-5 spike actor: unsigned-context medium-IL process driving the S5 test window.
# Tests: T1 SetForegroundWindow x10 / T2 click x10 / T3 unicode CJK type / T4 IME-active type
#        T5 injected-flag observation / T6 200-key burst drop rate.
# READ-ONLY toward third-party apps: only touches the S5 test window.
# NOTE: this file MUST keep its UTF-8 BOM — PS 5.1 parses BOM-less files as ANSI and breaks on the CJK string literals.
param([string]$OutDir = $PSScriptRoot)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'

Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr v);' -Name DPI -Namespace S5A
[S5A.DPI]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null

Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] p, int cb);

  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL, wParamH; }
  [StructLayout(LayoutKind.Explicit)] public struct U { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public HARDWAREINPUT hi; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public U u; }

  public const uint MOUSEEVENTF_MOVE=0x1, MOUSEEVENTF_LEFTDOWN=0x2, MOUSEEVENTF_LEFTUP=0x4,
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
  public static void SendBatch(INPUT[] arr){ SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT))); }
  public static bool ForceForeground(IntPtr hwnd){
    ShowWindow(hwnd, 9); // SW_RESTORE
    IntPtr fg = GetForegroundWindow();
    uint dummy; uint fgTid = GetWindowThreadProcessId(fg, out dummy);
    uint myTid = GetCurrentThreadId();
    bool ok = false;
    if (fgTid != myTid) AttachThreadInput(myTid, fgTid, true);
    try { ok = SetForegroundWindow(hwnd); BringWindowToTop(hwnd); }
    finally { if (fgTid != myTid) AttachThreadInput(myTid, fgTid, false); }
    return ok;
  }
}
'@

function Read-State { try { (Get-Content (Join-Path $OutDir 'state.json') -Raw | ConvertFrom-Json) } catch { $null } }
function Send-Cmd($name, $body) { Set-Content (Join-Path $OutDir "cmd-$name.txt") -Value $body -Encoding UTF8 }
function Wait-Cond($cond, $timeoutMs) { $dl = (Get-Date).AddMilliseconds($timeoutMs); while ((Get-Date) -lt $dl) { $s = & $cond; if ($s) { return $s }; Start-Sleep -Milliseconds 150 }; return $null }

$result = [ordered]@{ timestamp = (Get-Date).ToString('o'); env = @{}; tests = [ordered]@{} }

# env
$os = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion')
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object Security.Principal.WindowsPrincipal($id)
$result.env = [ordered]@{
  osBuild = $os.CurrentBuild; displayVersion = $os.DisplayVersion
  elevated = $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  actorPid = $PID; actorProcess = (Get-Process -Id $PID).ProcessName
}

# wait for target
$ready = Wait-Cond { try { Get-Content (Join-Path $OutDir 'ready.json') -Raw | ConvertFrom-Json } catch { $null } } 20000
if (-not $ready) { $result.tests.fatal = 'target not ready in 20s'; $result | ConvertTo-Json -Depth 6; exit 1 }
$hwnd = [IntPtr]$ready.hwnd
$result.targetPid = $ready.pid

$null = Wait-Cond { Read-State } 8000

# ---------- T1: SetForegroundWindow from background, 10 rounds ----------
$t1ok = 0
for ($i = 0; $i -lt 10; $i++) {
  Send-Cmd "t1-$i" 'focus-thief'
  Start-Sleep -Milliseconds 500                       # thief (in-process) grabs foreground
  [W32]::ForceForeground($hwnd) | Out-Null            # actor (external process) restores
  $fg = Wait-Cond { if ([W32]::GetForegroundWindow() -eq $hwnd) { $true } else { $null } } 1500
  if ($fg) { $t1ok++ }
  Send-Cmd "t1h-$i" 'hide-thief'
}
$result.tests.T1_foreground = [ordered]@{ ok = $t1ok; total = 10; pass = ($t1ok -ge 9) }

# ---------- T2: click button x10 ----------
[W32]::ForceForeground($hwnd) | Out-Null; Start-Sleep -Milliseconds 300
$s0 = Read-State; $c0 = [int]$s0.clicks
$bx = [int]$s0.btnCenter.x; $by = [int]$s0.btnCenter.y
for ($i = 0; $i -lt 10; $i++) {
  [W32]::SendBatch(@([W32]::Mouse($bx, $by, [W32]::MOUSEEVENTF_MOVE),
                    [W32]::Mouse($bx, $by, [W32]::MOUSEEVENTF_LEFTDOWN),
                    [W32]::Mouse($bx, $by, [W32]::MOUSEEVENTF_LEFTUP)))
  Start-Sleep -Milliseconds 80
}
$s1 = Wait-Cond { $s = Read-State; if ([int]$s.clicks -ge ($c0 + 10)) { $s } } 4000
$t2c = if ($s1) { [int]$s1.clicks - $c0 } else { (Read-State).clicks - $c0 }
$result.tests.T2_click = [ordered]@{ delivered = $t2c; total = 10; at = "$bx,$by"; pass = ($t2c -eq 10) }

# ---------- T3: unicode CJK type ----------
Send-Cmd t3 'clear'; Start-Sleep -Milliseconds 400
Send-Cmd t3f 'focus-tb'; Start-Sleep -Milliseconds 400
[W32]::ForceForeground($hwnd) | Out-Null; Start-Sleep -Milliseconds 200
$text3 = '青花瓷 Hello123'
$arr = @(); foreach ($ch in $text3.ToCharArray()) { $arr += [W32]::Key([uint16]$ch, 0); $arr += [W32]::Key([uint16]$ch, [W32]::KEYEVENTF_KEYUP) }
[W32]::SendBatch($arr)
$s3 = Wait-Cond { $s = Read-State; if ($s.text -eq $text3) { $s } } 4000
$result.tests.T3_unicodeType = [ordered]@{ want = $text3; got = if ($s3) { $s3.text } else { (Read-State).text }; pass = [bool]$s3 }

# ---------- T4: IME-active type ----------
Remove-Item (Join-Path $OutDir 'ime-ack.txt') -Force -ErrorAction SilentlyContinue
Send-Cmd t4 'ime-on:zh-CN'
$ack = Wait-Cond { try { (Get-Content (Join-Path $OutDir 'ime-ack.txt') -Raw).Trim() } catch { $null } } 5000
if ($ack -and $ack.StartsWith('OK')) {
  Send-Cmd t4c 'clear'; Start-Sleep -Milliseconds 400
  Send-Cmd t4f 'focus-tb'; Start-Sleep -Milliseconds 300
  $text4 = '青花瓷测试'
  $arr4 = @(); foreach ($ch in $text4.ToCharArray()) { $arr4 += [W32]::Key([uint16]$ch, 0); $arr4 += [W32]::Key([uint16]$ch, [W32]::KEYEVENTF_KEYUP) }
  [W32]::SendBatch($arr4)
  $s4 = Wait-Cond { $s = Read-State; if ($s.text -eq $text4) { $s } } 4000
  $result.tests.T4_imeActive = [ordered]@{ ime = $ack; want = $text4; got = if ($s4) { $s4.text } else { (Read-State).text }; pass = [bool]$s4 }
} else {
  $result.tests.T4_imeActive = [ordered]@{ skip = "no zh-CN IME installed (ack=$ack)"; pass = $null }
}

# ---------- T5 + T6: injected flag + 200-key burst ----------
Send-Cmd t6 'clear'; Start-Sleep -Milliseconds 400
Send-Cmd t6f 'focus-tb'; Start-Sleep -Milliseconds 300
$burst = @(); for ($i = 0; $i -lt 200; $i++) { $burst += [W32]::Key([uint16][char]'a', 0); $burst += [W32]::Key([uint16][char]'a', [W32]::KEYEVENTF_KEYUP) }
[W32]::SendBatch($burst)
$s6 = Wait-Cond { $s = Read-State; if ($s.text.Length -ge 200) { $s } } 8000
$sf = Read-State
$recv = $sf.text.Length
$result.tests.T5_injectedFlag = [ordered]@{ hookEvents = $sf.keys; injectedFlagged = $sf.injected; note = 'OSR apps CAN filter on LLKHF_INJECTED; desktop apps typically do not' }
$result.tests.T6_keyBurst = [ordered]@{ sent = 200; received = $recv; dropRate = (200 - $recv) / 200.0; pass = ($recv -ge 199) }

# verdict
$core = @($result.tests.T1_foreground.pass, $result.tests.T2_click.pass, $result.tests.T3_unicodeType.pass, $result.tests.T6_keyBurst.pass)
$result.verdict = [ordered]@{
  s5Pass = (@($core | Where-Object { $_ -eq $true }).Count -eq 4)
  imeCase = if ($null -eq $result.tests.T4_imeActive.pass) { 'SKIP' } elseif ($result.tests.T4_imeActive.pass) { 'PASS' } else { 'FAIL' }
}

$out = Join-Path $OutDir 's5-result.json'
$result | ConvertTo-Json -Depth 6 | Set-Content $out -Encoding UTF8
$result | ConvertTo-Json -Depth 6
