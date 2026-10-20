# Remote test executable only; compile does not launch Chrome or a native host.
param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows' -or -not [Environment]::Is64BitOperatingSystem) { throw 'COCKPIT_BRIDGE_JOB_BUILD_REMOTE_ONLY' }
if (-not $env:CMSPARK_TEST_RUN_DIR -or -not [IO.Path]::IsPathRooted($OutputDirectory)) { throw 'COCKPIT_BRIDGE_JOB_BUILD_ROOT' }
$root = (Get-Item -LiteralPath $env:CMSPARK_TEST_RUN_DIR).FullName.TrimEnd('\') + '\'
$output = (Get-Item -LiteralPath $OutputDirectory).FullName.TrimEnd('\')
if (-not ($output + '\').StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or ($output + '\') -ceq $root -or ((Get-Item -LiteralPath $output).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'COCKPIT_BRIDGE_JOB_BUILD_ROOT' }
$compiler = @('Framework64', 'Framework') | ForEach-Object { Join-Path $env:SystemRoot "Microsoft.NET\$_\v4.0.30319\csc.exe" } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $compiler) { throw 'COCKPIT_BRIDGE_JOB_BUILD_COMPILER' }
$source = Join-Path $PSScriptRoot 'cockpit-bridge-chrome-job.cs'
$fixture = Join-Path $PSScriptRoot 'cockpit-bridge-chrome-job-cpu.cs'
foreach ($file in @($source, $fixture)) { if ((Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'COCKPIT_BRIDGE_JOB_BUILD_SOURCE' } }
foreach ($item in @(@('cockpit-chrome-job.exe', 'CMspark.CockpitBridge.TestOnly.ChromeJob'), @('cockpit-chrome-job-cpu.exe', 'CMspark.CockpitBridge.TestOnly.ChromeJobCpu'))) {
  $target = Join-Path $output $item[0]
  if (Test-Path -LiteralPath $target) { throw 'COCKPIT_BRIDGE_JOB_BUILD_EXISTS' }
  & $compiler /nologo /target:exe /platform:x64 /optimize+ /warn:4 /warnaserror+ /codepage:65001 ('/main:' + $item[1]) ('/out:' + $target) $source $fixture
  if ($LASTEXITCODE -ne 0) { throw 'COCKPIT_BRIDGE_JOB_BUILD_FAILED' }
}
'COCKPIT_BRIDGE_JOB_BUILT'
