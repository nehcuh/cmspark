param(
  [Parameter(Mandatory=$true)][string]$ArchivePath,
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [Parameter(Mandatory=$true)][string]$EntryName,
  [Parameter(Mandatory=$true)][string]$PackageSHA256
)
# HostedWindows evidence only. No application is executed; no whole extraction.
# Clock-independent fixed observation; no source path, parameter or error text.
[Console]::Error.WriteLine('GALLERY70_BODY_ENTERED=1')
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { throw 'PS51_REQUIRED' }
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') { throw 'HOSTED_WINDOWS_ONLY' }
if (@('notepad++.exe','Code.exe') -cnotcontains $EntryName -or $PackageSHA256 -cnotmatch '^[a-f0-9]{64}$') { throw 'UNPINNED_ENTRY' }
if ([IO.Path]::GetFileName($OutputPath) -cne $EntryName -or [IO.Path]::GetDirectoryName($ArchivePath) -cne [IO.Path]::GetDirectoryName($OutputPath)) { throw 'OWNED_PATH_REQUIRED' }
# Only fixed built-in modules are needed. Avoid an all-module command search
# before bounded native signature sampling; no profile/import warm-up or retry.
$phaseClock = [Diagnostics.Stopwatch]::StartNew()
[Console]::Error.WriteLine('GALLERY70_PHASE=ENTERED:' + $phaseClock.ElapsedMilliseconds)
# Resolve one fixed framework assembly by its complete identity, without a
# PowerShell cmdlet/module-discovery round trip or an assembly path override.
$compressionIdentity = 'System.IO.Compression, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089'
$compressionAssembly = [Reflection.Assembly]::Load($compressionIdentity)
if ($compressionAssembly.FullName -cne $compressionIdentity -or -not [object]::ReferenceEquals($compressionAssembly.GetType('System.IO.Compression.ZipArchive', $true).Assembly, $compressionAssembly)) { throw 'COMPRESSION_ASSEMBLY_REJECTED' }
[Console]::Error.WriteLine('GALLERY70_PHASE=ASSEMBLY_READY:' + $phaseClock.ElapsedMilliseconds)
$archive = $zip = $entryStream = $output = $held = $reader = $hash = $null
try {
  # Hash and read the SAME no-write/no-delete file handle.
  $archive = [IO.File]::Open($ArchivePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  if ($archive.Length -le 0 -or $archive.Length -gt 402653184) { throw 'ARCHIVE_LIMIT' }
  $hash = [Security.Cryptography.SHA256]::Create()
  $packageHash = ([BitConverter]::ToString($hash.ComputeHash($archive))).Replace('-','').ToLowerInvariant()
  if ($packageHash -cne $PackageSHA256) { throw 'PACKAGE_SHA_MISMATCH' }
  [Console]::Error.WriteLine('GALLERY70_PHASE=ARCHIVE_VERIFIED:' + $phaseClock.ElapsedMilliseconds)
  $archive.Position = 0
  $zip = [IO.Compression.ZipArchive]::new($archive, [IO.Compression.ZipArchiveMode]::Read, $true)
  [Console]::Error.WriteLine('GALLERY70_PHASE=ZIP_OPENED:' + $phaseClock.ElapsedMilliseconds)
  # A language loop and a CLR array keep extraction free of command lookup.
  # Still count every exact-case match; duplicate names must never pick a winner.
  $entry = $null
  [int]$matchCount = 0
  foreach ($candidate in $zip.Entries) {
    if ($candidate.FullName -ceq $EntryName) { $entry = $candidate; $matchCount++ }
  }
  if ($matchCount -ne 1) { throw 'EXACT_ONE_ENTRY_REQUIRED' }
  $unixType = ($entry.ExternalAttributes -shr 16) -band 61440
  if ($unixType -eq 40960 -or $unixType -eq 16384 -or ($entry.ExternalAttributes -band 1024) -ne 0 -or $entry.Length -le 0 -or $entry.Length -gt 268435456) { throw 'ENTRY_REJECTED' }
  [Console]::Error.WriteLine('GALLERY70_PHASE=ENTRY_SELECTED:' + $phaseClock.ElapsedMilliseconds)
  $entryStream = $entry.Open()
  [Console]::Error.WriteLine('GALLERY70_PHASE=ENTRY_OPENED:' + $phaseClock.ElapsedMilliseconds)
  $output = [IO.File]::Open($OutputPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  [Console]::Error.WriteLine('GALLERY70_PHASE=OUTPUT_OPENED:' + $phaseClock.ElapsedMilliseconds)
  $buffer = [byte[]]::new(65536)
  [Console]::Error.WriteLine('GALLERY70_PHASE=BUFFER_READY:' + $phaseClock.ElapsedMilliseconds)
  [long]$written = 0
  while (($count = $entryStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
    $written += $count
    if ($written -gt 268435456) { throw 'ENTRY_LIMIT' }
    $output.Write($buffer, 0, $count)
  }
  if ($written -ne $entry.Length) { throw 'ENTRY_LENGTH_MISMATCH' }
  $output.Dispose(); $output = $null
  [Console]::Error.WriteLine('GALLERY70_PHASE=ENTRY_WRITTEN:' + $phaseClock.ElapsedMilliseconds)
  $held = [IO.File]::Open($OutputPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  $reader = [IO.BinaryReader]::new($held, [Text.Encoding]::UTF8, $true)
  if ($held.Length -lt 64 -or $reader.ReadUInt16() -ne 23117) { throw 'PE_REJECTED' }
  $held.Position = 60
  $peOffset = $reader.ReadInt32()
  if ($peOffset -lt 64 -or $peOffset -gt ($held.Length - 6)) { throw 'PE_REJECTED' }
  $held.Position = $peOffset
  if ($reader.ReadUInt32() -ne 17744 -or $reader.ReadUInt16() -ne 34404) { throw 'X64_REQUIRED' }
  $held.Position = 0
  $exeHash = ([BitConverter]::ToString($hash.ComputeHash($held))).Replace('-','').ToLowerInvariant()
  $fileVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($OutputPath).FileVersion
  [Console]::Error.WriteLine('GALLERY70_PHASE=EXE_VERIFIED:' + $phaseClock.ElapsedMilliseconds)
  [Console]::Error.WriteLine('GALLERY70_PHASE=SIGNATURE_ENTERED:' + $phaseClock.ElapsedMilliseconds)
  $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $OutputPath
  [Console]::Error.WriteLine('GALLERY70_PHASE=SIGNATURE_RETURNED:' + $phaseClock.ElapsedMilliseconds)
  if ($signature.Status.ToString() -cne 'Valid' -or $null -eq $signature.SignerCertificate) { throw 'SIGNATURE_NOT_VALID' }
  $certificateHash = ([BitConverter]::ToString($hash.ComputeHash($signature.SignerCertificate.RawData))).Replace('-','').ToLowerInvariant()
  [ordered]@{entry=$EntryName; exeBytes=$written; exeSHA256=$exeHash; signatureStatus=$signature.Status.ToString(); certificateSHA256DER=$certificateHash; subject=$signature.SignerCertificate.Subject; collectedAtUTC=[DateTime]::UtcNow.ToString('o'); psVersion=$PSVersionTable.PSVersion.ToString(); machine='x64'; fileVersion=$fileVersion} | Microsoft.PowerShell.Utility\ConvertTo-Json -Compress
  [Console]::Error.WriteLine('GALLERY70_PHASE=COMPLETE:' + $phaseClock.ElapsedMilliseconds)
} finally {
  foreach ($resource in @($reader,$held,$output,$entryStream,$zip,$archive,$hash)) { if ($null -ne $resource) { $resource.Dispose() } }
}
