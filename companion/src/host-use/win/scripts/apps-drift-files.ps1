# #689: fixed read-only locality/reparse admission of exactly one registered exe.
# No executable execution, content/hash, directory creation, scanner, or raw path output.
param([Parameter(Mandatory=$true)][string]$TargetPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
    $root = [IO.Path]::GetPathRoot($TargetPath)
    if ($root -notmatch '^[A-Za-z]:\\$') { throw 'LOCAL_DRIVE_REQUIRED' }
    $drive = New-Object IO.DriveInfo($root)
    if ([int]$drive.DriveType -notin @(2,3,5,6)) { throw 'LOCAL_DRIVE_REQUIRED' }
    $parts = $TargetPath.Substring($root.Length).Split([char]92)
    $cursor = $root
    $attributes = [IO.File]::GetAttributes($cursor)
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPARSE_DENIED' }
    for ($i = 0; $i -lt $parts.Length; $i++) {
        if ([string]::IsNullOrEmpty($parts[$i]) -or $parts[$i] -eq '.' -or $parts[$i] -eq '..') { throw 'PATH_REQUIRED' }
        $cursor = [IO.Path]::Combine($cursor, $parts[$i])
        $attributes = [IO.File]::GetAttributes($cursor)
        if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPARSE_DENIED' }
        if ($i -lt $parts.Length-1) {
            if (($attributes -band [IO.FileAttributes]::Directory) -eq 0) { throw 'DIRECTORY_REQUIRED' }
        } elseif (($attributes -band [IO.FileAttributes]::Directory) -ne 0) { throw 'FILE_REQUIRED' }
    }
    @{ok=$true} | ConvertTo-Json -Compress
} catch {
    [Console]::Error.WriteLine('APP_DRIFT_MEASUREMENT_FAILED')
    exit 1
}
