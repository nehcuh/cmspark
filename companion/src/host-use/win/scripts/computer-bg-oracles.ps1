# computer-bg-oracles.ps1 — oracles that make the word "background" mean something (#572).
#
# WHY: our delivery path (computer-input.ps1) is SendInput and therefore REQUIRES the target
# to be foreground. computer-uia-invoke.ps1 delivers through UIA action patterns and never
# touches the foreground — but "never touches it" must be PROVEN, not asserted. The capability
# ledger (docs/computer-capability-ledger.md) therefore refuses to record a target as
# background-`Delivered` until these oracles pass. cua-driver demands the same of its own
# rows ("All shared background rows require fixture state, focus, z-order, and no-leaked-input
# evidence").
#
# OBSERVED ORACLES (measured, not inferred)
#   focus_kept    — the foreground window is the SAME before and after.
#   zorder_kept   — the visible top-level window order (top-first) is unchanged.
#   cursor_kept   — the pointer did not move.
#
# DERIVED ORACLE (honest about what it is)
#   no_leaked_input — NOT measured directly. It is inferred from: focus_kept AND cursor_kept
#     AND the caller telling us the delivery was UIA-pattern (`-Delivery uia-pattern`).
#     Rationale: SendInput injects into the input queue and therefore targets whatever holds
#     focus, and a pointer move is the cheapest way to leak; UIA patterns act on an element
#     and need neither. This is a strong proxy, NOT a proof — so the ledger records it as
#     derived, and a future input-queue observer could upgrade it to observed.
#     `-Delivery sendinput` deliberately fails this oracle (it is the foreground path).
#
# stdout: omit — results go to -Out as a single-line JSON object.
# stderr: CODE:<detail>
# exit:   2 BADARGS · 3 ORACLE_READ_FAILED · 4 ORACLE_UNREADABLE_SNAPSHOT
param(
  [Parameter(Mandatory=$true)][ValidateSet('snapshot','compare')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$Out,
  [string]$Before = '',
  [string]$After = '',
  [long]$TargetHwnd = 0,
  [ValidateSet('uia-pattern','sendinput')][string]$Delivery = 'uia-pattern',
  # Top-N visible top-level windows to compare for z-order.
  [int]$ZOrderDepth = 16
)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

function Fail([string]$prefix, [string]$detail, [int]$code) {
  [Console]::Error.WriteLine("${prefix}:$detail")
  exit $code
}

Add-Type -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
public delegate bool EnumProc(IntPtr h, IntPtr l);
'@ -Name Bg -Namespace CU | Out-Null

if ($ZOrderDepth -lt 1 -or $ZOrderDepth -gt 128) { Fail "BADARGS" "ZOrderDepth $ZOrderDepth out of range 1..128" 2 }
if ($Mode -eq 'compare') {
  if ($Before -eq '' -or $After -eq '') { Fail "BADARGS" "compare requires -Before and -After" 2 }
}

function Get-ZOrder([int]$depth) {
  # EnumWindows enumerates in z-order, top-most first.
  $list = New-Object System.Collections.Generic.List[int64]
  $cb = [CU.Bg+EnumProc]{
    param($h, $l)
    if ($list.Count -ge $depth) { return $false }
    if ([CU.Bg]::IsWindowVisible($h)) { [void]$list.Add($h.ToInt64()) }
    return $true
  }
  [void][CU.Bg]::EnumWindows($cb, [IntPtr]::Zero)
  return $list
}

function Get-Snapshot {
  $fg = [CU.Bg]::GetForegroundWindow()
  $p = New-Object CU.Bg+POINT
  $gotPos = [CU.Bg]::GetCursorPos([ref]$p)
  return [ordered]@{
    ts = [DateTime]::UtcNow.ToString('o')
    foreground = $fg.ToInt64()
    cursor = [ordered]@{ x = [int]$p.X; y = [int]$p.Y; got = [bool]$gotPos }
    zorder = @(Get-ZOrder $ZOrderDepth)
  }
}

function Write-Json([string]$path, $obj) {
  try { [IO.File]::WriteAllText($path, (ConvertTo-Json -Compress -Depth 6 -InputObject $obj)) }
  catch { Fail "ORACLE_READ_FAILED" "cannot write $path : $($_.Exception.Message)" 3 }
}

if ($Mode -eq 'snapshot') {
  $snap = Get-Snapshot
  Write-Json $Out $snap
  exit 0
}

# --- compare ---------------------------------------------------------------
try {
  $b = Get-Content -Raw $Before | ConvertFrom-Json
  $a = Get-Content -Raw $After  | ConvertFrom-Json
} catch { Fail "ORACLE_UNREADABLE_SNAPSHOT" "$($_.Exception.Message)" 4 }
if ($null -eq $b.foreground -or $null -eq $a.foreground) {
  Fail "ORACLE_UNREADABLE_SNAPSHOT" "snapshot missing 'foreground'" 4
}

$focusKept = ([int64]$b.foreground -eq [int64]$a.foreground)
$cursorKept = ([int]$b.cursor.x -eq [int]$a.cursor.x) -and ([int]$b.cursor.y -eq [int]$a.cursor.y)

# z-order: compare the same prefix; a window appearing/disappearing is a real change, but a
# window that merely got destroyed behind us should not be reported as "the order changed".
$bz = @($b.zorder); $az = @($a.zorder)
$zLen = [Math]::Min($bz.Count, $az.Count)
$zDiffAt = -1
for ($i = 0; $i -lt $zLen; $i++) {
  if ([int64]$bz[$i] -ne [int64]$az[$i]) { $zDiffAt = $i; break }
}
$zorderKept = ($zDiffAt -lt 0)

# The derived oracle, stated as derived.
$leakOk = $focusKept -and $cursorKept -and ($Delivery -eq 'uia-pattern')

$result = [ordered]@{
  ok = $true
  delivery = $Delivery
  target_hwnd = [int64]$TargetHwnd
  focus_kept = $focusKept
  zorder_kept = $zorderKept
  cursor_kept = $cursorKept
  no_leaked_input = $leakOk
  no_leaked_input_kind = 'derived'
  background_verified = ($focusKept -and $zorderKept -and $cursorKept -and $leakOk)
  before = [ordered]@{ foreground = [int64]$b.foreground; cursor = $b.cursor }
  after = [ordered]@{ foreground = [int64]$a.foreground; cursor = $a.cursor }
  zorder_diff_at = $zDiffAt
  ms = 0
}
Write-Json $Out $result
exit 0
