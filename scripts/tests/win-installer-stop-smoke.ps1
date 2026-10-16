# Compile and execute the complete production NSIS stop macro against fixtures.
# Does not install/uninstall or change the user's registry/installed application.
#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$root = Join-Path ([IO.Path]::GetTempPath()) ('cmspark-stop-' + [guid]::NewGuid().ToString('N'))
$inside = Join-Path $root "space 中文 & O'Brien ! (test)"
$sibling = $inside + '-other'
$processes = @()
$saved = $env:CMSPARK_SMOKE_INSTALL_ROOT
$observationDescriptor = $null
$observationCollected = $false
$observationModule = Join-Path $PSScriptRoot 'nsis-stop-observation.mjs'
$observationTests = Join-Path $PSScriptRoot 'nsis-stop-observation.test.mjs'
. (Join-Path $PSScriptRoot 'win-system-node-fixtures.ps1')
try {
    $node = (Get-Command node).Source
    # CPU-only controls run in the same CI step before any native smoke.
    & $node --test $observationTests
    if ($LASTEXITCODE -ne 0) { throw 'NSIS stop observation controls failed' }
    foreach ($directory in @($inside, $sibling)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        Copy-Item -LiteralPath $node -Destination (Join-Path $directory 'node.exe')
        Set-Content -LiteralPath (Join-Path $directory 'idle.js') -Encoding ascii -Value 'setInterval(()=>{},1000)'
        $processes += Start-Process -FilePath (Join-Path $directory 'node.exe') -ArgumentList ('"{0}"' -f (Join-Path $directory 'idle.js')) -PassThru -WindowStyle Hidden
    }
    $system = New-OwnedSystemNodeFixtures $root $inside $sibling
    $processes += @($system.Stop) + @($system.Survive)
    # Prepare only an owned helper copy. Its strict inverse must retain every
    # original production byte; neither the shipped helper nor macro is edited.
    $prepareOutput = & $node $observationModule prepare $root
    if ($LASTEXITCODE -ne 0) { throw 'NSIS stop observation preparation failed' }
    $observationJson = $prepareOutput -join [Environment]::NewLine
    $observation = $observationJson | ConvertFrom-Json
    $observationDescriptor = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($observationJson))
    # Include the whole production macro, so a prepended daemon stop or global
    # taskkill cannot hide outside the tested PowerShell expression.
    $source = Get-Content -LiteralPath (Join-Path $repo 'scripts\installer.nsi') -Raw
    $match = [regex]::Match($source, '(?ms)^!macro StopInstalledAgentUnshared\r?\n.*?^!macroend')
    if (-not $match.Success) { throw 'NSIS stop macro not found' }
    $macro = $match.Value
    if ($macro -match 'daemon\s+stop|/IM\s+cmspark-agent') { throw 'stop macro must not use global PID/image termination' }
    $makensis = @(
        (Join-Path ${env:ProgramFiles(x86)} 'NSIS\makensis.exe'),
        (Join-Path $env:ProgramFiles 'NSIS\makensis.exe')
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $makensis) { $makensis = (Get-Command makensis -ErrorAction Stop).Source }
    $harness = @'
Unicode true
Name "CMspark scoped stop smoke"
OutFile "stop-smoke.exe"
RequestExecutionLevel user
SilentInstall silent
!include "LogicLib.nsh"
__OBSERVATION_PREAMBLE__
__MACRO__
Section
  ReadEnvStr $INSTDIR "CMSPARK_SMOKE_INSTALL_ROOT"
__OBSERVATION_ENTER__
  !insertmacro StopInstalledAgentUnshared
__OBSERVATION_AFTER__
SectionEnd
'@
    Set-Content -LiteralPath (Join-Path $root 'stop-smoke.nsi') -Value $harness.Replace('__MACRO__', $macro).Replace('__OBSERVATION_PREAMBLE__', $observation.nsisPreamble).Replace('__OBSERVATION_ENTER__', $observation.nsisEnter).Replace('__OBSERVATION_AFTER__', $observation.nsisAfterMacro) -Encoding utf8BOM
    & $makensis /V2 ('/DCMSPARK_STOP_SCRIPT=' + $observation.helperPath) (Join-Path $root 'stop-smoke.nsi')
    if ($LASTEXITCODE -ne 0) { throw "NSIS smoke compilation failed: $LASTEXITCODE" }
    $env:CMSPARK_SMOKE_INSTALL_ROOT = $inside
    $stop = Start-Process -FilePath (Join-Path $root 'stop-smoke.exe') -PassThru
    if (-not $stop.WaitForExit(30000)) {
        Stop-Process -Id $stop.Id -Force -ErrorAction SilentlyContinue
        throw 'NSIS stop macro timed out'
    }
    if ($stop.ExitCode -ne 0) { throw "NSIS stop macro failed: $($stop.ExitCode)" }
    $summaryOutput = & $node $observationModule collect $root $observationDescriptor
    $summaryExit = $LASTEXITCODE
    $summaryJson = $summaryOutput -join [Environment]::NewLine
    $summary = $summaryJson | ConvertFrom-Json
    $observationCollected = $true
    Write-Host ('NSIS_STOP_OBSERVATION ' + $summaryJson)
    if ($summaryExit -ne 0 -or $summary.complete -ne $true -or $summary.capture -ne 'complete' -or $summary.gap -ne $false) { throw 'NSIS stop observation incomplete' }
    if (-not $processes[0].WaitForExit(10000)) { throw 'installed fixture was not stopped' }
    $processes[1].Refresh()
    if ($processes[1].HasExited) { throw 'sibling installation was incorrectly stopped' }
    foreach ($p in $system.Stop) { if (-not $p.WaitForExit(10000)) { throw 'system Node agent was not stopped' } }
    foreach ($p in $system.Survive) { $p.Refresh(); if ($p.HasExited) { throw 'unrelated system Node process was stopped' } }
    Write-Host 'PASS: NATIVE_TEST_PASSIVE_INSTRUMENTED_EXACT_ORIGINAL_BODY; bundled and system Node agents stopped; sibling/unrelated Node survived'
} finally {
    # A timeout/compile/stop assertion remains the primary exception. A final
    # finite diagnostic must never mask it or reinterpret a missing phase as PASS.
    if (-not $observationCollected -and $null -ne $observationDescriptor) {
        try {
            $failureSummary = & $node $observationModule collect $root $observationDescriptor
            Write-Host ('NSIS_STOP_OBSERVATION ' + ($failureSummary -join [Environment]::NewLine))
        } catch { Write-Host 'NSIS_STOP_OBSERVATION {"complete":false,"gap":true}' }
    }
    $env:CMSPARK_SMOKE_INSTALL_ROOT = $saved
    foreach ($p in $processes) { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
