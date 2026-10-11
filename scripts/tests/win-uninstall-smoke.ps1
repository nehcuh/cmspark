# Execute the complete shipped ZIP uninstaller with isolated profile fixtures.
# Only schtasks/chrome are substituted; the production process stop is real.
#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$root = Join-Path ([IO.Path]::GetTempPath()) ('cmspark-uninstall-' + [guid]::NewGuid().ToString('N'))
$inside = Join-Path $root "space 中文 & O'Brien ! (test)"
$sibling = $inside + '-other'
$processes = @()
$runner = $null
. (Join-Path $PSScriptRoot 'win-system-node-fixtures.ps1')
try {
    $node = (Get-Command node).Source
    foreach ($directory in @($inside, $sibling)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $directory 'idle.js') -Encoding ascii -Value 'setInterval(()=>{},1000)'
        foreach ($image in @('node.exe', 'cmspark-agent.exe')) {
            Copy-Item -LiteralPath $node -Destination (Join-Path $directory $image)
            $processes += Start-Process -FilePath (Join-Path $directory $image) -ArgumentList ('"{0}"' -f (Join-Path $directory 'idle.js')) -PassThru -WindowStyle Hidden
        }
    }
    $system = New-OwnedSystemNodeFixtures $root $inside $sibling
    $processes += @($system.Stop) + @($system.Survive)
    Copy-Item -LiteralPath (Join-Path $repo 'companion\uninstall.bat') -Destination $inside
    Copy-Item -LiteralPath (Join-Path $repo 'companion\stop-installed-agent.ps1') -Destination $inside
    $fixtureProfile = Join-Path $root 'profile'
    $startup = Join-Path $fixtureProfile 'Microsoft\Windows\Start Menu\Programs\Startup'
    New-Item -ItemType Directory -Path $startup -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $startup 'CMspark.lnk') -Value 'fixture'
    New-Item -ItemType Directory -Path (Join-Path $fixtureProfile '.cmspark-agent') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $fixtureProfile '.cmspark-agent\keep.txt') -Value 'keep'
    Set-Content -LiteralPath (Join-Path $inside 'cmspark-agent.log') -Value 'fixture'
    Set-Content -LiteralPath (Join-Path $inside 'cmspark-agent.lock') -Value 'fixture'
    $bin = Join-Path $root 'bin'
    New-Item -ItemType Directory -Path $bin | Out-Null
    # Native no-op executables avoid cmd's batch-to-batch control transfer and
    # cannot delete a real scheduled task or open the user's browser.
    $csc = @('Framework64', 'Framework') | ForEach-Object { Join-Path $env:SystemRoot "Microsoft.NET\$_\v4.0.30319\csc.exe" } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $csc) { throw '.NET Framework compiler unavailable' }
    $noop = Join-Path $root 'noop.cs'
    Set-Content -LiteralPath $noop -Encoding ascii -Value 'public class SmokeNoop { public static int Main(string[] args) { return 0; } }'
    & $csc /nologo /target:exe ('/out:' + (Join-Path $bin 'schtasks.exe')) $noop
    if ($LASTEXITCODE -ne 0) { throw 'native no-op fixture compilation failed' }
    Copy-Item -LiteralPath (Join-Path $bin 'schtasks.exe') -Destination (Join-Path $bin 'chrome.exe')
    Set-Content -LiteralPath (Join-Path $root 'input.txt') -Encoding ascii -Value "N`r`n`r`n"
    Set-Content -LiteralPath (Join-Path $root 'run.cmd') -Encoding ascii -Value '@call "%CMSPARK_SMOKE_UNINSTALL%" < "%CMSPARK_SMOKE_INPUT%"'
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
    $start.Arguments = '/d /v:off /c run.cmd'
    $start.WorkingDirectory = $root
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.Environment['CMSPARK_SMOKE_UNINSTALL'] = Join-Path $inside 'uninstall.bat'
    $start.Environment['CMSPARK_SMOKE_INPUT'] = Join-Path $root 'input.txt'
    $start.Environment['APPDATA'] = $fixtureProfile
    $start.Environment['USERPROFILE'] = $fixtureProfile
    $start.Environment['PATH'] = $bin + ';' + $env:PATH
    $runner = [Diagnostics.Process]::Start($start)
    if (-not $runner.WaitForExit(30000)) { throw 'ZIP uninstaller timed out' }
    if ($runner.ExitCode -ne 0) { throw "ZIP uninstaller failed: $($runner.ExitCode)" }
    foreach ($p in $processes[0..1]) { if (-not $p.WaitForExit(10000)) { throw 'installed runtime was not stopped' } }
    foreach ($p in $processes[2..3]) { $p.Refresh(); if ($p.HasExited) { throw 'sibling runtime was incorrectly stopped' } }
    foreach ($p in $system.Stop) { if (-not $p.WaitForExit(10000)) { throw 'system Node agent was not stopped' } }
    foreach ($p in $system.Survive) { $p.Refresh(); if ($p.HasExited) { throw 'unrelated system Node process was stopped' } }
    if (Test-Path -LiteralPath (Join-Path $startup 'CMspark.lnk')) { throw 'full uninstall did not remove fixture shortcut' }
    foreach ($name in @('cmspark-agent.log', 'cmspark-agent.lock')) {
        if (Test-Path -LiteralPath (Join-Path $inside $name)) { throw "full uninstall did not remove $name" }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $fixtureProfile '.cmspark-agent\keep.txt'))) { throw 'declined user data deletion was ignored' }
    Write-Host 'PASS: complete ZIP uninstall stopped bundled/system runtimes; siblings/unrelated Node and declined data survived'
} finally {
    if ($runner -and -not $runner.HasExited) { Stop-Process -Id $runner.Id -Force -ErrorAction SilentlyContinue }
    foreach ($p in $processes) { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
