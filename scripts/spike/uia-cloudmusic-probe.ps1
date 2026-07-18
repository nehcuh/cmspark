# UIA + SMTC read-only spike against NetEase CloudMusic.
# READ-ONLY CONTRACT: no Invoke, no SetValue, no SetFocus, no SendInput.
# Only enumerates AutomationElement properties and SMTC session metadata.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$result = [ordered]@{
  timestamp        = (Get-Date).ToString('o')
  processFound     = $false
  launchedBySpike  = $false
  windowFound      = $false
  uia              = [ordered]@{}
  smtc             = [ordered]@{}
  errors           = @()
}

# ---------- 1. Ensure CloudMusic is running ----------
$exe = 'C:\Program Files\Netease\CloudMusic\cloudmusic.exe'
$proc = Get-Process -Name 'cloudmusic' -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) {
  $any = Get-Process -Name 'cloudmusic' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $any) {
    if (Test-Path $exe) {
      Start-Process $exe
      $result.launchedBySpike = $true
    } else {
      $result.errors += "cloudmusic.exe not found at $exe"
      $result | ConvertTo-Json -Depth 6
      exit 1
    }
  }
  # wait up to 25s for a main window
  $deadline = (Get-Date).AddSeconds(25)
  do {
    Start-Sleep -Milliseconds 800
    $proc = Get-Process -Name 'cloudmusic' -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  } while (-not $proc -and (Get-Date) -lt $deadline)
}
if (-not $proc) {
  $result.errors += 'no cloudmusic main window after 25s wait'
  $result | ConvertTo-Json -Depth 6
  exit 1
}
$result.processFound = $true
$pid_ = $proc.Id
$result.processId = $pid_
$result.mainWindowTitle = $proc.MainWindowTitle

# ---------- 2. UIA probe ----------
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$ae  = [System.Windows.Automation.AutomationElement]
$ct  = [System.Windows.Automation.ControlType]
$root = $ae::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition($ae::ProcessIdProperty, $pid_)
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if (-not $win) {
  $result.errors += 'UIA: window element not found for pid'
  $result | ConvertTo-Json -Depth 6
  exit 1
}
$result.windowFound = $true

function Get-TreeStats {
  param($rootEl, [int]$maxDepth = 14, [int]$maxNodes = 4000)
  $stats = @{
    totalNodes   = 0
    hitNodeCap   = $false
    byControlType = @{}
    editControls  = @()
    namedButtons  = @()
    documents     = 0
  }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $stack = New-Object System.Collections.Stack
  $stack.Push(@{ el = $rootEl; depth = 0 })
  while ($stack.Count -gt 0) {
    if ($stats.totalNodes -ge $maxNodes) { $stats.hitNodeCap = $true; break }
    $node = $stack.Pop()
    $el = $node.el
    $stats.totalNodes++
    $ctName = $el.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
    if ($stats.byControlType.ContainsKey($ctName)) { $stats.byControlType[$ctName]++ } else { $stats.byControlType[$ctName] = 1 }
    if ($ctName -eq 'Document') { $stats.documents++ }
    if ($ctName -eq 'Edit' -and $stats.editControls.Count -lt 10) {
      $r = $el.Current.BoundingRectangle
      $stats.editControls += [ordered]@{
        name = $el.Current.Name; autoId = $el.Current.AutomationId
        x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height
        isEnabled = $el.Current.IsEnabled
      }
    }
    if ($ctName -eq 'Button' -and $el.Current.Name -and $stats.namedButtons.Count -lt 40) {
      $stats.namedButtons += $el.Current.Name
    }
    if ($node.depth -lt $maxDepth) {
      $child = $walker.GetFirstChild($el)
      while ($child) {
        $stack.Push(@{ el = $child; depth = $node.depth + 1 })
        $child = $walker.GetNextSibling($child)
      }
    }
  }
  return $stats
}

# Pass A: immediately (CEF accessibility likely OFF)
$passA = Get-TreeStats -rootEl $win
$result.uia.passA_nodes = $passA.totalNodes

# Give CEF time to notice the UIA client and hydrate its tree
Start-Sleep -Seconds 4

# Pass B: after accessibility on-demand enable
$passB = Get-TreeStats -rootEl $win
$result.uia.passB_nodes          = $passB.totalNodes
$result.uia.hitNodeCap           = $passB.hitNodeCap
$result.uia.byControlType        = $passB.byControlType
$result.uia.documentCount        = $passB.documents
$result.uia.editControls         = $passB.editControls
$result.uia.sampleButtonNames    = $passB.namedButtons
$result.uia.accessibilityHydrated = ($passB.totalNodes -gt ($passA.totalNodes + 50))

# Targeted: search-box heuristics — Edit controls OR elements named *search*/搜索
$editCond = New-Object System.Windows.Automation.PropertyCondition($ae::ControlTypeProperty, $ct::Edit)
$edits = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCond)
$result.uia.editControlCount = $edits.Count

# ---------- 3. SMTC probe (read-only) ----------
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
                   $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  function Await-WinRt($op, $resultType) {
    $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
  }
  $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $mgr = Await-WinRt ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) $mgrType
  $sessions = $mgr.GetSessions()
  $list = @()
  foreach ($s in $sessions) {
    $entry = [ordered]@{ appId = $s.SourceAppUserModelId }
    try {
      $props = (Await-WinRt ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]))
      $entry.title  = $props.Title
      $entry.artist = $props.Artist
    } catch { $entry.title = '(no media props)' }
    try { $entry.playbackStatus = $s.GetPlaybackInfo().PlaybackStatus.ToString() } catch {}
    $list += $entry
  }
  $result.smtc.sessionCount = $list.Count
  $result.smtc.sessions = $list
} catch {
  $result.smtc.error = $_.Exception.Message
}

# ---------- 4. Verdict ----------
$hasEdit = ($result.uia.editControlCount -gt 0)
$hasDoc  = ($passB.documents -gt 0)
$result.verdict = [ordered]@{
  uiaTreeAccessible   = $result.windowFound -and $passB.totalNodes -gt 0
  contentExposed      = $hasDoc -or $hasEdit
  searchBoxCandidate  = $hasEdit
  uiaViable           = ($hasEdit -or $hasDoc)
  smtcViable          = ($result.smtc.sessionCount -gt 0)
}

$out = Join-Path $PSScriptRoot 'uia-cloudmusic-probe.result.json'
$result | ConvertTo-Json -Depth 6 | Set-Content -Path $out -Encoding UTF8
$result | ConvertTo-Json -Depth 6
