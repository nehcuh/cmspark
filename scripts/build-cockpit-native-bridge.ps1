# Build only. Never starts the native host or registers it with Chrome.
param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or -not [Environment]::Is64BitOperatingSystem) { throw 'COCKPIT_BRIDGE_BUILD_PLATFORM' }
if (-not [IO.Path]::IsPathRooted($OutputDirectory)) { throw 'COCKPIT_BRIDGE_BUILD_PATH' }
$source = Join-Path $PSScriptRoot '..\companion\src\computer\native\cockpit-bridge-host.cs'
$source = (Get-Item -LiteralPath $source).FullName
if ((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'COCKPIT_BRIDGE_BUILD_SOURCE' }
$compiler = @('Framework64', 'Framework') | ForEach-Object { Join-Path $env:SystemRoot "Microsoft.NET\$_\v4.0.30319\csc.exe" } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $compiler) { throw 'COCKPIT_BRIDGE_BUILD_COMPILER' }
if (-not (Test-Path -LiteralPath $OutputDirectory)) { New-Item -ItemType Directory -Path $OutputDirectory | Out-Null }
$directory = Get-Item -LiteralPath $OutputDirectory
if (-not $directory.PSIsContainer -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'COCKPIT_BRIDGE_BUILD_PATH' }
$binary = Join-Path $directory.FullName 'cmspark-cockpit-bridge.exe'
$digest = Join-Path $directory.FullName 'cmspark-cockpit-bridge.sha256'
if ((Test-Path -LiteralPath $binary) -or (Test-Path -LiteralPath $digest)) { throw 'COCKPIT_BRIDGE_BUILD_OUTPUT_EXISTS' }
# Fixed file arguments end in .cs/.exe; quote them for the Framework Arguments
# API, without a shell or expansion. Never accept a quote/control separator.
foreach ($argumentPath in @($source, $binary)) {
  if ($argumentPath.IndexOfAny([char[]]@([char]34, [char]0, [char]13, [char]10)) -ge 0) { throw 'COCKPIT_BRIDGE_BUILD_PATH' }
}
$compileStart = [Diagnostics.ProcessStartInfo]::new()
$compileStart.FileName = $compiler
$compileStart.Arguments = '/nologo /target:exe /platform:x64 /optimize+ /warn:4 /warnaserror+ /codepage:65001 /out:"' + $binary + '" "' + $source + '"'
$compileStart.UseShellExecute = $false
$compileStart.WorkingDirectory = (Get-Location).ProviderPath
$compileChild = [Diagnostics.Process]::new()
try {
  $compileChild.StartInfo = $compileStart
  if (-not $compileChild.Start()) { throw 'COCKPIT_BRIDGE_BUILD_FAILED' }
  $compileChild.WaitForExit()
  $compilerExitCode = $compileChild.ExitCode
} finally { $compileChild.Dispose() }
if ($compilerExitCode -ne 0 -or -not (Test-Path -LiteralPath $binary -PathType Leaf)) {
  $buildFailure = [InvalidOperationException]::new('COCKPIT_BRIDGE_BUILD_FAILED')
  # An owned same-runspace bad-source control requires the actual numeric exit,
  # never an unset variable, a generic exception or absence of an output file.
  $buildFailure.Data['CompilerExitCode'] = $compilerExitCode
  throw $buildFailure
}
$hash = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($digest, $hash + "`n", [Text.UTF8Encoding]::new($false))
Write-Output 'COCKPIT_BRIDGE_BUILD_OK'
