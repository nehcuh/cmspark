#!/usr/bin/env pwsh
# win-sapi-smoke.ps1 -- runtime smoke for the #259 Windows SAPI fallback helper.
#
# Runs on GitHub Actions windows-latest (pwsh). Proves on a real Windows box:
#   1. win-sapi-helper.cs compiles with the .NET Framework csc.exe that ships
#      with Windows (+ GAC System.Speech reference) — no SDK needed.
#   2. The helper speaks the line-JSON protocol over STDIN (the helper only
#      reads Console.ReadLine — argv is unused): {probe:true} piped to stdin
#      must reply one JSON frame containing "available". A protocol error
#      frame does NOT count as success.
#   3. A silent 1s WAV transcribes through the full helper pipeline and yields
#      exactly one well-formed frame (text or error — NO content assertions:
#      runner SKUs are Server without speech recognizers, and that is a legal
#      honest-error outcome). Protocol errors, however, DO fail the gate.
# Any failed check exits 1 with diagnostics.
#
# Static/protocol contract is pinned by companion voice-win-sapi tests; this
# script catches platform-only breaks (csc availability, GAC layout, console
# encodings).

#Requires -Version 7.0
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Join-Path $PSScriptRoot '..\..'
$HelperCs = Join-Path $RepoRoot 'companion\src\voice\win-sapi-helper.cs'

$script:Checks   = 0
$script:Failures = 0

function Write-Check {
    param([string]$Id, [bool]$Ok, [string]$Message)
    $script:Checks++
    if ($Ok) { Write-Host "PASS [$Id] $Message" }
    else {
        $script:Failures++
        Write-Host "FAIL [$Id] $Message"
    }
}

function Find-Csc {
    $candidates = @(
        (Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
        (Join-Path $env:SystemRoot 'Microsoft.NET\Framework\v4.0.30319\csc.exe'),
        (Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v2.0.50727\csc.exe'),
        (Join-Path $env:SystemRoot 'Microsoft.NET\Framework\v2.0.50727\csc.exe')
    )
    foreach ($c in $candidates) {
        if (Test-Path -LiteralPath $c) { return $c }
    }
    return $null
}

function Find-SystemSpeechRef {
    $gac = Get-ChildItem -Path (Join-Path $env:SystemRoot 'Microsoft.NET\assembly\GAC_MSIL\System.Speech') `
        -Recurse -Filter 'System.Speech.dll' -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -ne $gac) { return $gac.FullName }
    return $null
}

function New-SilentWav {
    # Minimal 16 kHz / 16-bit / mono WAV of pure silence (1s), little-endian.
    param([string]$Path)
    $sampleRate = 16000
    $dataBytes = $sampleRate * 2
    $bw = [System.IO.BinaryWriter]::new([System.IO.File]::Create($Path))
    try {
        $bw.Write([System.Text.Encoding]::ASCII.GetBytes('RIFF'))
        $bw.Write([UInt32](36 + $dataBytes))
        $bw.Write([System.Text.Encoding]::ASCII.GetBytes('WAVE'))
        $bw.Write([System.Text.Encoding]::ASCII.GetBytes('fmt '))
        $bw.Write([UInt32]16)
        $bw.Write([UInt16]1)          # PCM
        $bw.Write([UInt16]1)          # mono
        $bw.Write([UInt32]$sampleRate)
        $bw.Write([UInt32]($sampleRate * 2))  # byte rate
        $bw.Write([UInt16]2)          # block align
        $bw.Write([UInt16]16)         # bits
        $bw.Write([System.Text.Encoding]::ASCII.GetBytes('data'))
        $bw.Write([UInt32]$dataBytes)
        for ($i = 0; $i -lt $sampleRate; $i++) { $bw.Write([Int16]0) }
    } finally { $bw.Dispose() }
}

# --- compile -------------------------------------------------------------------

$WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ('win-sapi-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
try {
    $csc = Find-Csc
    Write-Check 'S0' ($null -ne $csc) "csc.exe (.NET Framework compiler) found under $env:SystemRoot\Microsoft.NET"
    if ($null -eq $csc) { exit 1 }
    Write-Host "compiler: $csc"

    $speechRef = Find-SystemSpeechRef
    Write-Check 'S1' ($null -ne $speechRef) 'System.Speech.dll found in the GAC'
    if ($null -eq $speechRef) { exit 1 }
    Write-Host "reference: $speechRef"

    $exe = Join-Path $WorkDir 'win-sapi-helper.exe'
    $compileOut = & $csc /nologo /target:exe "/out:$exe" "/r:$speechRef" "$HelperCs" 2>&1
    Write-Check 'S2' ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $exe)) "win-sapi-helper.cs compiles with in-box csc.exe"
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $exe)) {
        Write-Host "--- csc output ---`n$compileOut"
        exit 1
    }

    # --- probe frame (STDIN line-JSON — the helper's only transport) -------------

    # The helper reads ONE line from stdin (Console.ReadLine) and never looks at
    # argv — pipe the JSON in. Protocol error frames fail this check: the probe
    # handler always replies with an "available" boolean.
    $probeLine = @(('{"probe":true}' | & $exe 2>$null) | Where-Object { $_ -match '^\s*\{' })[0]
    $probeJson = $null
    try { $probeJson = $probeLine | ConvertFrom-Json } catch { $probeJson = $null }
    $probeOk = $null -ne $probeJson -and
        ($probeJson.PSObject.Properties.Name -contains 'available')
    Write-Check 'P1' $probeOk "probe frame over stdin contains 'available' (protocol error fails): $probeLine"

    # --- silent WAV pipeline -------------------------------------------------------

    $wav = Join-Path $WorkDir 'silence.wav'
    New-SilentWav -Path $wav
    Write-Check 'W0' ((Get-Item -LiteralPath $wav).Length -gt 44) "silent 1s WAV generated ($((Get-Item -LiteralPath $wav).Length) bytes)"

    # Same stdin contract: request JSON piped in, never argv.
    $req = ('{"wav_path":"' + ($wav -replace '\\', '\\\\') + '","lang":"zh"}')
    $tLine = @(($req | & $exe 2>$null) | Where-Object { $_ -match '^\s*\{' })[0]
    $tJson = $null
    try { $tJson = $tLine | ConvertFrom-Json } catch { $tJson = $null }
    $tProps = @()
    if ($null -ne $tJson) { $tProps = $tJson.PSObject.Properties.Name }
    $frameOk = ($null -ne $tJson) -and
        (($tProps -contains 'text') -or ($tProps -contains 'error')) -and
        (($tProps -notcontains 'code') -or ($tProps -contains 'code' -and [string]$tJson.code -ne 'protocol'))
    Write-Check 'T1' $frameOk "silent WAV yields one well-formed frame over stdin (protocol errors fail): $tLine"

    Write-Host ""
    if ($script:Failures -gt 0) {
        Write-Host "win-sapi-smoke: $($script:Failures)/$($script:Checks) checks FAILED" -ForegroundColor Red
        exit 1
    }
    Write-Host "win-sapi-smoke: all $($script:Checks) checks passed" -ForegroundColor Green
    exit 0
} finally {
    Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
}
