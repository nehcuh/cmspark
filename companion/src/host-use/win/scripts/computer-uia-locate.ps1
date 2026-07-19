# computer-uia-locate.ps1 — WP3 L0 UIA locator (plan §B.1).
# READ-ONLY live-tree locate by accessible-Name anchor. Returns the element
# center + bounding rect in SCREEN physical pixels (UIA BoundingRectangle is
# screen-space; the TS chain maps them into capture image space).
#
# READ-ONLY contract: no Invoke/SetValue/SetFocus/SendInput — same read-only
# discipline as computer-uia-probe.ps1.
#
# Matching (NFKC + case-insensitive, anchor = $Name):
#   exact unique      -> confidence 1.0 (plan §B.2 UIA)
#   exact ambiguous   -> confidence 0.9 (first in tree order; candidates>1)
#   substring         -> confidence 0.8
# Offscreen / zero-rect elements are never returned (not clickable).
#
# stdout contract: single-line JSON document.
# stderr contract:
#   HWNDDEAD:<detail>   hwnd is not a live window / has no UIA element
#   BADARGS:<detail>    parameter validation failure
param(
  [Parameter(Mandatory=$true)][long]$Hwnd,
  [Parameter(Mandatory=$true)][string]$Name,
  [int]$MaxDepth = 24,
  [int]$MaxNodes = 4000
)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr v);' -Name DPI -Namespace CU
try { [CU.DPI]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null } catch {}

function Fail([string]$prefix, [string]$detail, [int]$code) {
  [Console]::Error.WriteLine("${prefix}:$detail")
  exit $code
}
if ($Name.Trim() -eq '') { Fail "BADARGS" "Name must be non-empty" 2 }
if ($MaxDepth -lt 1 -or $MaxDepth -gt 64) { Fail "BADARGS" "MaxDepth $MaxDepth out of range 1..64" 2 }
if ($MaxNodes -lt 1 -or $MaxNodes -gt 50000) { Fail "BADARGS" "MaxNodes $MaxNodes out of range 1..50000" 2 }

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool IsWindow(System.IntPtr h);' -Name W32 -Namespace CUUiaLocate
$hwndPtr = [IntPtr]::new($Hwnd)
if (-not [CUUiaLocate.W32]::IsWindow($hwndPtr)) { Fail "HWNDDEAD" "hwnd $Hwnd is not a live window" 4 }

function Normalize-Anchor([string]$s) {
  if ($null -eq $s) { return '' }
  return $s.Normalize([Text.NormalizationForm]::FormKC).Trim()
}
$anchor = Normalize-Anchor $Name
$anchorLower = $anchor.ToLowerInvariant()

$ae = [System.Windows.Automation.AutomationElement]
$rootEl = $null
try { $rootEl = $ae::FromHandle($hwndPtr) } catch { $rootEl = $null }
if ($null -eq $rootEl) { Fail "HWNDDEAD" "hwnd $Hwnd has no UIA element (cross-IL or dead)" 4 }
# X1 (WP3 adversary): window rect for the witness bbox size caps — a forged
# node can inflate its BoundingRectangle so the REAL anchor text falls inside
# it while the center (the injection point) sits on an attacker's button.
$winRect = $null
try { $winRect = $rootEl.Current.BoundingRectangle } catch { $winRect = $null }

$sw = [Diagnostics.Stopwatch]::StartNew()
$wv = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$stack = New-Object System.Collections.Stack
$stack.Push(@{ el = $rootEl; depth = 0 })
$nodes = 0
$oversized = 0
$exactHits = New-Object System.Collections.ArrayList
$subHit = $null
while ($stack.Count -gt 0 -and $nodes -lt $MaxNodes) {
  $node = $stack.Pop(); $cur = $node.el
  if ($node.depth -ge 1) {
    $nodes++
    $nm = ''
    try { $nm = $cur.Current.Name } catch { $nm = '' }
    if ($nm -ne '') {
      $norm = (Normalize-Anchor $nm)
      $isExact = ($norm -eq $anchor)
      $isSub = (-not $isExact) -and ($norm.ToLowerInvariant().Contains($anchorLower))
      if ($isExact -or $isSub) {
        $off = $true; $rr = $null
        try { $off = [bool]$cur.Current.IsOffscreen } catch { $off = $true }
        if (-not $off) { try { $rr = $cur.Current.BoundingRectangle } catch { $rr = $null } }
        if ($null -ne $rr -and $rr.Width -gt 0 -and $rr.Height -gt 0) {
          # X1 (WP3 adversary): dual bbox size cap — absolute area AND window-
          # area ratio (locate-chain.ts re-checks the same caps witness-side:
          # WITNESS_BBOX_MAX_AREA_PX2 / WITNESS_BBOX_MAX_WINDOW_RATIO). An
          # oversized element is never a legitimate interactive target — a
          # forged node inflates its bbox exactly this way to swallow the real
          # anchor text. Dropped at the source (fail-closed), counted.
          $bboxArea = [double]$rr.Width * [double]$rr.Height
          $winArea = 0.0
          if ($null -ne $winRect) { $winArea = [double]$winRect.Width * [double]$winRect.Height }
          if ($bboxArea -gt 150000 -or ($winArea -gt 0 -and ($bboxArea / $winArea) -gt 0.3)) {
            $oversized++
          } else {
            $info = @{
              name = $nm
              controlType = ''; automationId = ''
              x = [int]($rr.X + $rr.Width / 2); y = [int]($rr.Y + $rr.Height / 2)
              bbox = @{ x = [int]$rr.X; y = [int]$rr.Y; width = [int]$rr.Width; height = [int]$rr.Height }
            }
            try { $info.controlType = $cur.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '' } catch {}
            try { $info.automationId = $cur.Current.AutomationId } catch {}
            if ($isExact) { [void]$exactHits.Add($info) } elseif ($null -eq $subHit) { $subHit = $info }
          }
        }
      }
    }
  }
  if ($node.depth -lt $MaxDepth) {
    try {
      $c = $wv.GetFirstChild($cur)
      while ($c) {
        $stack.Push(@{ el = $c; depth = $node.depth + 1 })
        $c = $wv.GetNextSibling($c)
      }
    } catch { /* branch vanished mid-walk — continue */ }
  }
}
$sw.Stop()

if ($exactHits.Count -gt 0) {
  $hit = $exactHits[0]
  $conf = if ($exactHits.Count -eq 1) { 1.0 } else { 0.9 }
  Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
    ok = $true; found = $true; exact = $true; candidates = $exactHits.Count
    x = $hit.x; y = $hit.y; bbox = $hit.bbox
    name = $hit.name; controlType = $hit.controlType; automationId = $hit.automationId
    confidence = $conf; nodes = $nodes; oversized = $oversized; ms = [int]$sw.ElapsedMilliseconds
  }))
  exit 0
}
if ($null -ne $subHit) {
  Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
    ok = $true; found = $true; exact = $false; candidates = 1
    x = $subHit.x; y = $subHit.y; bbox = $subHit.bbox
    name = $subHit.name; controlType = $subHit.controlType; automationId = $subHit.automationId
    confidence = 0.8; nodes = $nodes; oversized = $oversized; ms = [int]$sw.ElapsedMilliseconds
  }))
  exit 0
}
Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
  ok = $true; found = $false; candidates = 0; nodes = $nodes; oversized = $oversized; ms = [int]$sw.ElapsedMilliseconds
}))
exit 0
