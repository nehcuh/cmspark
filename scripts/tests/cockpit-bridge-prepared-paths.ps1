# Fixed same-run build handover metadata only. No compile, registry or launch.
param([Parameter(Mandatory=$true)][ValidateSet('prepare', 'stage')][string]$Phase)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows' -or -not [Environment]::Is64BitOperatingSystem) { throw 'COCKPIT_BRIDGE_PREPARED_REMOTE_ONLY' }
$root = [IO.Path]::GetFullPath($env:CMSPARK_TEST_RUN_DIR)
if (-not [IO.Path]::IsPathRooted($root) -or [IO.Path]::GetFileName($root) -cnotmatch '^cmspark-test-run-[A-Za-z0-9-]+$') { throw 'COCKPIT_BRIDGE_PREPARED_ROOT' }
$repo = [IO.Directory]::GetParent([IO.Directory]::GetParent($PSScriptRoot).FullName).FullName
$prepared = [IO.Path]::Combine($root, 'prepared-build')
function Assert-Regular([string]$Path, [bool]$Directory) {
  $attributes = [IO.File]::GetAttributes($Path)
  if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
      (($attributes -band [IO.FileAttributes]::Directory) -ne 0) -ne $Directory) { throw 'COCKPIT_BRIDGE_PREPARED_ATTRIBUTES' }
}
foreach ($directory in @($root, $prepared, [IO.Path]::Combine($prepared, 'host'), [IO.Path]::Combine($prepared, 'job'))) { Assert-Regular $directory $true }
foreach ($relative in @(
  'companion\src\computer\native\cockpit-bridge-host.cs',
  'scripts\tests\cockpit-bridge-chrome-job.cs',
  'scripts\tests\cockpit-bridge-chrome-job-cpu.cs',
  'scripts\build-cockpit-native-bridge.ps1',
  'scripts\tests\build-cockpit-bridge-job.ps1'
)) { Assert-Regular ([IO.Path]::Combine($repo, $relative)) $false }
foreach ($relative in @('host\cmspark-cockpit-bridge.exe', 'host\cmspark-cockpit-bridge.sha256', 'job\cockpit-chrome-job.exe', 'job\cockpit-chrome-job-cpu.exe')) {
  Assert-Regular ([IO.Path]::Combine($prepared, $relative)) $false
}
if ($Phase -ceq 'stage') {
  Assert-Regular ([IO.Path]::Combine($prepared, 'manifest.json')) $false
  $installs = @([IO.Directory]::GetDirectories($root, 'bridge-install-*', [IO.SearchOption]::TopDirectoryOnly))
  if ($installs.Length -ne 1 -or [IO.Path]::GetFileName($installs[0]) -cnotmatch '^bridge-install-[0-9a-f]{16}$') { throw 'COCKPIT_BRIDGE_PREPARED_INSTALL' }
  Assert-Regular $installs[0] $true
  Assert-Regular ([IO.Path]::Combine($installs[0], 'bin')) $true
  Assert-Regular ([IO.Path]::Combine($root, 'job-build')) $true
}
[Console]::WriteLine('COCKPIT_BRIDGE_PREPARED_PATHS_OK')
