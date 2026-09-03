#!/usr/bin/env pwsh
# win-launcher-smoke.ps1 -- runtime smoke for companion/launch-hidden.vbs + launch.bat
#
# Runs on GitHub Actions windows-latest (pwsh). Static shape of the launchers is
# pinned by scripts/tests/test-package-gates.sh; this script proves the *runtime*
# behavior of the VBS decision tree on a real Windows box, in particular the
# b09b2211 regression state (VBScript `And` does not short-circuit, so the
# HasSystemNode probe must stay nested inside the js-exists branch).
#
# Each state runs in its own temp dir with launch-hidden.vbs copied in, and
# $env:USERPROFILE pointed at that dir so vbs-launcher.log lands per state.
# Everything is cleaned up at the end. Any failed check dumps the VBS log and
# the state dir listing, and the script exits 1 after all states ran.

#Requires -Version 7.0
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$VbsSource  = Join-Path $RepoRoot 'companion\launch-hidden.vbs'
$BatSource  = Join-Path $RepoRoot 'companion\launch.bat'
$WscriptExe = Join-Path $env:SystemRoot 'System32\wscript.exe'  # launch.bat uses wscript
$CmdExe     = Join-Path $env:SystemRoot 'System32\cmd.exe'

$WorkRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('win-launcher-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $WorkRoot -Force | Out-Null

$SavedPath        = $env:PATH
$SavedUserProfile = $env:USERPROFILE

$script:Checks        = 0
$script:Failures      = 0
$script:ExeStubSource = $null

# ---------------------------------------------------------------- helpers ---

function Write-Check {
    param([string]$Id, [bool]$Ok, [string]$Message, [string]$StateDir)
    $script:Checks++
    if ($Ok) {
        Write-Host "PASS [$Id] $Message"
    } else {
        $script:Failures++
        Write-Host "FAIL [$Id] $Message"
        if ($StateDir) { Show-StateDiagnostics -StateDir $StateDir }
    }
}

function Show-StateDiagnostics {
    param([string]$StateDir)
    Write-Host "----- diagnostics for $StateDir -----"
    $log = Join-Path $StateDir '.cmspark-agent\logs\vbs-launcher.log'
    if (Test-Path -LiteralPath $log) {
        Write-Host "--- vbs-launcher.log ---"
        Get-Content -LiteralPath $log | ForEach-Object { Write-Host "  $_" }
    } else {
        Write-Host "(no vbs-launcher.log at $log)"
    }
    Write-Host "--- state dir listing ---"
    Get-ChildItem -LiteralPath $StateDir -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
        $size = if ($_.PSIsContainer) { '<dir>' } else { '{0} bytes' -f $_.Length }
        Write-Host ("  {0} {1}" -f $_.FullName, $size)
    }
    Write-Host "----- end diagnostics -----"
}

function New-State {
    param([string]$Name)
    $dir = Join-Path $WorkRoot $Name
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    Copy-Item -LiteralPath $VbsSource -Destination (Join-Path $dir 'launch-hidden.vbs')
    return $dir
}

function Write-JsStub {
    # Stands in for cmspark-agent.js: records which node ran it (execPath),
    # its argv and NODE_PATH into launched-js.txt next to itself, then exits.
    param([string]$StateDir)
    $js = @'
const fs = require('fs');
const path = require('path');
const marker = {
  execPath: process.execPath,
  argv: process.argv,
  NODE_PATH: process.env.NODE_PATH || ''
};
fs.writeFileSync(path.join(__dirname, 'launched-js.txt'), JSON.stringify(marker, null, 2));
'@
    Set-Content -LiteralPath (Join-Path $StateDir 'cmspark-agent.js') -Value $js -Encoding ascii
}

function Copy-BundledNode {
    # "Bundled node.exe" = a copy of the runner's real node.
    param([string]$StateDir)
    $node = (Get-Command node).Source
    Copy-Item -LiteralPath $node -Destination (Join-Path $StateDir 'node.exe')
}

function Find-Csc {
    # Add-Type -OutputAssembly cannot emit an exe on pwsh 7 (.NET Core), so the
    # SEA stub is compiled with the .NET Framework csc.exe that ships with Windows.
    $candidates = @(
        (Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
        (Join-Path $env:SystemRoot 'Microsoft.NET\Framework\v4.0.30319\csc.exe'),
        (Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v2.0.50727\csc.exe'),
        (Join-Path $env:SystemRoot 'Microsoft.NET\Framework\v2.0.50727\csc.exe')
    )
    foreach ($c in $candidates) {
        if (Test-Path -LiteralPath $c) { return $c }
    }
    $found = Get-ChildItem -Path (Join-Path $env:SystemRoot 'Microsoft.NET\Framework*\v*\csc.exe') -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -ne $found) { return $found.FullName }
    return $null
}

function Get-ExeStub {
    # Compile the SEA stub once per run: writes launched-exe.txt (with its
    # command-line args) next to itself and exits.
    if ($null -ne $script:ExeStubSource -and (Test-Path -LiteralPath $script:ExeStubSource)) {
        return $script:ExeStubSource
    }
    $stubDir = Join-Path $WorkRoot '_stub'
    New-Item -ItemType Directory -Path $stubDir -Force | Out-Null
    $out = Join-Path $stubDir 'stub-agent.exe'
    $csPath = Join-Path $stubDir 'stub-agent.cs'
    # Kept C# 2.0-compatible (no var / expression-bodied members) so even the
    # legacy v2.0.50727 csc.exe can build it.
    $cs = @'
using System;
using System.IO;
public static class StubAgent {
    public static int Main(string[] args) {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        File.WriteAllText(Path.Combine(dir, "launched-exe.txt"),
            "args=" + string.Join(" ", args));
        return 0;
    }
}
'@
    Set-Content -LiteralPath $csPath -Value $cs -Encoding ascii
    $csc = Find-Csc
    if ($null -eq $csc) {
        throw "csc.exe (.NET Framework compiler) not found under $env:SystemRoot\Microsoft.NET"
    }
    Write-Host "compiling exe stub with $csc"
    $compileOut = & $csc /nologo /target:exe "/out:$out" "$csPath" 2>&1
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $out)) {
        throw "csc.exe failed (exit ${LASTEXITCODE}):`n$compileOut"
    }
    $script:ExeStubSource = $out
    return $out
}

function Copy-ExeStub {
    param([string]$StateDir)
    Copy-Item -LiteralPath (Get-ExeStub) -Destination (Join-Path $StateDir 'cmspark-agent.exe')
}

function Use-MinimalPath {
    # Simulate "no system node": keep only Windows dirs (cmd/wscript/find/
    # netstat/ping live in System32) so `node --version` exits 9009.
    $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\Wbem"
}

function Restore-OriginalPath { $env:PATH = $SavedPath }

function Invoke-Vbs {
    # Runs the state dir's launch-hidden.vbs via wscript.exe (async launches
    # inside the VBS outlive it; wscript's own exit code is the script's
    # WScript.Quit code). A timeout guards against probe hangs / error dialogs.
    param([string]$StateDir, [int]$TimeoutSec = 30)
    $vbs = Join-Path $StateDir 'launch-hidden.vbs'
    $env:USERPROFILE = $StateDir
    $p = Start-Process -FilePath $WscriptExe -ArgumentList ('"{0}"' -f $vbs) -PassThru
    if (-not $p.WaitForExit($TimeoutSec * 1000)) {
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        return [pscustomobject]@{ TimedOut = $true; ExitCode = $null }
    }
    $code = $p.ExitCode
    return [pscustomobject]@{ TimedOut = $false; ExitCode = $code }
}

function Wait-ForFile {
    param([string]$Path, [int]$TimeoutSec = 20)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
        if (Test-Path -LiteralPath $Path) { return $true }
        Start-Sleep -Milliseconds 250
    }
    return (Test-Path -LiteralPath $Path)
}

function Read-Marker {
    param([string]$Path)
    return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json)
}

function Test-SamePath {
    # Case-insensitive, trim-tolerant (the VBS `set NODE_PATH=.. ` leaves a
    # trailing space), with a long-name fallback for 8.3 short paths.
    param([string]$A, [string]$B)
    if ([string]::IsNullOrWhiteSpace($A) -or [string]::IsNullOrWhiteSpace($B)) { return $false }
    $na = $A.Trim().TrimEnd('\')
    $nb = $B.Trim().TrimEnd('\')
    if ([string]::Equals($na, $nb, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    try {
        $fa = (Get-Item -LiteralPath $na).FullName.TrimEnd('\')
        $fb = (Get-Item -LiteralPath $nb).FullName.TrimEnd('\')
        return [string]::Equals($fa, $fb, [System.StringComparison]::OrdinalIgnoreCase)
    } catch {
        return $false
    }
}

function Get-VbsLog {
    param([string]$StateDir)
    return (Join-Path $StateDir '.cmspark-agent\logs\vbs-launcher.log')
}

# ----------------------------------------------------------------- states ---

function Test-S1 {
    $id = 'S1'
    $dir = New-State 's1'
    Restore-OriginalPath
    Write-JsStub $dir
    Copy-BundledNode $dir
    $r = Invoke-Vbs $dir
    if ($r.TimedOut) { Write-Check $id $false 'wscript.exe did not exit within 30s (hang or error dialog)' $dir; return }
    if ($r.ExitCode -ne 0) { Write-Check $id $false "expected wscript exit 0, got $($r.ExitCode)" $dir; return }
    $jsMarker = Join-Path $dir 'launched-js.txt'
    if (-not (Wait-ForFile $jsMarker)) { Write-Check $id $false 'launched-js.txt did not appear within 20s' $dir; return }
    if (Test-Path -LiteralPath (Join-Path $dir 'launched-exe.txt')) {
        Write-Check $id $false 'exe stub ran even though bundled node.exe + js exist (P1 must win)' $dir; return
    }
    $m = Read-Marker $jsMarker
    $bundled = Join-Path $dir 'node.exe'
    if (-not (Test-SamePath $m.execPath $bundled)) {
        Write-Check $id $false "P1 must run the BUNDLED node ($bundled) even with system node on PATH; got execPath=$($m.execPath)" $dir; return
    }
    if (-not (Test-SamePath $m.NODE_PATH $dir)) {
        Write-Check $id $false "NODE_PATH should be the state dir ($dir), got '$($m.NODE_PATH)'" $dir; return
    }
    Write-Check $id $true 'P1: bundled node.exe ran the js stub (wins over system node and SEA)'
}

function Test-S2 {
    $id = 'S2'
    $dir = New-State 's2'
    Restore-OriginalPath
    Write-JsStub $dir
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Check $id $false 'harness: no system node on PATH (setup-node missing?)' $dir; return
    }
    $r = Invoke-Vbs $dir
    if ($r.TimedOut) { Write-Check $id $false 'wscript.exe did not exit within 30s (hang or error dialog)' $dir; return }
    if ($r.ExitCode -ne 0) { Write-Check $id $false "expected wscript exit 0, got $($r.ExitCode)" $dir; return }
    $jsMarker = Join-Path $dir 'launched-js.txt'
    if (-not (Wait-ForFile $jsMarker)) { Write-Check $id $false 'launched-js.txt did not appear within 20s' $dir; return }
    if (Test-Path -LiteralPath (Join-Path $dir 'launched-exe.txt')) {
        Write-Check $id $false 'exe stub ran; P2 (system node + js) should have won' $dir; return
    }
    $m = Read-Marker $jsMarker
    if (-not (Test-SamePath $m.NODE_PATH $dir)) {
        Write-Check $id $false "NODE_PATH should be the state dir ($dir), got '$($m.NODE_PATH)'" $dir; return
    }
    Write-Check $id $true 'P2: system node + js path taken (no bundled node.exe present)'
}

function Test-S3 {
    # Core b09b2211 regression state: js exists, no bundled node, PATH has no
    # node -> the nested HasSystemNode probe must fail and the nested ElseIf
    # must fall through to the SEA exe (not to the error branch).
    $id = 'S3'
    $dir = New-State 's3'
    Use-MinimalPath
    Write-JsStub $dir
    Copy-ExeStub $dir
    if (Get-Command node -ErrorAction SilentlyContinue) {
        Write-Check $id $false 'harness: node still resolvable under the minimal PATH' $dir; return
    }
    $r = Invoke-Vbs $dir
    if ($r.TimedOut) { Write-Check $id $false 'wscript.exe did not exit within 30s (HasSystemNode probe hang?)' $dir; return }
    if ($r.ExitCode -ne 0) { Write-Check $id $false "expected wscript exit 0 (SEA fallback), got $($r.ExitCode)" $dir; return }
    $exeMarker = Join-Path $dir 'launched-exe.txt'
    if (-not (Wait-ForFile $exeMarker)) {
        Write-Check $id $false 'launched-exe.txt did not appear within 20s (SEA fallback not taken)' $dir; return
    }
    if (Test-Path -LiteralPath (Join-Path $dir 'launched-js.txt')) {
        Write-Check $id $false 'js stub ran even though no node runtime exists' $dir; return
    }
    $content = Get-Content -LiteralPath $exeMarker -Raw
    if ($content -notmatch 'tray') {
        Write-Check $id $false "exe stub marker should contain the 'tray' arg, got: $content" $dir; return
    }
    Write-Check $id $true 'b09b2211: js present + probe fails (no node) -> nested ElseIf fell through to SEA exe'
}

function Test-S4 {
    $id = 'S4'
    $dir = New-State 's4'
    Use-MinimalPath
    Write-JsStub $dir
    $r = Invoke-Vbs $dir
    if ($r.TimedOut) {
        Write-Check $id $false 'wscript.exe did not exit within 30s -- expected a clean WScript.Quit 1; a hang here suggests an unhandled VBScript error dialog (e.g. vbs-launcher.log not writable because .cmspark-agent\logs could not be created)' $dir; return
    }
    if ($r.ExitCode -ne 1) { Write-Check $id $false "expected wscript exit 1, got $($r.ExitCode)" $dir; return }
    $log = Get-VbsLog $dir
    if (-not (Test-Path -LiteralPath $log)) {
        Write-Check $id $false "expected error log at $log (log dir not created under the redirected USERPROFILE?)" $dir; return
    }
    $content = Get-Content -LiteralPath $log -Raw
    if ($content -notmatch 'no usable node runtime') {
        Write-Check $id $false "log should contain 'no usable node runtime', got:`n$content" $dir; return
    }
    Write-Check $id $true 'js + no node runtime + no exe -> exit 1 with "no usable node runtime" logged'
}

function Test-S5 {
    $id = 'S5'
    $dir = New-State 's5'
    Use-MinimalPath
    $r = Invoke-Vbs $dir
    if ($r.TimedOut) {
        Write-Check $id $false 'wscript.exe did not exit within 30s -- expected a clean WScript.Quit 1; a hang here suggests an unhandled VBScript error dialog (log dir not creatable on clean profile?)' $dir; return
    }
    if ($r.ExitCode -ne 1) { Write-Check $id $false "expected wscript exit 1, got $($r.ExitCode)" $dir; return }
    $log = Get-VbsLog $dir
    if (-not (Test-Path -LiteralPath $log)) {
        Write-Check $id $false "expected error log at $log (log dir not created under the redirected USERPROFILE?)" $dir; return
    }
    $content = Get-Content -LiteralPath $log -Raw
    if ($content -notmatch 'Neither') {
        Write-Check $id $false "log should contain 'Neither', got:`n$content" $dir; return
    }
    Write-Check $id $true 'empty dir -> exit 1 with "Neither cmspark-agent.js nor cmspark-agent.exe" logged'
}

function Test-S6 {
    $id = 'S6'
    $dir = New-State 's6'
    Use-MinimalPath
    Copy-ExeStub $dir
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $r = Invoke-Vbs $dir
    $sw.Stop()
    if ($r.TimedOut) { Write-Check $id $false 'wscript.exe did not exit within 30s (unexpected probe on the SEA-only path?)' $dir; return }
    if ($r.ExitCode -ne 0) { Write-Check $id $false "expected wscript exit 0, got $($r.ExitCode)" $dir; return }
    $exeMarker = Join-Path $dir 'launched-exe.txt'
    if (-not (Wait-ForFile $exeMarker)) { Write-Check $id $false 'launched-exe.txt did not appear within 20s' $dir; return }
    $content = Get-Content -LiteralPath $exeMarker -Raw
    if ($content -notmatch 'tray') {
        Write-Check $id $false "exe stub marker should contain the 'tray' arg, got: $content" $dir; return
    }
    Write-Check $id $true ("SEA-only dir -> P3 launched the exe directly, no probe hang (wscript exited in {0:n1}s)" -f $sw.Elapsed.TotalSeconds)
}

function Test-S7 {
    # Empirical check of the standing suspicion that a successful async
    # objShell.Run (returns 0, not a PID) could be mislogged as "Launch failed".
    $id = 'S7'
    $dir = New-State 's7'
    Restore-OriginalPath
    Write-JsStub $dir
    Copy-BundledNode $dir
    $r = Invoke-Vbs $dir
    if ($r.TimedOut) { Write-Check $id $false 'wscript.exe did not exit within 30s' $dir; return }
    if ($r.ExitCode -ne 0) { Write-Check $id $false "expected wscript exit 0, got $($r.ExitCode)" $dir; return }
    if (-not (Wait-ForFile (Join-Path $dir 'launched-js.txt'))) {
        Write-Check $id $false 'launched-js.txt did not appear within 20s (launch itself failed)' $dir; return
    }
    $log = Get-VbsLog $dir
    if ((Test-Path -LiteralPath $log) -and ((Get-Content -LiteralPath $log -Raw) -match '\[ERROR\] Launch failed')) {
        Write-Check $id $false 'successful async launch was mislogged as "[ERROR] Launch failed"' $dir; return
    }
    Write-Check $id $true 'successful async objShell.Run (ret 0) is NOT logged as "[ERROR] Launch failed"'
}

function Test-S8 {
    # launch.bat decision surface on the S3 layout: its own P2 `node --version`
    # probe must not block the SEA fallback. Port 23401 is not listening (no
    # real daemon), so the failure-path copy is expected; `echo. |` feeds the
    # failure-path `pause` so the bat cannot idle forever.
    $id = 'S8'
    $dir = New-State 's8'
    Use-MinimalPath
    Write-JsStub $dir
    Copy-ExeStub $dir
    Copy-Item -LiteralPath $BatSource -Destination (Join-Path $dir 'launch.bat')
    $env:USERPROFILE = $dir
    $batOut = Join-Path $dir '_bat-output.txt'
    $wrapper = Join-Path $dir '_run-bat.cmd'
    $wrapperLines = @(
        '@echo off',
        ('echo. | cmd /c "{0}" > "{1}" 2>&1' -f (Join-Path $dir 'launch.bat'), $batOut)
    )
    Set-Content -LiteralPath $wrapper -Value $wrapperLines -Encoding ascii
    $p = Start-Process -FilePath $CmdExe -ArgumentList '/c', ('"{0}"' -f $wrapper) -WorkingDirectory $dir -PassThru
    if (-not $p.WaitForExit(60000)) {
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        Write-Check $id $false 'launch.bat did not finish within 60s (pause not fed? port probe hang?)' $dir; return
    }
    if (-not (Wait-ForFile $batOut 10)) { Write-Check $id $false 'bat produced no output file' $dir; return }
    $out = Get-Content -LiteralPath $batOut -Raw
    if ($out -notmatch [regex]::Escape('Found cmspark-agent.exe (SEA last resort)')) {
        Write-Check $id $false "bat did not reach the SEA decision line; output:`n$out" $dir; return
    }
    if ($out -notmatch 'port 23401 not listening') {
        Write-Check $id $false "expected the bat port-probe failure copy (no real daemon); output:`n$out" $dir; return
    }
    Write-Check $id $true 'bat: P2 node probe failed cleanly and "Found cmspark-agent.exe (SEA last resort)" was chosen'
}

# ------------------------------------------------------------------- main ---

function Invoke-State {
    param([string]$Id, [scriptblock]$Body)
    try {
        & $Body
    } catch {
        Write-Check $Id $false "harness error: $($_.Exception.Message)" $null
    }
}

try {
    Invoke-State 'S1' { Test-S1 }
    Invoke-State 'S2' { Test-S2 }
    Invoke-State 'S3' { Test-S3 }
    Invoke-State 'S4' { Test-S4 }
    Invoke-State 'S5' { Test-S5 }
    Invoke-State 'S6' { Test-S6 }
    Invoke-State 'S7' { Test-S7 }
    Invoke-State 'S8' { Test-S8 }
} finally {
    $env:PATH        = $SavedPath
    $env:USERPROFILE = $SavedUserProfile
    Remove-Item -LiteralPath $WorkRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("===== win-launcher-smoke: {0}/{1} checks passed =====" -f ($script:Checks - $script:Failures), $script:Checks)
if ($script:Failures -gt 0) { exit 1 }
exit 0
