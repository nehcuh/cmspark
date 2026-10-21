# Remote-only first identity gate; all new children receive an explicit environment.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows' -or -not [Environment]::Is64BitOperatingSystem) { throw 'COCKPIT_BRIDGE_REMOTE_ONLY' }
$repo = (Get-Item -LiteralPath (Join-Path $PSScriptRoot '..\..')).FullName
$runnerTemp = Get-Item -LiteralPath $env:RUNNER_TEMP
if (($runnerTemp.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $runnerTemp.PSIsContainer) { throw 'COCKPIT_BRIDGE_RUNNER_TEMP' }
$root = Join-Path $runnerTemp.FullName ('cmspark-test-run-723-identity-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$data = Join-Path $root 'data'; $temp = Join-Path $root 'temp'
New-Item -ItemType Directory -Path $data, $temp | Out-Null
# Keep PATH precedence, but never apply scalar path/attribute operations to arrays.
$nodeCommands = @(Get-Command node.exe -CommandType Application -TotalCount 1 -ErrorAction Stop)
if ($nodeCommands.Count -ne 1 -or $nodeCommands[0] -isnot [System.Management.Automation.ApplicationInfo]) { throw 'COCKPIT_BRIDGE_NODE_PATH' }
$node = $nodeCommands[0].Source
if ($node -isnot [string] -or -not [IO.Path]::IsPathRooted($node) -or [IO.Path]::GetFullPath($node) -cne $node) { throw 'COCKPIT_BRIDGE_NODE_PATH' }
$nodeItems = @(Get-Item -LiteralPath $node -ErrorAction Stop)
if ($nodeItems.Count -ne 1 -or $nodeItems[0] -isnot [IO.FileInfo]) { throw 'COCKPIT_BRIDGE_NODE_PATH' }
$nodeItem = $nodeItems[0]
if (-not $nodeItem.Exists -or $nodeItem.PSIsContainer -or $nodeItem.Extension -ine '.exe' -or ($nodeItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'COCKPIT_BRIDGE_NODE_PATH' }
$node = $nodeItem.FullName
$entry = Join-Path $PSScriptRoot 'cockpit-bridge-first-gate.cjs'
# Node and entry are absolute filesystem paths, not shell text.
$start = New-Object Diagnostics.ProcessStartInfo
$start.FileName = $node
$start.Arguments = '"' + $entry + '"'
$start.UseShellExecute = $false
$start.WorkingDirectory = $repo
$start.EnvironmentVariables.Clear()
$start.EnvironmentVariables['SystemRoot'] = $env:SystemRoot
$start.EnvironmentVariables['WINDIR'] = $env:SystemRoot
$start.EnvironmentVariables['ComSpec'] = Join-Path $env:SystemRoot 'System32\cmd.exe'
$start.EnvironmentVariables['PATH'] = (Split-Path -Parent $node) + ';' + (Join-Path $env:SystemRoot 'System32')
$start.EnvironmentVariables['TEMP'] = $temp
$start.EnvironmentVariables['TMP'] = $temp
$start.EnvironmentVariables['GITHUB_ACTIONS'] = 'true'
$start.EnvironmentVariables['RUNNER_OS'] = 'Windows'
$start.EnvironmentVariables['CMSPARK_TEST_RUN_DIR'] = $root
$start.EnvironmentVariables['CMSPARK_DATA_DIR'] = $data
$start.EnvironmentVariables['CMSPARK_723_COMPILED_ROOT'] = Join-Path $repo 'companion\.test-dist\src'
if ($env:RUNNER_TRACKING_ID) { $start.EnvironmentVariables['RUNNER_TRACKING_ID'] = $env:RUNNER_TRACKING_ID }
$child = New-Object Diagnostics.Process
$child.StartInfo = $start
try {
  if (-not $child.Start()) { throw 'COCKPIT_BRIDGE_GATE_START' }
  $child.WaitForExit()
  $exitCode = $child.ExitCode
} finally {
  $child.Dispose()
  # Only the fixed owned finite summary is publishable; never raw/profile data.
  try {
    $summary = Join-Path $root 'gate-summary.json'
    if ($env:GITHUB_OUTPUT -and $summary.IndexOfAny([char[]]"`r`n") -lt 0 -and [IO.File]::Exists($summary)) {
      $summaryItem = Get-Item -LiteralPath $summary -ErrorAction Stop
      if ($summaryItem -is [IO.FileInfo] -and -not ($summaryItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -and $summaryItem.Length -le 16384) {
        [IO.File]::AppendAllText($env:GITHUB_OUTPUT, "finite_summary=$summary`n")
      }
    }
  } catch { }
}
exit $exitCode
