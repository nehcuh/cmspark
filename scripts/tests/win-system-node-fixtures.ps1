# Owned system-Node fixtures shared by the complete NSIS and ZIP stop smokes.
function New-OwnedSystemNodeFixtures($Root, $Inside, $Sibling) {
    $node = (Get-Command node).Source
    $stop = @()
    $survive = @()
    foreach ($directory in @($Inside, $Sibling)) {
        Set-Content -LiteralPath (Join-Path $directory 'cmspark-agent.js') -Encoding ascii -Value 'setInterval(()=>{},1000)'
    }
    try {
        foreach ($mode in @('tray', 'daemon start')) {
            $stop += Start-Process -FilePath $node -ArgumentList ('"{0}" {1}' -f (Join-Path $Inside 'cmspark-agent.js'), $mode) -PassThru -WindowStyle Hidden
        }
        $survive += Start-Process -FilePath $node -ArgumentList ('"{0}" tray' -f (Join-Path $Sibling 'cmspark-agent.js')) -PassThru -WindowStyle Hidden
        # Correct script path merely appears as data to an unrelated script.
        $survive += Start-Process -FilePath $node -ArgumentList ('"{0}" "{1}" tray' -f (Join-Path $Inside 'idle.js'), (Join-Path $Inside 'cmspark-agent.js')) -PassThru -WindowStyle Hidden
        # A prefix sibling and a non-agent mode must not acquire stop authority.
        $survive += Start-Process -FilePath $node -ArgumentList ('"{0}" unrelated' -f (Join-Path $Inside 'cmspark-agent.js')) -PassThru -WindowStyle Hidden
        foreach ($p in @($stop) + @($survive)) {
            $p.Refresh()
            if ($p.HasExited) { throw 'system Node fixture exited before the test' }
        }
        return @{ Stop = $stop; Survive = $survive }
    } catch {
        foreach ($p in @($stop) + @($survive)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
        throw
    }
}
