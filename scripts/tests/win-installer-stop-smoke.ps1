# Compile and execute the complete production NSIS stop macro against fixtures.
# Does not install/uninstall or change the user's registry/installed application.
#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# Read only this fixture's fixed marker; never print captured bytes/errors/paths.
function Get-OwnedStopReceiptState($Receipt) {
    try { $item = Get-Item -LiteralPath $Receipt -Force -ErrorAction Stop }
    catch [System.Management.Automation.ItemNotFoundException] { return 'absent' }
    catch { return 'unreadable' }
    if ($item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { return 'unreadable' }
    $stream = $null
    try {
        $stream = [IO.File]::Open($Receipt, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        $bytes = New-Object byte[] 17
        $count = 0
        while ($count -lt 17) {
            $read = $stream.Read($bytes, $count, 17 - $count)
            if ($read -eq 0) { break }
            $count += $read
        }
        if ($count -gt 16) { return 'invalid' }
        $state = [Text.Encoding]::ASCII.GetString($bytes, 0, $count)
        if ($state -ceq 'entered' -or $state -ceq 'returned') { return $state }
        return 'invalid'
    } catch { return 'unreadable' }
    finally { if ($null -ne $stream) { $stream.Dispose() } }
}
# These real reader controls run on Windows in this existing owned smoke, not a
# second PowerShell process or a parser mirror in the cross-platform Node suite.
function Test-OwnedStopReceiptParser($Root) {
    $directory = Join-Path $Root 'receipt-parser'
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $receipt = Join-Path $directory 'phase.txt'
    if ((Get-OwnedStopReceiptState $receipt) -cne 'absent') { throw 'NSIS receipt absent control failed' }
    foreach ($case in @(
        @{ Bytes = [Text.Encoding]::ASCII.GetBytes('entered'); Expected = 'entered' },
        @{ Bytes = [Text.Encoding]::ASCII.GetBytes('returned'); Expected = 'returned' },
        @{ Bytes = [Text.Encoding]::ASCII.GetBytes('unknown'); Expected = 'invalid' },
        @{ Bytes = [byte[]]@(); Expected = 'invalid' },
        @{ Bytes = [byte[]](0..15); Expected = 'invalid' },
        @{ Bytes = [byte[]](0..16); Expected = 'invalid' },
        @{ Bytes = [byte[]]@(255); Expected = 'invalid' }
    )) {
        [IO.File]::WriteAllBytes($receipt, $case.Bytes)
        if ((Get-OwnedStopReceiptState $receipt) -cne $case.Expected) { throw 'NSIS receipt finite-byte control failed' }
    }
    if ((Get-OwnedStopReceiptState $directory) -cne 'unreadable') { throw 'NSIS receipt nonregular control failed' }
    # A locked owned file must never expose an exception or be mistaken as absent.
    $locked = [IO.File]::Open($receipt, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        if ((Get-OwnedStopReceiptState $receipt) -cne 'unreadable') { throw 'NSIS receipt unreadable control failed' }
    } finally { $locked.Dispose() }
}
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
    Test-OwnedStopReceiptParser $root
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
    # Prepare owned helper and macro copies. Their strict inverses retain every
    # original production byte; neither shipped source is edited. The existing
    # preamble field now transports the logger plus exactly one observed macro.
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
    # Keep the whole-production guard meaningful across the new transport:
    # strip only the four fixed observer blocks and compare the complete macro.
    # The Node producer separately enforces exact block bodies and byte inverse.
    $observedMacros = [regex]::Matches($observation.nsisPreamble, '(?ms)^!macro StopInstalledAgentUnshared\r?\n.*?^!macroend')
    if ($observedMacros.Count -ne 1) { throw 'NSIS observation requires one production macro' }
    $restoredMacro = [regex]::Replace($observedMacros[0].Value, '(?ms)^; CMSPARK_NSIS_MACRO_OBSERVE_V1_BEGIN:(plugin-dir-ready|script-extracted|exec-enter|exec-return)\r?\n.*?^; CMSPARK_NSIS_MACRO_OBSERVE_V1_END:\1\r?\n', '')
    if ($restoredMacro -cne $macro) { throw 'NSIS observed macro differs from production' }
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
Section
  ReadEnvStr $INSTDIR "CMSPARK_SMOKE_INSTALL_ROOT"
  FileOpen $9 "$EXEDIR\stop-phase.txt" w
  FileWrite $9 "entered"
  FileClose $9
__OBSERVATION_ENTER__
  !insertmacro StopInstalledAgentUnshared
  FileOpen $9 "$EXEDIR\stop-phase.txt" w
  FileWrite $9 "returned"
  FileClose $9
__OBSERVATION_AFTER__
SectionEnd
'@
    Set-Content -LiteralPath (Join-Path $root 'stop-smoke.nsi') -Value $harness.Replace('__OBSERVATION_PREAMBLE__', $observation.nsisPreamble).Replace('__OBSERVATION_ENTER__', $observation.nsisEnter).Replace('__OBSERVATION_AFTER__', $observation.nsisAfterMacro) -Encoding utf8BOM
    & $makensis /V2 ('/DCMSPARK_STOP_SCRIPT=' + $observation.helperPath) (Join-Path $root 'stop-smoke.nsi')
    if ($LASTEXITCODE -ne 0) { throw "NSIS smoke compilation failed: $LASTEXITCODE" }
    $env:CMSPARK_SMOKE_INSTALL_ROOT = $inside
    $stop = Start-Process -FilePath (Join-Path $root 'stop-smoke.exe') -PassThru
    if (-not $stop.WaitForExit(30000)) {
        try { Write-Output ('NSIS_STOP_SMOKE_STATE={0}' -f (Get-OwnedStopReceiptState (Join-Path $root 'stop-phase.txt'))) } catch {}
        Stop-Process -Id $stop.Id -Force -ErrorAction SilentlyContinue
        throw 'NSIS stop macro timed out'
    }
    if ($stop.ExitCode -ne 0) {
        try { Write-Output ('NSIS_STOP_SMOKE_STATE={0}' -f (Get-OwnedStopReceiptState (Join-Path $root 'stop-phase.txt'))) } catch {}
        throw "NSIS stop macro failed: $($stop.ExitCode)"
    }
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
