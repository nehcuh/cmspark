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
Write-Output 'COCKPIT_BRIDGE_COMPILER_CONTROLS_COMPLETE'
