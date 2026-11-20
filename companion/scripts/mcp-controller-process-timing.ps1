# Scoped hosted diagnostic for the unchanged 20-second MCP acceptance.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or
    $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:CMSPARK_MCP_STACK_PROBE_826 -ne '1') {
    throw 'MCP_PROCESS_TIMING_REQUIRES_HOSTED_WINDOWS'
}

$session = 'CMsparkMcp476-' + [Guid]::NewGuid().ToString('N')
$trace = Join-Path $env:RUNNER_TEMP "$session.etl"
$logman = Join-Path $env:SystemRoot 'System32/logman.exe'
$provider = '{22fb2cd6-0e7b-422b-a0c7-2fad1fd0e716}' # Microsoft-Windows-Kernel-Process
$facts = [ordered]@{ schema = 1; status = 'UNKNOWN'; hostCount = 0; browserAfterHostMs = $null; childAfterBrowserMs = $null }
$testExit = 1

function Get-ProcessStarts($path) {
    foreach ($event in Get-WinEvent -Path $path -Oldest -MaxEvents 4096) {
        if ($event.Id -ne 1 -or $event.ProviderId -ne [Guid]$provider) { continue }
        $fields = @{}
        foreach ($field in ([xml]$event.ToXml()).Event.EventData.Data) {
            if ($field.Name -in 'ProcessID','ParentProcessID','ImageName') { $fields[$field.Name] = $field.'#text' }
        }
        if ($fields.Count -eq 3 -and $event.TimeCreated) {
            [pscustomobject]@{
                Id = [uint32]$fields.ProcessID
                Parent = [uint32]$fields.ParentProcessID
                Image = $fields.ImageName
                Time = $event.TimeCreated
            }
        }
    }
}

try {
    & $logman start $session -ets -p $provider 0x10 4 -o $trace -f bincirc -max 8 *> $null
    if ($LASTEXITCODE -ne 0) { throw 'MCP_PROCESS_TIMING_START' }
    try {
        & node scripts/mcp-stack-probe-826.mjs
        $testExit = $LASTEXITCODE
    } finally {
        & $logman stop $session -ets *> $null
        if ($LASTEXITCODE -ne 0) { throw 'MCP_PROCESS_TIMING_STOP' }
    }
    $rows = @(Get-ProcessStarts $trace)
    $owners = @($rows | Where-Object { $_.Image -match '(?:^|[\\/])mcp-snapshot-825[\\/]cmspark-desktop\.exe$' })
    $facts.hostCount = [Math]::Min(2, $owners.Count)
    if ($owners.Count -eq 1) {
        $hostStart = $owners[0]
        $browser = $rows | Where-Object {
            $_.Parent -eq $hostStart.Id -and $_.Time -ge $hostStart.Time -and $_.Image -match '[\\/]msedgewebview2\.exe$'
        } | Select-Object -First 1
        if ($browser) {
            $facts.browserAfterHostMs = [int]($browser.Time - $hostStart.Time).TotalMilliseconds
            $child = $rows | Where-Object {
                $_.Parent -eq $browser.Id -and $_.Time -ge $browser.Time -and $_.Image -match '[\\/]msedgewebview2\.exe$'
            } | Select-Object -First 1
            if ($child) { $facts.childAfterBrowserMs = [int]($child.Time - $browser.Time).TotalMilliseconds }
        }
        $facts.status = 'OBSERVED'
    }
} catch {
    Write-Output 'MCP_PROCESS_TIMING_INCOMPLETE'
} finally {
    if ([IO.File]::Exists($trace)) { [IO.File]::Delete($trace) }
}

$output = Join-Path $env:RUNNER_TEMP 'mcp-stack-probe-826'
if ([IO.Directory]::Exists($output)) {
    $json = $facts | ConvertTo-Json -Compress
    [IO.File]::WriteAllText((Join-Path $output 'process-timing.json'), $json)
    Write-Output "MCP_PROCESS_TIMING $json"
}
exit $testExit
