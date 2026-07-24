# UIA probe v2 — all cloudmusic processes, all top-level windows, class names,
# FromPoint fallback, hydration detection. READ-ONLY: no Invoke/SetValue/SetFocus/SendInput.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$ae   = [System.Windows.Automation.AutomationElement]
$root = $ae::RootElement

$result = [ordered]@{ timestamp = (Get-Date).ToString('o'); windows = @(); verdict = @{} }

# --- all cloudmusic processes (CEF apps have several) ---
$procs = Get-Process | Where-Object { $_.ProcessName -like '*cloudmusic*' }
$result.processes = @($procs | ForEach-Object { "$($_.ProcessName)#$($_.Id) hwnd=$($_.MainWindowHandle)" })
$pids = @($procs | ForEach-Object { $_.Id })

# --- all top-level windows owned by any of those pids ---
$conds = $pids | ForEach-Object { New-Object System.Windows.Automation.PropertyCondition($ae::ProcessIdProperty, $_) }
$winCond = if ($conds.Count -gt 1) { New-Object System.Windows.Automation.OrCondition(,[System.Windows.Automation.Condition[]]$conds) } else { $conds[0] }
$tops = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $winCond)

function Get-TreeStats($rootEl, [int]$maxDepth = 16, [int]$maxNodes = 2500) {
  $stats = @{ total = 0; byType = @{}; edits = @(); interesting = @() }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $stack = New-Object System.Collections.Stack
  $stack.Push(@{ el = $rootEl; depth = 0 })
  while ($stack.Count -gt 0 -and $stats.total -lt $maxNodes) {
    $node = $stack.Pop(); $el = $node.el
    $stats.total++
    $t = $el.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
    $stats.byType[$t] = 1 + [int]$stats.byType[$t]
    $nm = $el.Current.Name
    if ($t -eq 'Edit' -and $stats.edits.Count -lt 8) {
      $r = $el.Current.BoundingRectangle
      $stats.edits += (@{ name = $nm; autoId = $el.Current.AutomationId; rect = "$([int]$r.X),$([int]$r.Y) $([int]$r.Width)x$([int]$r.Height)" } | ConvertTo-Json -Compress)
    }
    # interesting: named interactive/content elements, sample up to 25
    if ($nm -and ($t -in @('Button','Edit','Document','Hyperlink','TabItem','ListItem','MenuItem','Text')) -and $stats.interesting.Count -lt 25) {
      $stats.interesting += "$t`: $nm"
    }
    if ($node.depth -lt $maxDepth) {
      $child = $walker.GetFirstChild($el)
      while ($child) { $stack.Push(@{ el = $child; depth = $node.depth + 1 }); $child = $walker.GetNextSibling($child) }
    }
  }
  return $stats
}

$i = 0
foreach ($w in $tops) {
  $i++
  $entry = [ordered]@{
    idx       = $i
    name      = $w.Current.Name
    className = $w.Current.ClassName
    pid       = $w.Current.ProcessId
    passA     = $null; passB = $null; edits = @(); interesting = @(); byType = @{}
  }
  $a = Get-TreeStats $w
  $entry.passA = $a.total
  Start-Sleep -Seconds 5   # allow on-demand accessibility hydration
  $b = Get-TreeStats $w
  $entry.passB = $b.total
  $entry.byType = $b.byType
  $entry.edits = $b.edits
  $entry.interesting = $b.interesting
  $entry.hydrated = ($b.total -gt ($a.total + 50))
  $result.windows += $entry
}

# --- FromPoint fallback: what element sits at the main window's center? ---
$main = $procs | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($main) {
  $el = $ae::FromHandle($main.MainWindowHandle)
  if ($el) {
    $r = $el.Current.BoundingRectangle
    $pt = New-Object System.Windows.Point(($r.X + $r.Width / 2), ($r.Y + $r.Height / 2))
    $hit = $ae::FromPoint($pt)
    if ($hit) {
      $result.fromPoint = [ordered]@{
        atCenter  = "$($hit.Current.ControlType.ProgrammaticName) name='$($hit.Current.Name)' class='$($hit.Current.ClassName)' pid=$($hit.Current.ProcessId)"
      }
    }
  }
}

# --- verdict ---
$totalEdits = @($result.windows | ForEach-Object { $_.edits }).Count
$anyHydration = @($result.windows | Where-Object { $_.hydrated }).Count -gt 0
$maxNodes = ($result.windows | ForEach-Object { $_.passB } | Measure-Object -Maximum).Maximum
$classes = @($result.windows | ForEach-Object { $_.className })
$result.verdict = [ordered]@{
  topLevelWindows = $tops.Count
  maxTreeNodes    = $maxNodes
  totalEditFound  = $totalEdits
  anyHydration    = $anyHydration
  windowClasses   = $classes
  uiaViable       = ($totalEdits -gt 0 -or $maxNodes -gt 200)
}

$out = Join-Path $PSScriptRoot 'uia-cloudmusic-probe-v2.result.json'
$result | ConvertTo-Json -Depth 6 | Set-Content -Path $out -Encoding UTF8
$result | ConvertTo-Json -Depth 6
