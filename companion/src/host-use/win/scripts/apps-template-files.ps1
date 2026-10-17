# Fixed read-only admission metadata. No target content, executable or profile mutation.
param([Parameter(Mandatory=$true)][string]$ExePath, [Parameter(Mandatory=$true)][string]$FilePath)
$ErrorActionPreference = 'Stop'
function Assert-LocalChain([string]$LiteralPath, [bool]$OptionalLeaf = $false) {
    $root = [IO.Path]::GetPathRoot($LiteralPath)
    if ($root -notmatch '^[A-Za-z]:\\$') { throw 'TEMPLATE_LOCAL_DRIVE_REQUIRED' }
    $drive = New-Object IO.DriveInfo($root)
    if ([int]$drive.DriveType -notin @(2,3,5,6)) { throw 'TEMPLATE_LOCAL_DRIVE_REQUIRED' }
    $parts = $LiteralPath.Substring($root.Length).Split([char]92)
    $cursor = $root
    $rootAttributes = [IO.File]::GetAttributes($cursor)
    if (($rootAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'TEMPLATE_REPARSE_DENIED' }
    for ($i=0; $i -lt $parts.Length; $i++) {
        if ([string]::IsNullOrEmpty($parts[$i]) -or $parts[$i] -eq '.' -or $parts[$i] -eq '..') { throw 'TEMPLATE_PATH_REQUIRED' }
        $cursor = [IO.Path]::Combine($cursor, $parts[$i])
        try { $attributes = [IO.File]::GetAttributes($cursor) }
        catch [IO.FileNotFoundException] { if ($OptionalLeaf -and $i -eq $parts.Length-1) { return $false }; throw }
        catch [IO.DirectoryNotFoundException] { if ($OptionalLeaf -and $i -eq $parts.Length-1) { return $false }; throw }
        if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'TEMPLATE_REPARSE_DENIED' }
        if ($i -lt $parts.Length-1 -and ($attributes -band [IO.FileAttributes]::Directory) -eq 0) { throw 'TEMPLATE_DIRECTORY_REQUIRED' }
    }
    return $true
}
try {
    $null = Assert-LocalChain $ExePath
    $null = Assert-LocalChain $FilePath
    $folder = [IO.Path]::GetDirectoryName($ExePath)
    $null = Assert-LocalChain ([IO.Path]::Combine($folder,'doLocalConf.xml'))
    $null = Assert-LocalChain ([IO.Path]::Combine($folder,'config.xml'))
    $cloud = [IO.Path]::Combine($folder,'cloud')
    if (Assert-LocalChain $cloud $true) {
        if (Assert-LocalChain ([IO.Path]::Combine($cloud,'choice')) $true) { throw 'TEMPLATE_CLOUD_UNSUPPORTED' }
    }
    $roots = @([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles), [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)) | Where-Object { $_ } | Select-Object -Unique
    if (@($roots).Count -lt 1) { throw 'TEMPLATE_KNOWN_FOLDERS_REQUIRED' }
    @{ok=$true;programFiles=@($roots)} | ConvertTo-Json -Compress
} catch {
    # No exception text/path/profile/target body crosses this fixed outlet.
    [Console]::Error.WriteLine('TEMPLATE_LOCAL_PROFILE_UNSUPPORTED')
    exit 1
}
