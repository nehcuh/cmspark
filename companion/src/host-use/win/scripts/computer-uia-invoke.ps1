# computer-uia-invoke.ps1 — #572 background delivery via UIA **action patterns**.
#
# WHY: locate (computer-uia-locate.ps1) already finds elements through UIA, but the
# delivery path is computer-input.ps1 = SendInput, which requires the window to be
# FOREGROUND (SetForegroundWindow + FOCUSLOST refusal). Raising the foreground costs a
# one-shot L2 confirmation (5s window), so multi-step tasks are effectively unreachable
# (#534 / #530). cua-driver's approach is the other axis: having found the element via
# UIA, deliver the ACTION through UIA (Invoke/SetValue/Select/Toggle/Scroll) and never
# touch the foreground.
#
# CONTRACT (this is an ACTION, not a probe):
#   * Never falls back to blind coordinates. If the element cannot be re-found we refuse
#     with UIA_ELEMENT_GONE and the caller must re-locate. A stale coordinate is exactly
#     the stale-frame class of defect we already fought (#532).
#   * Identity is re-verified against the locate result (controlType / automationId).
#     A mismatch refuses with UIA_ELEMENT_MISMATCH — a forged/renamed node must not be
#     silently actioned just because its accessible Name matched.
#   * Every unsupported case returns a PRECISE code, never a generic failure:
#     UIA_PATTERN_UNAVAILABLE lists the patterns tried and why each was rejected.
#   * Traversal + adversarial size caps mirror computer-uia-locate.ps1 (a forged node
#     inflating its bbox to swallow the anchor text is dropped at the source).
#
# stdout: single-line JSON
#   { ok:true, mode, name, controlType, automationId, x, y, bbox, tried:[...], ms }
# stderr: CODE:<detail>
# exit:   2 BADARGS · 3 UIA_WINDOW_GONE · 4 UIA_ELEMENT_GONE · 5 UIA_ELEMENT_MISMATCH
#         6 UIA_PATTERN_UNAVAILABLE · 7 UIA_METHOD_FAILED · 11 STOPPED (emergency stop)
#
# NOTE: gaining authority to act is NOT this script's job — the TS layer keeps the same
# action gates (L2 / evidence chain) as any other action. This script only performs the
# delivery once the caller has already been authorised.
param(
  [Parameter(Mandatory=$true)][long]$Hwnd,
  [Parameter(Mandatory=$true)][string]$Name,
  [ValidateSet('auto','invoke','setvalue','select','toggle','scroll')][string]$Mode = 'auto',
  [string]$Value = '',
  [ValidateSet('up','down','left','right')][string]$Direction = 'down',
  [int]$ScrollAmount = 1,
  [string]$ExpectControlType = '',
  [string]$ExpectAutomationId = '',
  [int]$MaxDepth = 24,
  [int]$MaxNodes = 4000,
  # WP2 (E.6): emergency-stop flag. The CALLER (PsInputInjector.withStop) appends this to
  # every injector call, so omitting it here does not "opt out" — it makes the parameter
  # binding fail outright and the whole background route silently degrade to the
  # foreground path. That is exactly what shipped in the first cut of #572 and was caught
  # only by review, because the adapter tests use a fake runner (no argv binding) and the
  # manual E2E drove this script without the flag. Keep it, and keep it checked.
  [string]$StopFile = ''
)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr v);' -Name DPI -Namespace CU | Out-Null
try { [CU.DPI]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null } catch {}

function Fail([string]$prefix, [string]$detail, [int]$code) {
  [Console]::Error.WriteLine("${prefix}:$detail")
  exit $code
}
if ($Name.Trim() -eq '') { Fail "BADARGS" "Name must be non-empty" 2 }
if ($MaxDepth -lt 1 -or $MaxDepth -gt 64) { Fail "BADARGS" "MaxDepth $MaxDepth out of range 1..64" 2 }
if ($MaxNodes -lt 1 -or $MaxNodes -gt 50000) { Fail "BADARGS" "MaxNodes $MaxNodes out of range 1..50000" 2 }
if ($Mode -eq 'setvalue' -and $Value -eq '') { Fail "BADARGS" "setvalue requires -Value" 2 }
if ($Mode -eq 'scroll' -and ($ScrollAmount -lt 1 -or $ScrollAmount -gt 50)) { Fail "BADARGS" "ScrollAmount $ScrollAmount out of range 1..50" 2 }

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool IsWindow(System.IntPtr h);' -Name W32 -Namespace CU | Out-Null

# WP2 (E.6): emergency-stop flag — its mere presence aborts, fail-closed. Mirrors
# computer-input.ps1's Test-StopFlag (same prefix, same exit code) so the caller sees one
# vocabulary on both delivery paths.
function Test-StopFlag {
  if ($StopFile -ne '' -and (Test-Path -LiteralPath $StopFile)) {
    Fail "STOPPED" "emergency-stop flag present — delivery aborted" 11
  }
}

$sw = [Diagnostics.Stopwatch]::StartNew()
Test-StopFlag
if (-not [CU.W32]::IsWindow([IntPtr]$Hwnd)) { Fail "UIA_WINDOW_GONE" "Hwnd $Hwnd is not a window" 3 }
Test-StopFlag

# NFKC + case-insensitive anchor normalisation (mirrors locate).
function Normalize-Anchor([string]$s) {
  $n = $s.Normalize([Text.NormalizationForm]::FormKC)
  return $n.Trim().ToLowerInvariant()
}
$anchor = Normalize-Anchor $Name

try { $rootEl = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd) }
catch { Fail "UIA_WINDOW_GONE" "FromHandle failed: $($_.Exception.Message)" 3 }
if ($null -eq $rootEl) { Fail "UIA_WINDOW_GONE" "FromHandle returned null" 3 }

$wv = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$nodes = 0
$oversized = 0
$exact = New-Object System.Collections.ArrayList
$subs = New-Object System.Collections.ArrayList
$stack = New-Object System.Collections.Stack
$stack.Push(@($rootEl, 0))
while ($stack.Count -gt 0) {
  $pair = $stack.Pop()
  $cur = $pair[0]; $depth = [int]$pair[1]
  if ($depth -ge $MaxDepth) { continue }
  $nodes++
  if ($nodes -gt $MaxNodes) { break }
  # The tree walk is the one long-running part of this script; check the stop flag
  # periodically so an emergency stop is not held hostage by a large tree.
  if (($nodes % 128) -eq 0) { Test-StopFlag }
  $nm = ''
  try { $nm = $cur.Current.Name } catch { $nm = '' }
  if ($nm -ne '') {
    $nn = Normalize-Anchor $nm
    $isExact = ($nn -eq $anchor)
    $isSub = ((-not $isExact) -and $nn.Contains($anchor))
    if ($isExact -or $isSub) {
      $off = $true; $rr = $null
      try { $off = [bool]$cur.Current.IsOffscreen } catch { $off = $true }
      if (-not $off) { try { $rr = $cur.Current.BoundingRectangle } catch { $rr = $null } }
      if (($null -ne $rr) -and $rr.Width -gt 0 -and $rr.Height -gt 0) {
        # X1 (WP3 adversary): dual bbox size cap — same caps as locate. An oversized
        # element is never a legitimate interactive target; a forged node inflates its
        # bbox exactly this way to swallow the real anchor text. Dropped, fail-closed.
        $wr = $null
        try { $wr = $rootEl.Current.BoundingRectangle } catch { $wr = $null }
        $bboxArea = [double]$rr.Width * [double]$rr.Height
        $winArea = 0.0
        if ($null -ne $wr) { $winArea = [double]$wr.Width * [double]$wr.Height }
        if ($bboxArea -gt 150000 -or ($winArea -gt 0 -and ($bboxArea / $winArea) -gt 0.3)) {
          $oversized++
        } else {
          $ct = ''; $aid = ''
          try { $ct = $cur.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '' } catch {}
          try { $aid = $cur.Current.AutomationId } catch {}
          $hitObj = [ordered]@{
            el = $cur
            name = $nm; controlType = $ct; automationId = $aid
            x = [int]($rr.X + $rr.Width / 2); y = [int]($rr.Y + $rr.Height / 2)
            bbox = [ordered]@{ x = [int]$rr.X; y = [int]$rr.Y; w = [int]$rr.Width; h = [int]$rr.Height }
          }
          if ($isExact) { [void]$exact.Add($hitObj) } else { [void]$subs.Add($hitObj) }
        }
      }
    }
  }
  try {
    $child = $wv.GetFirstChild($cur)
    while ($null -ne $child) {
      $stack.Push(@($child, $depth + 1))
      $child = $wv.GetNextSibling($child)
    }
  } catch {}
}

# Selection: the FIRST exact hit (tree order) wins — including when several exact hits exist;
# otherwise the first substring hit. Deliberately the SAME
# rule as locate, so an invoke can never target something locate would not have returned.
$hit = $null
if ($exact.Count -ge 1) { $hit = $exact[0] }
elseif ($subs.Count -ge 1) { $hit = $subs[0] }
if ($null -eq $hit) {
  Fail "UIA_ELEMENT_GONE" "anchor '$Name' not found (nodes=$nodes oversized=$oversized) — re-locate; no blind coordinate fallback" 4
}
$el = $hit.el

# Identity re-verification against the locate result. A renamed/reused node must not be
# actioned merely because its accessible Name matched the anchor.
if ($ExpectControlType -ne '' -and $hit.controlType -ne $ExpectControlType) {
  Fail "UIA_ELEMENT_MISMATCH" "controlType expected '$ExpectControlType' got '$($hit.controlType)'" 5
}
if ($ExpectAutomationId -ne '' -and $hit.automationId -ne $ExpectAutomationId) {
  Fail "UIA_ELEMENT_MISMATCH" "automationId expected '$ExpectAutomationId' got '$($hit.automationId)'" 5
}

# --- pattern delivery -------------------------------------------------------
# `auto` tries the least-destructive, most-specific semantic route first. We never
# synthesize input here — these are UIA action patterns, which is exactly why the
# foreground is not needed.
$tried = New-Object System.Collections.Generic.List[string]

function Try-Pattern([string]$pname, [System.Windows.Automation.AutomationPattern]$pattern, [scriptblock]$act) {
  $obj = $null
  try {
    if (-not $el.TryGetCurrentPattern($pattern, [ref]$obj)) { [void]$tried.Add("${pname}:unsupported"); return $false }
  } catch { [void]$tried.Add("${pname}:threw(" + $_.Exception.Message.Replace([char]10, [char]32).Replace([char]13, [char]32) + ")"); return $false }
  if ($null -eq $obj) { [void]$tried.Add("${pname}:null"); return $false }
  try { & $act $obj; [void]$tried.Add("${pname}:ok"); return $true }
  catch { [void]$tried.Add("${pname}:failed(" + $_.Exception.Message.Replace([char]10, [char]32).Replace([char]13, [char]32) + ")"); return $false }
}

# Last check immediately before the ACT: a stop raised while we were re-verifying identity
# must still prevent the delivery.
Test-StopFlag

$used = $null

if ($Mode -eq 'invoke') {
  if (Try-Pattern 'invoke' ([System.Windows.Automation.InvokePattern]::Pattern) { param($o) ([System.Windows.Automation.InvokePattern]$o).Invoke() }) { $used = 'invoke' }
} elseif ($Mode -eq 'setvalue') {
  if (Try-Pattern 'setvalue' ([System.Windows.Automation.ValuePattern]::Pattern) { param($o) ([System.Windows.Automation.ValuePattern]$o).SetValue($Value) }) { $used = 'setvalue' }
} elseif ($Mode -eq 'select') {
  if (Try-Pattern 'select' ([System.Windows.Automation.SelectionItemPattern]::Pattern) { param($o) ([System.Windows.Automation.SelectionItemPattern]$o).Select() }) { $used = 'select' }
} elseif ($Mode -eq 'toggle') {
  if (Try-Pattern 'toggle' ([System.Windows.Automation.TogglePattern]::Pattern) { param($o) ([System.Windows.Automation.TogglePattern]$o).Toggle() }) { $used = 'toggle' }
} elseif ($Mode -eq 'scroll') {
  $hAmt = [System.Windows.Automation.ScrollAmount]::NoAmount
  $vAmt = [System.Windows.Automation.ScrollAmount]::NoAmount
  if ($Direction -eq 'down') { $vAmt = [System.Windows.Automation.ScrollAmount]::SmallIncrement }
  elseif ($Direction -eq 'up') { $vAmt = [System.Windows.Automation.ScrollAmount]::SmallDecrement }
  elseif ($Direction -eq 'right') { $hAmt = [System.Windows.Automation.ScrollAmount]::SmallIncrement }
  elseif ($Direction -eq 'left') { $hAmt = [System.Windows.Automation.ScrollAmount]::SmallDecrement }
  $n = $ScrollAmount
  if (Try-Pattern 'scroll' ([System.Windows.Automation.ScrollPattern]::Pattern) { param($o) $sp = [System.Windows.Automation.ScrollPattern]$o; for ($i = 0; $i -lt $n; $i++) { $sp.Scroll($hAmt, $vAmt) } }) { $used = 'scroll' }
} else {
  # auto
  if (Try-Pattern 'invoke' ([System.Windows.Automation.InvokePattern]::Pattern) { param($o) ([System.Windows.Automation.InvokePattern]$o).Invoke() }) {
    $used = 'invoke'
  } elseif ($Value -ne '') {
    if (Try-Pattern 'setvalue' ([System.Windows.Automation.ValuePattern]::Pattern) { param($o) ([System.Windows.Automation.ValuePattern]$o).SetValue($Value) }) { $used = 'setvalue' }
  }
  if ($null -eq $used) {
    if (Try-Pattern 'select' ([System.Windows.Automation.SelectionItemPattern]::Pattern) { param($o) ([System.Windows.Automation.SelectionItemPattern]$o).Select() }) { $used = 'select' }
  }
  if ($null -eq $used) {
    if (Try-Pattern 'toggle' ([System.Windows.Automation.TogglePattern]::Pattern) { param($o) ([System.Windows.Automation.TogglePattern]$o).Toggle() }) { $used = 'toggle' }
  }
}

if ($null -eq $used) {
  Fail "UIA_PATTERN_UNAVAILABLE" "no usable UIA action pattern for '$($hit.name)' ($($hit.controlType)) tried=[$($tried -join ', ')]" 6
}

Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
  ok = $true; mode = $used; name = $hit.name; controlType = $hit.controlType
  automationId = $hit.automationId; x = $hit.x; y = $hit.y; bbox = $hit.bbox
  tried = @($tried); foreground = $false; ms = [int]$sw.ElapsedMilliseconds
}))
exit 0
