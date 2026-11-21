param([Parameter(Mandatory=$true)][ValidateSet('shipped','native')][string]$Mode)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows' -or -not [Environment]::Is64BitProcess) { throw 'DISPOSABLE_WINDOWS_X64_REQUIRED' }
$source = (Resolve-Path -LiteralPath 'scripts/installer.nsi').Path
$bytes = [IO.File]::ReadAllBytes($source)
$original = [Text.Encoding]::UTF8.GetString($bytes)
$redirected = '$SYSDIR\WindowsPowerShell\v1.0\powershell.exe'
$native = '$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe'
if ([regex]::Matches($original, [regex]::Escape($redirected)).Count -ne 1 -or $original.Contains($native)) { throw 'ORIGINAL_COMMAND_ANCHOR' }

function Get-ObservedLaunch($path) {
    $events = foreach ($event in Get-WinEvent -Path $path -Oldest -ErrorAction Stop) {
        if ($event.ProviderName -ne 'Microsoft-Windows-Kernel-Process' -or $event.Id -notin 1,2) { continue }
        $fields = @{}
        foreach ($field in ([xml]$event.ToXml()).Event.EventData.Data) { $fields[$field.Name] = $field.'#text' }
        $pidValue = 0
        if (-not [int]::TryParse($fields['ProcessID'], [ref]$pidValue) -or $pidValue -le 0) { continue }
        $parent = 0
        $null = [int]::TryParse($fields['ParentProcessID'], [ref]$parent)
        [pscustomobject]@{ id=$event.Id; processId=$pidValue; parentId=$parent; time=$event.TimeCreated; image=[string]$fields['ImageName'] }
    }
    $harness = @($events | Where-Object { $_.id -eq 1 -and $_.image -imatch '(?:^|\\)cmspark-stop-[0-9a-f]{32}\\stop-smoke\.exe$' })
    if ($harness.Count -ne 1) { return @{state='HARNESS_UNKNOWN'; child='UNKNOWN'; startMs=$null; stopMs=$null} }
    $owner = $harness[0]
    $children = @($events | Where-Object { $_.id -eq 1 -and $_.parentId -eq $owner.processId -and $_.time -ge $owner.time -and $_.image -imatch '(?:^|\\)powershell\.exe$' })
    if ($children.Count -ne 1) { return @{state='HARNESS_OBSERVED'; child=if($children.Count -eq 0){'NOT_OBSERVED'}else{'AMBIGUOUS'}; startMs=$null; stopMs=$null} }
    $child = $children[0]
    $kind = if ($child.image -imatch '\\SysWOW64\\') { 'WOW64' } elseif ($child.image -imatch '\\System32\\') { 'NATIVE_PATH' } else { 'ARCH_UNKNOWN' }
    $end = $events | Where-Object { $_.id -eq 2 -and $_.processId -eq $child.processId -and $_.time -ge $child.time } | Select-Object -First 1
    return @{state='HARNESS_OBSERVED'; child=$kind; startMs=[int]($child.time - $owner.time).TotalMilliseconds; stopMs=if($end){[int]($end.time - $owner.time).TotalMilliseconds}else{$null} }
}

$file = Join-Path $env:RUNNER_TEMP ('cmspark-nsis-observe-' + [Guid]::NewGuid().ToString('N') + '.etl')
$session = 'CmsparkNsis' + [Guid]::NewGuid().ToString('N')
$logman = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)) 'System32\logman.exe'
$record = $false
try {
    if ($Mode -ceq 'native') { [IO.File]::WriteAllBytes($source, [Text.Encoding]::UTF8.GetBytes($original.Replace($redirected, $native))) }
    & $logman start $session -ets -o $file -p Microsoft-Windows-Kernel-Process 0x10 5 *> $null
    $record = $LASTEXITCODE -eq 0
    "NSIS_MODE=$Mode TRACE_STARTED=$record"
    & scripts/tests/win-installer-stop-smoke.ps1
    if ($LASTEXITCODE -ne 0) { throw 'STOP_SMOKE_EXIT' }
} finally {
    if ($Mode -ceq 'native') { [IO.File]::WriteAllBytes($source,$bytes) }
    if ($record) { & $logman stop $session -ets *> $null }
    if (Test-Path -LiteralPath $file) {
        try { 'NSIS_PROCESS ' + (Get-ObservedLaunch $file | ConvertTo-Json -Compress) }
        catch { 'NSIS_PROCESS {"state":"TRACE_UNAVAILABLE","child":"UNKNOWN"}' }
        finally { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
    }
}
