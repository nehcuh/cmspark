# Selection-only UIA endpoint. Host owns the separate clean action and total15s budget.
# Discovery below retains the original bounded anchor and physical-identity checks.
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
  [string]$StopFile = '',
  # Private first-party built DLL; Companion supplies this, never the model.
  [string]$NoFocusLibrary = ''
)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

Microsoft.PowerShell.Utility\Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr v);' -Name DPI -Namespace CU | Out-Null
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

Microsoft.PowerShell.Utility\Add-Type -AssemblyName UIAutomationClient
Microsoft.PowerShell.Utility\Add-Type -AssemblyName UIAutomationTypes
Microsoft.PowerShell.Utility\Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool IsWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);' -Name W32 -Namespace CU | Out-Null

# WP2 (E.6): emergency-stop flag — its mere presence aborts, fail-closed. Mirrors
# computer-input.ps1's Test-StopFlag (same prefix, same exit code) so the caller sees one
# vocabulary on both delivery paths.
function Test-StopFlag {
  if ($StopFile -ne '' -and (Microsoft.PowerShell.Management\Test-Path -LiteralPath $StopFile)) {
    Fail "STOPPED" "emergency-stop flag present — delivery aborted" 11
  }
}

$sw = [Diagnostics.Stopwatch]::StartNew()
# Checked at entry, every 128 nodes through the walk, and once more immediately before the
# act. (The walk and pre-act checks are the load-bearing ones for a stop raised *during* the
# action; this one covers the trivial case where the flag was already up on arrival.)
Test-StopFlag
if (-not [CU.W32]::IsWindow([IntPtr]$Hwnd)) { Fail "UIA_WINDOW_GONE" "Hwnd $Hwnd is not a window" 3 }
[uint32]$rootOwnerPid = 0
if ([CU.W32]::GetWindowThreadProcessId([IntPtr]$Hwnd, [ref]$rootOwnerPid) -eq 0 -or $rootOwnerPid -eq 0) { Fail "UIA_WINDOW_GONE" "window owner unavailable" 3 }

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
$exact = Microsoft.PowerShell.Utility\New-Object System.Collections.ArrayList
$subs = Microsoft.PowerShell.Utility\New-Object System.Collections.ArrayList
$stack = Microsoft.PowerShell.Utility\New-Object System.Collections.Stack
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

# Freeze independent root/selected identities in this request. RuntimeId is opaque,
# desktop-scoped and reusable; it does not replace the existing authority checks.
try {
  [int[]]$selectedRuntime = $el.GetRuntimeId()
  [uint32]$selectedPid = $el.Current.ProcessId
  $selectedControlType = $el.Current.ControlType
  [int]$selectedType = $selectedControlType.Id
  [string]$selectedAutomationId = $el.Current.AutomationId
  [string]$selectedTypeName = $selectedControlType.ProgrammaticName -replace '^ControlType\.', ''
} catch { Fail "UIA_TERMINAL" "UIA_ELEMENT_GONE" 4 }
# Preserve the original locate/hit binding: a renamed or retyped current element
# must not replace the already verified expected identity with its new identity.
if (-not [string]::Equals($selectedAutomationId, [string]$hit.automationId, [StringComparison]::Ordinal) -or -not [string]::Equals($selectedTypeName, [string]$hit.controlType, [StringComparison]::Ordinal)) {
  Fail "UIA_TERMINAL" "UIA_ELEMENT_MISMATCH" 5
}
if ($null -eq $selectedRuntime -or $selectedRuntime.Length -lt 1 -or $selectedRuntime.Length -gt 64) {
  Fail "UIA_TERMINAL" "UIA_ELEMENT_MISMATCH" 5
}


# Selection-only endpoint. No method is called in this process.
$patterns = [Collections.Generic.List[object]]::new()
function Select-Pattern([string]$pname, [System.Windows.Automation.AutomationPattern]$pattern) {
  Test-StopFlag
  $obj = $null; $state = 'ready'
  try {
    if (-not $el.TryGetCurrentPattern($pattern, [ref]$obj)) { $state = 'unsupported' }
    elseif ($null -eq $obj) { $state = 'null' }
  } catch { $state = 'threw' }
  $patterns.Add([ordered]@{ mode = $pname; state = $state })
}
if ($Mode -eq 'auto') {
  Select-Pattern 'invoke' ([System.Windows.Automation.InvokePattern]::Pattern)
  if ($Value -ne '') { Select-Pattern 'setvalue' ([System.Windows.Automation.ValuePattern]::Pattern) }
  Select-Pattern 'select' ([System.Windows.Automation.SelectionItemPattern]::Pattern)
  Select-Pattern 'toggle' ([System.Windows.Automation.TogglePattern]::Pattern)
} else {
  switch ($Mode) {
    'invoke' { Select-Pattern 'invoke' ([System.Windows.Automation.InvokePattern]::Pattern) }
    'setvalue' { Select-Pattern 'setvalue' ([System.Windows.Automation.ValuePattern]::Pattern) }
    'select' { Select-Pattern 'select' ([System.Windows.Automation.SelectionItemPattern]::Pattern) }
    'toggle' { Select-Pattern 'toggle' ([System.Windows.Automation.TogglePattern]::Pattern) }
    'scroll' { Select-Pattern 'scroll' ([System.Windows.Automation.ScrollPattern]::Pattern) }
  }
}
Test-StopFlag
$receipt = Microsoft.PowerShell.Utility\ConvertTo-Json -Compress -Depth 5 -InputObject ([ordered]@{
  schema = 1; hwnd = [long]$Hwnd; rootPid = [uint32]$rootOwnerPid; selectedPid = [uint32]$selectedPid
  runtime = @($selectedRuntime); controlTypeId = [int]$selectedType
  controlType = [string]$hit.controlType; automationId = [string]$selectedAutomationId; name = [string]$hit.name
  x = [int]$hit.x; y = [int]$hit.y; bbox = $hit.bbox; patterns = @($patterns.ToArray())
})
if ($receipt.Length -gt 8192 -or [Text.Encoding]::UTF8.GetByteCount($receipt) -gt 16384) { Fail 'UIA_TERMINAL' 'UIA_ELEMENT_MISMATCH' 5 }
Microsoft.PowerShell.Utility\Write-Output $receipt
exit 0
