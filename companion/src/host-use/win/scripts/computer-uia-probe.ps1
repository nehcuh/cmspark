# computer-uia-probe.ps1 — WP3 READ-ONLY UIA capability probe (plan §K.5).
# Walks the target window's UI Automation CONTROL view (stack-based, bounded)
# and emits tree statistics; the uiaCapable VERDICT is computed TS-side
# (computer/uia.ts) so the thresholds are unit-testable.
#
# READ-ONLY contract: no Invoke/SetValue/SetFocus/SendInput, no window
# manipulation — this script can never mutate UI state or trigger a UAC
# prompt. Production code points it ONLY at L2-confirmed whitelist app
# windows; tests point it at the self-drawn fixture.
#
# stdout contract: single-line JSON document (statistics only — element NAMES
# are deliberately NOT sampled: screen content is user data and the probe
# result feeds logs/evidence).
# stderr contract:
#   HWNDDEAD:<detail>   hwnd is not a live window / has no UIA element
#   BADARGS:<detail>    parameter validation failure
#
# Empirical basis (2026-07-19, Win11): legacy WinForms controls surface via
# the MSAA bridge as ControlType.Pane (NOT Edit/Button) but keep their
# accessible NAME and BoundingRectangle; a UIA-blind OSR app (cloudmusic
# spike) shows only unnamed Panes. The discriminating stat is therefore
# namedOnscreen — depth>=1 elements with a non-empty Name AND an on-screen
# bounding rect — not raw control-type counts.
param(
  [Parameter(Mandatory=$true)][long]$Hwnd,
  [int]$MaxDepth = 16,
  [int]$MaxNodes = 800,
  # Hydration re-check: a suspiciously sparse first pass (< HydrationMinNodes)
  # may mean a dynamic app is still rendering — wait and re-walk ONCE.
  [int]$HydrationMinNodes = 10,
  [int]$HydrationWaitMs = 800
)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

function Fail([string]$prefix, [string]$detail, [int]$code) {
  [Console]::Error.WriteLine("${prefix}:$detail")
  exit $code
}
if ($MaxDepth -lt 1 -or $MaxDepth -gt 64) { Fail "BADARGS" "MaxDepth $MaxDepth out of range 1..64" 2 }
if ($MaxNodes -lt 1 -or $MaxNodes -gt 20000) { Fail "BADARGS" "MaxNodes $MaxNodes out of range 1..20000" 2 }
if ($HydrationWaitMs -lt 0 -or $HydrationWaitMs -gt 10000) { Fail "BADARGS" "HydrationWaitMs out of range" 2 }

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool IsWindow(System.IntPtr h);' -Name W32 -Namespace CUUiaProbe
$hwndPtr = [IntPtr]::new($Hwnd)
if (-not [CUUiaProbe.W32]::IsWindow($hwndPtr)) { Fail "HWNDDEAD" "hwnd $Hwnd is not a live window" 4 }

$ae = [System.Windows.Automation.AutomationElement]
$rootEl = $null
try { $rootEl = $ae::FromHandle($hwndPtr) } catch { $rootEl = $null }
if ($null -eq $rootEl) { Fail "HWNDDEAD" "hwnd $Hwnd has no UIA element (cross-IL or dead)" 4 }

$interactiveTypes = @('Button','Edit','ComboBox','ListItem','MenuItem','TabItem','Hyperlink','CheckBox','RadioButton','Slider','Spinner','SplitButton','TreeItem')

function Get-UiaTreeStats($rootElement) {
  $stats = @{ nodes = 0; maxDepth = 0; edits = 0; documents = 0; interactive = 0; named = 0; namedOnscreen = 0; capped = $false }
  $wv = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $stack = New-Object System.Collections.Stack
  $stack.Push(@{ el = $rootElement; depth = 0 })
  while ($stack.Count -gt 0) {
    if ($stats.nodes -ge $MaxNodes) { $stats.capped = $true; break }
    $node = $stack.Pop(); $cur = $node.el
    $stats.nodes++
    if ($node.depth -gt $stats.maxDepth) { $stats.maxDepth = $node.depth }
    $t = ''; $nm = ''; $offscreen = $true; $rw = 0; $rh = 0
    try { $t = $cur.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '' } catch { $t = '' }
    try { $nm = $cur.Current.Name } catch { $nm = '' }
    try { $offscreen = [bool]$cur.Current.IsOffscreen } catch { $offscreen = $true }
    if (-not $offscreen) {
      try { $rr = $cur.Current.BoundingRectangle; $rw = [int]$rr.Width; $rh = [int]$rr.Height } catch { $rw = 0; $rh = 0 }
    }
    if ($t -eq 'Edit') { $stats.edits++ }
    elseif ($t -eq 'Document') { $stats.documents++ }
    if ($interactiveTypes -contains $t) { $stats.interactive++ }
    # The root element itself (depth 0) is the window — its Name is the title
    # bar text, which every app has; only CHILDREN count as addressable UI.
    if ($node.depth -ge 1 -and $nm -ne '') {
      $stats.named++
      if (-not $offscreen -and $rw -gt 0 -and $rh -gt 0) { $stats.namedOnscreen++ }
    }
    if ($node.depth -lt $MaxDepth) {
      # A vanishing element mid-walk (app closing a pane) ends that branch,
      # never the whole probe.
      try {
        $c = $wv.GetFirstChild($cur)
        while ($c) {
          $stack.Push(@{ el = $c; depth = $node.depth + 1 })
          $c = $wv.GetNextSibling($c)
        }
      } catch { /* branch vanished — continue with the rest of the stack */ }
    }
  }
  return $stats
}

$sw = [Diagnostics.Stopwatch]::StartNew()
$passA = Get-UiaTreeStats $rootEl
$used = $passA
$hydrationRechecked = $false
if ($passA.nodes -lt $HydrationMinNodes) {
  $hydrationRechecked = $true
  Start-Sleep -Milliseconds $HydrationWaitMs
  $used = Get-UiaTreeStats $rootEl
}
$sw.Stop()

Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
  ok = $true
  hwnd = $Hwnd
  nodes = $used.nodes
  maxDepth = $used.maxDepth
  edits = $used.edits
  documents = $used.documents
  interactive = $used.interactive
  named = $used.named
  namedOnscreen = $used.namedOnscreen
  capped = $used.capped
  hydrationRechecked = $hydrationRechecked
  passANodes = $passA.nodes
  ms = [int]$sw.ElapsedMilliseconds
}))
exit 0
