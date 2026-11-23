#requires -Version 7.2
# Builds the optional Windows x64 Vulkan resource from unmodified pinned upstream source.
# Requires MSVC 2022 x64, CMake, and an unpacked Vulkan SDK (not installed globally).
param(
    [Parameter(Mandatory=$true)][string]$VulkanSdk,
    [string]$CmakeExe = "cmake",
    [string]$BuildDir = "$env:SystemDrive\cmspark-vulkan-build",
    [string]$SourceArchive,
    [string]$SourceDir
)
$ErrorActionPreference = "Stop"
$CompanionRoot = Split-Path -Parent $PSScriptRoot
$BuildDir = [IO.Path]::GetFullPath($BuildDir)
$VulkanSdk = [IO.Path]::GetFullPath($VulkanSdk)
if ($BuildDir.Length -gt 45) { throw "Use a short BuildDir (at most 45 characters); MSBuild nested shader builds exceed MAX_PATH." }
foreach ($required in @("Include\vulkan\vulkan.h", "Lib\vulkan-1.lib", "Bin\glslc.exe")) {
    if (-not (Test-Path -LiteralPath (Join-Path $VulkanSdk $required))) { throw "Missing Vulkan SDK resource: $required" }
}
if (-not $SourceArchive) { $SourceArchive = Join-Path $BuildDir "source-v1.7.6.zip" }
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
if (-not (Test-Path -LiteralPath $SourceArchive)) {
    Invoke-WebRequest -Uri "https://codeload.github.com/ggml-org/whisper.cpp/zip/refs/tags/v1.7.6" -OutFile $SourceArchive
}
$sourceHash = (Get-FileHash -LiteralPath $SourceArchive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($sourceHash -ne "8c579f4468fc23ddd64092ca9d8f3933d831a358ae9b7fcc09b43d9496a020c5") { throw "Upstream source archive hash mismatch" }
if (-not $SourceDir) {
    $SourceDir = Join-Path $BuildDir "source\whisper.cpp-1.7.6"
    if (-not (Test-Path -LiteralPath $SourceDir)) { Expand-Archive -LiteralPath $SourceArchive -DestinationPath (Join-Path $BuildDir "source") }
}
# SourceDir supports a previously extracted archive, but never accepts modified source.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourceZip = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($SourceArchive))
try {
    foreach ($entry in $sourceZip.Entries) {
        $relative = $entry.FullName -replace '^whisper.cpp-1.7.6/', ''
        if (-not $relative -or $entry.FullName.EndsWith('/')) { continue }
        # Upstream CMake itself regenerates this non-native npm metadata file.
        if ($relative -eq 'bindings/javascript/package.json') { continue }
        $actual = Join-Path $SourceDir $relative
        if (-not (Test-Path -LiteralPath $actual -PathType Leaf)) { throw "Source file missing: $relative" }
        $stream = $entry.Open()
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $expected = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
        finally { $sha.Dispose(); $stream.Dispose() }
        if ((Get-FileHash -LiteralPath $actual -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw "Modified source: $relative" }
    }
} finally { $sourceZip.Dispose() }
& $CmakeExe -S $SourceDir -B $BuildDir -G "Visual Studio 17 2022" -A x64 -DGGML_VULKAN=ON -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DBUILD_SHARED_LIBS=ON -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON "-DVulkan_INCLUDE_DIR=$VulkanSdk/Include" "-DVulkan_LIBRARY=$VulkanSdk/Lib/vulkan-1.lib" "-DVulkan_GLSLC_EXECUTABLE=$VulkanSdk/Bin/glslc.exe"
if ($LASTEXITCODE -ne 0) { throw "Vulkan CMake configuration failed ($LASTEXITCODE)" }
& $CmakeExe --build $BuildDir --config Release --target whisper-cli --parallel 8
if ($LASTEXITCODE -ne 0) { throw "Vulkan compilation failed ($LASTEXITCODE)" }
$resource = Join-Path $BuildDir ("resource-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $resource | Out-Null
$names = @("whisper.dll", "ggml.dll", "ggml-base.dll", "ggml-cpu.dll", "ggml-vulkan.dll")
Copy-Item -LiteralPath (Join-Path $BuildDir "bin\Release\whisper-cli.exe") -Destination (Join-Path $resource "cmspark-whisper-win-x64.exe")
foreach ($name in $names) { Copy-Item -LiteralPath (Join-Path $BuildDir "bin\Release\$name") -Destination $resource }
Copy-Item -LiteralPath (Join-Path $SourceDir "LICENSE") -Destination (Join-Path $resource "LICENSE.whisper.txt")
Copy-Item -LiteralPath (Join-Path $CompanionRoot "assets\whisper-vulkan.NOTICE.txt") -Destination $resource
$archive = Join-Path $CompanionRoot "assets\whisper-vulkan-win-x64.zip"
Compress-Archive -LiteralPath @(Get-ChildItem -LiteralPath $resource -File | ForEach-Object { $_.FullName }) -DestinationPath $archive -Force
$manifestPath = Join-Path $CompanionRoot "assets\whisper-binary.manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -AsHashtable
$files = @(Get-ChildItem -LiteralPath $resource -File | Sort-Object Name | ForEach-Object {
    @{ src=$_.Name; dest=$_.Name; size=$_.Length; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
})
$manifest.binaries["win-x64-vulkan"] = @{
    kind="zip"; version="whisper.cpp-v1.7.6-vulkan"; size=(Get-Item -LiteralPath $archive).Length
    sha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    url="https://raw.githubusercontent.com/nehcuh/cmspark/main/companion/assets/whisper-vulkan-win-x64.zip"
    extract=@{ stripPrefix=""; files=$files }
}
$manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $manifestPath -Encoding utf8
Write-Output "Staged verified Vulkan resource: $archive"
