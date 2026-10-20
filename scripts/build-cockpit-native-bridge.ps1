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
& $compiler /nologo /target:exe /platform:x64 /optimize+ /warn:4 /warnaserror+ /codepage:65001 ('/out:' + $binary) $source
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw 'COCKPIT_BRIDGE_BUILD_FAILED' }
$hash = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($digest, $hash + "`n", [Text.UTF8Encoding]::new($false))
Write-Output 'COCKPIT_BRIDGE_BUILD_OK'
