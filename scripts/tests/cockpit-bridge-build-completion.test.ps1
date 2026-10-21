# Actual GHA Windows PS5.1 compiler controls. Never execute the fixture EXEs.
param([Parameter(Mandatory=$true)][string]$TestRoot)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows' -or
    $PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or
    -not [Environment]::Is64BitOperatingSystem) { throw 'COCKPIT_BRIDGE_COMPILER_CONTROL_PLATFORM' }
$controlAdmission = (Get-Item -LiteralPath $env:CMSPARK_TEST_RUN_DIR).FullName.TrimEnd('\') + '\'
$controlDirectory = Get-Item -LiteralPath $TestRoot
$controlPath = $controlDirectory.FullName.TrimEnd('\') + '\'
if (-not $controlDirectory.PSIsContainer -or ($controlDirectory.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    -not $controlPath.StartsWith($controlAdmission, [StringComparison]::OrdinalIgnoreCase) -or $controlPath -ceq $controlAdmission -or
    @(Get-ChildItem -LiteralPath $controlDirectory.FullName -Force).Count -ne 0) { throw 'COCKPIT_BRIDGE_COMPILER_CONTROL_ROOT' }
$controlBuilderBytes = [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot '..\build-cockpit-native-bridge.ps1'))
$controlUtf8 = [Text.UTF8Encoding]::new($false, $true)
function Test-CompilerCompletion([string]$CaseRoot, [bool]$Invalid) {
  $controlScripts = Join-Path $CaseRoot 'scripts'
  $controlSources = Join-Path $CaseRoot 'companion\src\computer\native'
  $controlOutput = Join-Path $CaseRoot 'bin'
  New-Item -ItemType Directory -Path $controlScripts, $controlSources, $controlOutput -Force | Out-Null
  $controlBuilder = Join-Path $controlScripts 'build-cockpit-native-bridge.ps1'
  [IO.File]::WriteAllBytes($controlBuilder, $controlBuilderBytes)
  $controlSource = if ($Invalid) { 'class Program { static void Main( { }' } else { 'class Program { static void Main() {} }' }
  [IO.File]::WriteAllText((Join-Path $controlSources 'cockpit-bridge-host.cs'), $controlSource, $controlUtf8)
  $controlCaught = $null
  $controlReply = $null
  try {
    # Dot-source only the byte-identical owned builder so the positive can
    # inspect its actual Process.ExitCode in this fresh function scope.
    $controlReply = . $controlBuilder -OutputDirectory $controlOutput
  } catch { $controlCaught = $_ }
  $controlBinary = Join-Path $controlOutput 'cmspark-cockpit-bridge.exe'
  $controlDigest = Join-Path $controlOutput 'cmspark-cockpit-bridge.sha256'
  if ($Invalid) {
    if ($null -eq $controlCaught -or $controlCaught.Exception.Message -cne 'COCKPIT_BRIDGE_BUILD_FAILED' -or
        -not $controlCaught.Exception.Data.Contains('CompilerExitCode') -or
        $controlCaught.Exception.Data['CompilerExitCode'] -isnot [int] -or $controlCaught.Exception.Data['CompilerExitCode'] -eq 0 -or
        (Test-Path -LiteralPath $controlDigest) -or (Test-Path -LiteralPath $controlBinary)) { throw 'COCKPIT_BRIDGE_COMPILER_CONTROL_NEGATIVE' }
  } else {
    if ($null -ne $controlCaught) { throw $controlCaught }
    if ($compilerExitCode -isnot [int] -or $compilerExitCode -ne 0 -or $controlReply -cne 'COCKPIT_BRIDGE_BUILD_OK' -or
        -not (Test-Path -LiteralPath $controlBinary -PathType Leaf) -or -not (Test-Path -LiteralPath $controlDigest -PathType Leaf)) { throw 'COCKPIT_BRIDGE_COMPILER_CONTROL_POSITIVE' }
    $controlExpected = (Get-FileHash -LiteralPath $controlBinary -Algorithm SHA256).Hash.ToLowerInvariant() + "`n"
    if ([IO.File]::ReadAllText($controlDigest, $controlUtf8) -cne $controlExpected) { throw 'COCKPIT_BRIDGE_COMPILER_CONTROL_DIGEST' }
  }
}
# Both source and /out paths contain spaces, Unicode and a literal percent;
# UseShellExecute=false must preserve them as data rather than shell expansion.
Test-CompilerCompletion (Join-Path $controlDirectory.FullName ('good space ' + [char]0x4e2d + [char]0x6587 + ' % path')) $false
Test-CompilerCompletion (Join-Path $controlDirectory.FullName ('bad space ' + [char]0x4e2d + [char]0x6587 + ' % path')) $true
$jobControlBuilderBytes = [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'build-cockpit-bridge-job.ps1'))
$jobControlSourceBytes = [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'cockpit-bridge-chrome-job.cs'))
$jobControlCpuBytes = [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'cockpit-bridge-chrome-job-cpu.cs'))
function Test-JobCompilerCompletion([string]$CaseRoot, [ValidateSet('actual', 'missing-first', 'missing-second')][string]$Case) {
  $jobControlScripts = Join-Path $CaseRoot 'scripts'
  $jobControlOutput = Join-Path $CaseRoot 'bin'
  New-Item -ItemType Directory -Path $jobControlScripts, $jobControlOutput -Force | Out-Null
  $jobControlBuilder = Join-Path $jobControlScripts 'build-cockpit-bridge-job.ps1'
  [IO.File]::WriteAllBytes($jobControlBuilder, $jobControlBuilderBytes)
  $jobControlSource = Join-Path $jobControlScripts 'cockpit-bridge-chrome-job.cs'
  $jobControlCpu = Join-Path $jobControlScripts 'cockpit-bridge-chrome-job-cpu.cs'
  if ($Case -ceq 'actual') {
    # Positive compiles byte-identical actual Job sources, never runs either EXE.
    [IO.File]::WriteAllBytes($jobControlSource, $jobControlSourceBytes)
    [IO.File]::WriteAllBytes($jobControlCpu, $jobControlCpuBytes)
  } else {
    # Public inert negatives isolate the selected /main, not Job/native logic.
    $jobControlFirstMethod = if ($Case -ceq 'missing-first') { 'MissingMain' } else { 'Main' }
    $jobControlSecondMethod = if ($Case -ceq 'missing-second') { 'MissingMain' } else { 'Main' }
    [IO.File]::WriteAllText($jobControlSource, ('namespace CMspark.CockpitBridge.TestOnly { class ChromeJob { static void ' + $jobControlFirstMethod + '() {} } }'), $controlUtf8)
    [IO.File]::WriteAllText($jobControlCpu, ('namespace CMspark.CockpitBridge.TestOnly { class ChromeJobCpu { static void ' + $jobControlSecondMethod + '() {} } }'), $controlUtf8)
  }
  $jobControlCaught = $null
  $jobControlReply = $null
  try { $jobControlReply = . $jobControlBuilder -OutputDirectory $jobControlOutput } catch { $jobControlCaught = $_ }
  $jobControlTargets = @('cockpit-chrome-job.exe', 'cockpit-chrome-job-cpu.exe')
  $jobControlCount = if ($Case -ceq 'missing-first') { 1 } else { 2 }
  if (@($jobCompilerResults).Count -ne $jobControlCount) { throw 'COCKPIT_BRIDGE_JOB_COMPILER_CONTROL_RESULTS' }
  for ($jobControlIndex = 0; $jobControlIndex -lt $jobControlCount; $jobControlIndex++) {
    $jobControlResult = $jobCompilerResults[$jobControlIndex]
    if ($jobControlResult.Target -cne $jobControlTargets[$jobControlIndex] -or $jobControlResult.ExitCode -isnot [int]) { throw 'COCKPIT_BRIDGE_JOB_COMPILER_CONTROL_RESULTS' }
    if ($Case -ceq 'actual' -or $jobControlIndex -lt $jobControlCount - 1) {
      if ($jobControlResult.ExitCode -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $jobControlOutput $jobControlResult.Target) -PathType Leaf)) { throw 'COCKPIT_BRIDGE_JOB_COMPILER_CONTROL_POSITIVE' }
    }
  }
  if ($Case -ceq 'actual') {
    if ($null -ne $jobControlCaught) { throw $jobControlCaught }
    if ($jobControlReply -cne 'COCKPIT_BRIDGE_JOB_BUILT') { throw 'COCKPIT_BRIDGE_JOB_COMPILER_CONTROL_POSITIVE' }
  } else {
    $jobControlFailedTarget = $jobControlTargets[$jobControlCount - 1]
    if ($null -eq $jobControlCaught -or $null -ne $jobControlReply -or $jobControlCaught.Exception.Message -cne 'COCKPIT_BRIDGE_JOB_BUILD_FAILED' -or
        -not $jobControlCaught.Exception.Data.Contains('CompilerTarget') -or $jobControlCaught.Exception.Data['CompilerTarget'] -cne $jobControlFailedTarget -or
        -not $jobControlCaught.Exception.Data.Contains('CompilerExitCode') -or $jobControlCaught.Exception.Data['CompilerExitCode'] -isnot [int] -or
        $jobControlCaught.Exception.Data['CompilerExitCode'] -eq 0 -or $jobCompilerResults[$jobControlCount - 1].ExitCode -ne $jobControlCaught.Exception.Data['CompilerExitCode'] -or
        (Test-Path -LiteralPath (Join-Path $jobControlOutput $jobControlFailedTarget))) { throw 'COCKPIT_BRIDGE_JOB_COMPILER_CONTROL_NEGATIVE' }
    if ($Case -ceq 'missing-first' -and (Test-Path -LiteralPath (Join-Path $jobControlOutput $jobControlTargets[1]))) { throw 'COCKPIT_BRIDGE_JOB_COMPILER_CONTROL_NEGATIVE' }
  }
}
foreach ($jobControlCase in @('actual', 'missing-first', 'missing-second')) {
  Test-JobCompilerCompletion (Join-Path $controlDirectory.FullName ($jobControlCase + ' job space ' + [char]0x4e2d + [char]0x6587 + ' % path')) $jobControlCase
}
Write-Output 'COCKPIT_BRIDGE_JOB_COMPILER_CONTROLS_COMPLETE'
Write-Output 'COCKPIT_BRIDGE_COMPILER_CONTROLS_COMPLETE'
