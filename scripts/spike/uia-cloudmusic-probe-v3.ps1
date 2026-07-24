# UIA probe v3 — follow the Chrome_WidgetWin_1 content window found by FromPoint.
# READ-ONLY: no Invoke/SetValue/SetFocus/SendInput.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$ae   = [System.Windows.Automation.AutomationElement]
$root = $ae::RootElement

$result = [ordered]@{ timestamp = (Get-Date).ToString('o') }

# identify the renderer process from v2 (pid 25108) and any new ones
$main = Get-Process -Name 'cloudmusic' -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $main) { '{"error":"no cloudmusic main window"}'; exit 1 }

$winEl = $ae::FromHandle($main.MainWindowHandle)
$r = $winEl.Current.BoundingRectangle
$pt = New-Object System.Windows.Point(($r.X + $r.Width/2), ($r.Y + $r.Height/2))
$hit = $ae::FromPoint($pt)
if (-not $hit) { '{"error":"FromPoint returned nothing"}'; exit 1 }

$hitPid = $hit.Current.ProcessId
$hitProc = Get-Process -Id $hitPid -ErrorAction SilentlyContinue
$result.contentElement = [ordered]@{
  controlType = $hit.Current.ControlType.ProgrammaticName
  className   = $hit.Current.ClassName
  pid         = $hitPid
  processName = if ($hitProc) { $hitProc.ProcessName } else { '(dead?)' }
}

# climb to the content window's top-level parent within that renderer process
$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
$cur = $hit; $top = $hit
while ($cur) {
  $p = $walker.GetParent($cur)
  if (-not $p -or $p -eq $root -or $p.Current.ProcessId -ne $hitPid) { break }
  $top = $p; $cur = $p
}
$result.contentRootClass = $top.Current.ClassName

function Get-TreeStats($rootEl, [int]$maxDepth = 20, [int]$maxNodes = 4000) {
  $stats = @{ total = 0; byType = @{}; edits = @(); interesting = @(); capped = $false }
  $wv = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $stack = New-Object System.Collections.Stack
  $stack.Push(@{ el = $rootEl; depth = 0 })
  while ($stack.Count -gt 0) {
    if ($stats.total -ge $maxNodes) { $stats.capped = $true; break }
    $node = $stack.Pop(); $el = $node.el
    $stats.total++
    $t = $el.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
    $stats.byType[$t] = 1 + [int]$stats.byType[$t]
    $nm = $el.Current.Name
    if ($t -eq 'Edit' -and $stats.edits.Count -lt 8) {
      $rr = $el.Current.BoundingRectangle
      $stats.edits += (@{ name = $nm; autoId = $el.Current.AutomationId; rect = "$([int]$rr.X),$([int]$rr.Y) $([int]$rr.Width)x$([int]$rr.Height)"; enabled = $el.Current.IsEnabled } | ConvertTo-Json -Compress)
    }
    if ($nm -and ($t -in @('Button','Edit','Document','Hyperlink','TabItem','ListItem','MenuItem','ComboBox','Text')) -and $stats.interesting.Count -lt 40) {
      $stats.interesting += "$t`: $nm"
    }
    if ($node.depth -lt $maxDepth) {
      $c = $wv.GetFirstChild($el)
      while ($c) { $stack.Push(@{ el = $c; depth = $node.depth + 1 }); $c = $wv.GetNextSibling($c) }
    }
  }
  return $stats
}

$a = Get-TreeStats $top
$result.passA = $a.total
Start-Sleep -Seconds 6
$b = Get-TreeStats $top
$result.passB = $b.total
$result.capped = $b.capped
$result.byType = $b.byType
$result.edits = $b.edits
$result.interesting = $b.interesting
$result.hydrated = ($b.total -gt ($a.total + 50))

$result.verdict = [ordered]@{
  uiaContentViable = ($b.edits.Count -gt 0 -or $b.total -gt 200)
  editCount        = $b.edits.Count
}
$out = Join-Path $PSScriptRoot 'uia-cloudmusic-probe-v3.result.json'
$result | ConvertTo-Json -Depth 6 | Set-Content -Path $out -Encoding UTF8
$result | ConvertTo-Json -Depth 6
