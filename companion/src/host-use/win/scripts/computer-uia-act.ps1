# Clean action endpoint. Never load managed UIAutomationClient/UIAutomationTypes.
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
  [string]$NoFocusLibrary = '',
  [Parameter(Mandatory=$true)][string]$SelectionJson
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

function Test-StopFlag {
  if ($StopFile -ne '' -and (Microsoft.PowerShell.Management\Test-Path -LiteralPath $StopFile)) {
    Fail "STOPPED" "emergency-stop flag present — delivery aborted" 11
  }
}


# Private host-produced tuple, not model authority. No managed UIA loads.
function Invalid-Selection { Fail 'UIA_TERMINAL' 'UIA_ELEMENT_MISMATCH' 5 }
function Is-Integer($v, [long]$lo, [long]$hi) {
  return (($v -is [int] -or $v -is [long]) -and $v -ge $lo -and $v -le $hi)
}
if ($SelectionJson.Length -gt 8192 -or [Text.Encoding]::UTF8.GetByteCount($SelectionJson) -gt 16384) { Invalid-Selection }
try { $selected = Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject $SelectionJson } catch { Invalid-Selection }
$keys = @('schema','hwnd','rootPid','selectedPid','runtime','controlTypeId','controlType','automationId','name','x','y','bbox','patterns')
if ($null -eq $selected -or @($selected.PSObject.Properties).Count -ne $keys.Count) { Invalid-Selection }
foreach ($key in $selected.PSObject.Properties.Name) { if ($keys -cnotcontains $key) { Invalid-Selection } }
if (-not (Is-Integer $selected.schema 1 1) -or -not (Is-Integer $selected.hwnd 1 9007199254740991) -or $selected.hwnd -ne $Hwnd) { Invalid-Selection }
foreach ($pidValue in @($selected.rootPid,$selected.selectedPid)) { if (-not (Is-Integer $pidValue 1 4294967295)) { Invalid-Selection } }
if ($selected.runtime -isnot [array] -or $selected.runtime.Count -lt 1 -or $selected.runtime.Count -gt 64) { Invalid-Selection }
foreach ($id in $selected.runtime) { if (-not (Is-Integer $id -2147483648 2147483647)) { Invalid-Selection } }
if (-not (Is-Integer $selected.controlTypeId 1 2147483647)) { Invalid-Selection }
foreach ($key in @('name','automationId','controlType')) {
  $valueString = $selected.$key
  if ($valueString -isnot [string] -or $valueString.Length -gt 4096 -or $valueString.IndexOf([char]0) -ge 0) { Invalid-Selection }
}
if ($selected.name.Length -eq 0 -or $selected.controlType.Length -eq 0) { Invalid-Selection }
if (($ExpectControlType -ne '' -and -not [string]::Equals($selected.controlType,$ExpectControlType,[StringComparison]::Ordinal)) -or
    ($ExpectAutomationId -ne '' -and -not [string]::Equals($selected.automationId,$ExpectAutomationId,[StringComparison]::Ordinal))) { Invalid-Selection }
foreach ($key in @('x','y')) { if (-not (Is-Integer $selected.$key -2147483648 2147483647)) { Invalid-Selection } }
if ($null -eq $selected.bbox -or @($selected.bbox.PSObject.Properties).Count -ne 4) { Invalid-Selection }
foreach ($key in $selected.bbox.PSObject.Properties.Name) { if (@('x','y','w','h') -cnotcontains $key) { Invalid-Selection } }
foreach ($key in @('x','y','w','h')) { if (-not (Is-Integer $selected.bbox.$key -2147483648 2147483647)) { Invalid-Selection } }
if ($selected.bbox.w -le 0 -or $selected.bbox.h -le 0 -or [double]$selected.bbox.w * $selected.bbox.h -gt 150000) { Invalid-Selection }
$expected = @($Mode)
if ($Mode -eq 'auto') { $expected = @('invoke'); if ($Value -ne '') { $expected += 'setvalue' }; $expected += @('select','toggle') }
if ($selected.patterns -isnot [array] -or $selected.patterns.Count -ne $expected.Count) { Invalid-Selection }
for ($i = 0; $i -lt $expected.Count; $i++) {
  $pattern = $selected.patterns[$i]
  if ($null -eq $pattern -or @($pattern.PSObject.Properties).Count -ne 2 -or
      @($pattern.PSObject.Properties.Name) -cnotcontains 'mode' -or @($pattern.PSObject.Properties.Name) -cnotcontains 'state' -or
      $pattern.mode -isnot [string] -or $pattern.mode -cne $expected[$i] -or $pattern.state -isnot [string] -or
      @('ready','unsupported','null','threw') -cnotcontains $pattern.state) { Invalid-Selection }
}
[uint32]$rootOwnerPid = $selected.rootPid; [uint32]$selectedPid = $selected.selectedPid
[int[]]$selectedRuntime = @($selected.runtime); [int]$selectedType = $selected.controlTypeId
[string]$selectedAutomationId = $selected.automationId
$hit = $selected
$sw = [Diagnostics.Stopwatch]::StartNew()
Test-StopFlag
$script:noFocusReady = $false
function Invoke-NoFocusAction([string]$action) {
  Test-StopFlag
  if (-not $script:noFocusReady) {
    try {
      if (-not [IO.Path]::IsPathRooted($NoFocusLibrary) -or [IO.Path]::GetExtension($NoFocusLibrary) -ne '.dll') { throw 'invalid' }
      $libraryInfo = [IO.FileInfo]::new($NoFocusLibrary)
      if (-not $libraryInfo.Exists -or ($libraryInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'invalid' }
      $literal = $libraryInfo.FullName.Replace('"','""')
      $definition = @"
using System;
using System.Runtime.InteropServices;
namespace CU {
  public static class NoFocus {
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport(@"$literal", EntryPoint="CUiAction", ExactSpelling=true, CallingConvention=CallingConvention.Winapi, CharSet=CharSet.Unicode)]
    public static extern int Act(IntPtr root, uint rootPid, uint selectedPid, int mode,
      [In, MarshalAs(UnmanagedType.LPArray, SizeParamIndex=5)] int[] runtime, int runtimeCount, int controlType,
      [MarshalAs(UnmanagedType.LPWStr)] string automationId, int automationLength,
      [MarshalAs(UnmanagedType.LPWStr)] string value, int valueLength, int direction, int count,
      int depth, int nodes, [MarshalAs(UnmanagedType.LPWStr)] string stop, int stopLength);
  }
}
"@
      Microsoft.PowerShell.Utility\Add-Type -TypeDefinition $definition
      $script:noFocusReady = $true
    } catch { Fail "UIA_TERMINAL" "UIA_PATTERN_UNAVAILABLE" 6 }
  }
  $actionCode = switch ($action) { 'invoke' {1} 'setvalue' {2} 'select' {3} 'toggle' {4} 'scroll' {5} default {0} }
  $directionCode = switch ($Direction) { 'up' {1} 'down' {2} 'left' {3} 'right' {4} }
  try {
    return [CU.NoFocus]::Act([IntPtr]$Hwnd, $rootOwnerPid, $selectedPid, $actionCode,
      $selectedRuntime, $selectedRuntime.Length, $selectedType,
      $selectedAutomationId, $selectedAutomationId.Length, $Value, $Value.Length,
      $directionCode, $ScrollAmount, $MaxDepth, $MaxNodes, $StopFile, $StopFile.Length)
  } catch { Fail "UIA_TERMINAL" "UIA_PATTERN_UNAVAILABLE" 6 }
}

# Terminal dispatch is outside the generic action catch. Only unsupported may
# advance auto. In particular, uncertain method failure cannot cause a second action.
function Complete-NoFocusAction([int]$status, [string]$pname) {
  switch ($status) {
    0 { [void]$tried.Add("${pname}:ok"); return $true }
    1 { [void]$tried.Add("${pname}:unsupported"); return $false }
    2 { Fail "UIA_TERMINAL" "STOPPED" 11 }
    3 { Fail "UIA_TERMINAL" "UIA_WINDOW_GONE" 3 }
    4 { Fail "UIA_TERMINAL" "UIA_ELEMENT_GONE" 4 }
    5 { Fail "UIA_TERMINAL" "UIA_ELEMENT_MISMATCH" 5 }
    6 { Fail "UIA_TERMINAL" "UIA_METHOD_FAILED" 7 }
    7 { Fail "UIA_TERMINAL" "UIA_PATTERN_UNAVAILABLE" 6 }
    default { Fail "UIA_TERMINAL" "UIA_METHOD_FAILED" 7 }
  }
}

# --- pattern delivery -------------------------------------------------------
# `auto` tries the least-destructive, most-specific semantic route first. We never
# synthesize input here — these are UIA action patterns, which is exactly why the
# foreground is not needed.
$tried = Microsoft.PowerShell.Utility\New-Object System.Collections.Generic.List[string]

function Try-Pattern([string]$pname, [object]$pattern, [scriptblock]$act) {
  $state = $null
  foreach ($entry in $selected.patterns) { if ($entry.mode -ceq $pname) { $state = $entry.state } }
  if ($state -cne 'ready') { [void]$tried.Add("$($pname):$state"); return $false }
  try { $status = & $act $null }
  catch { Fail "UIA_TERMINAL" "UIA_METHOD_FAILED" 7 }
  return Complete-NoFocusAction $status $pname
}

# Last check immediately before the ACT: a stop raised while we were re-verifying identity
# must still prevent the delivery.
Test-StopFlag

$used = $null

if ($Mode -eq 'invoke') {
  if (Try-Pattern 'invoke' $null { param($o) Invoke-NoFocusAction 'invoke' }) { $used = 'invoke' }
} elseif ($Mode -eq 'setvalue') {
  if (Try-Pattern 'setvalue' $null { param($o) Invoke-NoFocusAction 'setvalue' }) { $used = 'setvalue' }
} elseif ($Mode -eq 'select') {
  if (Try-Pattern 'select' $null { param($o) Invoke-NoFocusAction 'select' }) { $used = 'select' }
} elseif ($Mode -eq 'toggle') {
  if (Try-Pattern 'toggle' $null { param($o) Invoke-NoFocusAction 'toggle' }) { $used = 'toggle' }
} elseif ($Mode -eq 'scroll') {
  if (Try-Pattern 'scroll' $null { param($o) Invoke-NoFocusAction 'scroll' }) { $used = 'scroll' }
} else {
  # auto
  if (Try-Pattern 'invoke' $null { param($o) Invoke-NoFocusAction 'invoke' }) {
    $used = 'invoke'
  } elseif ($Value -ne '') {
    if (Try-Pattern 'setvalue' $null { param($o) Invoke-NoFocusAction 'setvalue' }) { $used = 'setvalue' }
  }
  if ($null -eq $used) {
    if (Try-Pattern 'select' $null { param($o) Invoke-NoFocusAction 'select' }) { $used = 'select' }
  }
  if ($null -eq $used) {
    if (Try-Pattern 'toggle' $null { param($o) Invoke-NoFocusAction 'toggle' }) { $used = 'toggle' }
  }
}

if ($null -eq $used) {
  Fail "UIA_PATTERN_UNAVAILABLE" "no usable UIA action pattern for '$($hit.name)' ($($hit.controlType)) tried=[$($tried -join ', ')]" 6
}

Microsoft.PowerShell.Utility\Write-Output (Microsoft.PowerShell.Utility\ConvertTo-Json -Compress -InputObject ([ordered]@{
  ok = $true; mode = $used; name = $hit.name; controlType = $hit.controlType
  automationId = $hit.automationId; x = $hit.x; y = $hit.y; bbox = $hit.bbox
  tried = @($tried); foreground = $false; ms = [int]$sw.ElapsedMilliseconds
}))
exit 0
