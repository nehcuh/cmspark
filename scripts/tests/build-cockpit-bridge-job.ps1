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
$jobCompilerResults = @()
foreach ($item in @(@('cockpit-chrome-job.exe', 'CMspark.CockpitBridge.TestOnly.ChromeJob'), @('cockpit-chrome-job-cpu.exe', 'CMspark.CockpitBridge.TestOnly.ChromeJobCpu'))) {
  $target = Join-Path $output $item[0]
  if (Test-Path -LiteralPath $target) { throw 'COCKPIT_BRIDGE_JOB_BUILD_EXISTS' }
  # Fixed .cs/.exe arguments are quoted for Framework Arguments, with no shell.
  foreach ($argumentPath in @($source, $fixture, $target)) {
    if ($argumentPath.IndexOfAny([char[]]@([char]34, [char]0, [char]13, [char]10)) -ge 0) { throw 'COCKPIT_BRIDGE_JOB_BUILD_SOURCE' }
  }
  $jobCompileStart = [Diagnostics.ProcessStartInfo]::new()
  $jobCompileStart.FileName = $compiler
  $jobCompileStart.Arguments = '/nologo /target:exe /platform:x64 /optimize+ /warn:4 /warnaserror+ /codepage:65001 /main:' + $item[1] + ' /out:"' + $target + '" "' + $source + '" "' + $fixture + '"'
  $jobCompileStart.UseShellExecute = $false
  $jobCompileStart.WorkingDirectory = (Get-Location).ProviderPath
  $jobCompileChild = [Diagnostics.Process]::new()
  try {
    $jobCompileChild.StartInfo = $jobCompileStart
    if (-not $jobCompileChild.Start()) { throw 'COCKPIT_BRIDGE_JOB_BUILD_FAILED' }
    $jobCompileChild.WaitForExit()
    $jobCompilerExitCode = $jobCompileChild.ExitCode
  } finally { $jobCompileChild.Dispose() }
  # Same-runspace build-only controls inspect actual completions for both mains.
  $jobCompilerResults += [pscustomobject]@{ Target = $item[0]; ExitCode = $jobCompilerExitCode }
  if ($jobCompilerExitCode -ne 0) {
    $jobBuildFailure = [InvalidOperationException]::new('COCKPIT_BRIDGE_JOB_BUILD_FAILED')
    $jobBuildFailure.Data['CompilerTarget'] = $item[0]
    $jobBuildFailure.Data['CompilerExitCode'] = $jobCompilerExitCode
    throw $jobBuildFailure
  }
}
'COCKPIT_BRIDGE_JOB_BUILT'
