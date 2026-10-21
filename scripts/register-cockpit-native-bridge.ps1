# One fixed per-user Chrome native host. No wildcard discovery, HKLM, process
# launch or unrelated host/config cleanup. Run only for an admitted install.
param(
  [Parameter(Mandatory=$true)][string]$InstallRoot,
  [string]$ExtensionId = '',
  [ValidateSet('Registry64', 'Registry32')][string]$RegistryView = 'Registry64',
  [switch]$Unregister
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$hostName = 'com.cmspark.cockpit'
$subkey = 'Software\Google\Chrome\NativeMessagingHosts\' + $hostName
$utf8 = [Text.UTF8Encoding]::new($false, $true)
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or -not [IO.Path]::IsPathRooted($InstallRoot)) { throw 'COCKPIT_BRIDGE_REGISTRATION_PLATFORM' }
if (-not $Unregister -and $ExtensionId -cnotmatch '^[a-p]{32}$') { throw 'COCKPIT_BRIDGE_EXACT_ID_REQUIRED' }
$root = (Get-Item -LiteralPath $InstallRoot).FullName
if (-not (Get-Item -LiteralPath $root).PSIsContainer -or ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'COCKPIT_BRIDGE_REGISTRATION_ROOT' }
$binary = Join-Path $root 'bin\cmspark-cockpit-bridge.exe'
$pin = Join-Path $root 'bin\cmspark-cockpit-bridge.sha256'
$directory = Join-Path $root 'native-messaging'
$manifestPath = Join-Path $directory ($hostName + '.json')
$recordPath = Join-Path $directory 'registration.json'
$record = $null

function Read-RegularText([string]$Path) {
  $item = Get-Item -LiteralPath $Path
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 4096) { throw 'COCKPIT_BRIDGE_REGISTRATION_FILE' }
  return $utf8.GetString([IO.File]::ReadAllBytes($item.FullName))
}
function Read-OwnedRecord {
  $text = Read-RegularText $recordPath
  $r = ConvertFrom-Json -InputObject $text
  $names = @($r.PSObject.Properties.Name | Sort-Object)
  $expected = @('extensionId', 'hostPath', 'hostSha256', 'installId', 'manifestPath', 'manifestSha256', 'registryView', 'v')
  if (($names -join ',') -cne ($expected -join ',') -or $r.v -ne 1 -or $r.installId -cnotmatch '^[0-9a-f]{32}$' -or
      $r.extensionId -cnotmatch '^[a-p]{32}$' -or $r.hostSha256 -cnotmatch '^[0-9a-f]{64}$' -or $r.manifestSha256 -cnotmatch '^[0-9a-f]{64}$' -or
      $r.hostPath -cne $binary -or $r.manifestPath -cne $manifestPath -or $r.registryView -cne $RegistryView) { throw 'COCKPIT_BRIDGE_REGISTRATION_CONFLICT' }
  # Own producer is canonical flat JSON; duplicate keys/foreign formatting do
  # not silently become an ownership receipt through ConvertFrom-Json.
  if (($r | ConvertTo-Json -Compress) + "`n" -cne $text) { throw 'COCKPIT_BRIDGE_REGISTRATION_CONFLICT' }
  $manifest = Read-RegularText $manifestPath
  $hash = [Security.Cryptography.SHA256]::Create()
  try { $digest = ([BitConverter]::ToString($hash.ComputeHash($utf8.GetBytes($manifest)))).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
  if ($digest -cne $r.manifestSha256) { throw 'COCKPIT_BRIDGE_REGISTRATION_CONFLICT' }
  $expectedManifest = [ordered]@{ name = $hostName; description = 'CMspark owned cockpit identity'; path = $binary; type = 'stdio'; allowed_origins = @('chrome-extension://' + $r.extensionId + '/') } | ConvertTo-Json -Compress
  if ($manifest -cne ($expectedManifest + "`n")) { throw 'COCKPIT_BRIDGE_REGISTRATION_CONFLICT' }
  return $r
}

if (Test-Path -LiteralPath $directory) {
  $item = Get-Item -LiteralPath $directory
  if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'COCKPIT_BRIDGE_REGISTRATION_CONFLICT' }
  if (Test-Path -LiteralPath $recordPath) { $record = Read-OwnedRecord }
  elseif (@(Get-ChildItem -LiteralPath $directory -Force).Count -ne 0) { throw 'COCKPIT_BRIDGE_REGISTRATION_CONFLICT' }
}

$bases = @{}
try {
  foreach ($view in @('Registry32', 'Registry64')) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::$view)
    $bases[$view] = $base
    $key = $base.OpenSubKey($subkey, $false)
    if ($null -ne $key) {
      try {
        if ($null -eq $record -or $key.GetValueKind('') -ne [Microsoft.Win32.RegistryValueKind]::String -or $key.GetValue('') -cne $manifestPath -or
            @($key.GetSubKeyNames()).Count -ne 0 -or @($key.GetValueNames()).Count -ne 1 -or $key.GetValueNames()[0] -cne '') { throw 'COCKPIT_BRIDGE_REGISTRATION_CONFLICT' }
      } finally { $key.Dispose() }
    }
  }
  if ($Unregister) {
    if ($null -eq $record) { throw 'COCKPIT_BRIDGE_REGISTRATION_NOT_OWNED' }
    if ($ExtensionId -and $ExtensionId -cne $record.extensionId) { throw 'COCKPIT_BRIDGE_REGISTRATION_CONFLICT' }
    $key = $bases[$RegistryView].OpenSubKey($subkey, $false)
    if ($null -ne $key) {
      try { if ($key.GetValue('') -cne $manifestPath) { throw 'COCKPIT_BRIDGE_REGISTRATION_CONFLICT' } } finally { $key.Dispose() }
      $bases[$RegistryView].DeleteSubKey($subkey, $false)
    }
    # Re-read exact owned bytes immediately before deleting only these files.
    $null = Read-OwnedRecord
    [IO.File]::Delete($manifestPath); [IO.File]::Delete($recordPath)
    if (@(Get-ChildItem -LiteralPath $directory -Force).Count -eq 0) { [IO.Directory]::Delete($directory) }
    Write-Output 'COCKPIT_BRIDGE_UNREGISTERED'
    return
  }
  $binaryItem = Get-Item -LiteralPath $binary
  if ($binaryItem.PSIsContainer -or ($binaryItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'COCKPIT_BRIDGE_REGISTRATION_BINARY' }
  $binaryHash = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()
  if ((Read-RegularText $pin) -cne ($binaryHash + "`n")) { throw 'COCKPIT_BRIDGE_REGISTRATION_BINARY' }
  if ($null -ne $record) {
    if ($record.extensionId -cne $ExtensionId) { throw 'COCKPIT_BRIDGE_REGISTRATION_EXPLICIT_UNBIND_REQUIRED' }
    if ($record.hostSha256 -cne $binaryHash) { throw 'COCKPIT_BRIDGE_REGISTRATION_BINARY' }
    $key = $bases[$RegistryView].OpenSubKey($subkey, $false)
    try { if ($null -eq $key -or $key.GetValue('') -cne $manifestPath) { throw 'COCKPIT_BRIDGE_REGISTRATION_CONFLICT' } } finally { if ($null -ne $key) { $key.Dispose() } }
    Write-Output 'COCKPIT_BRIDGE_ALREADY_REGISTERED'
    return
  }
  if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory | Out-Null }
  $manifest = ([ordered]@{ name = $hostName; description = 'CMspark owned cockpit identity'; path = $binary; type = 'stdio'; allowed_origins = @('chrome-extension://' + $ExtensionId + '/') } | ConvertTo-Json -Compress) + "`n"
  $hash = [Security.Cryptography.SHA256]::Create()
  try { $manifestHash = ([BitConverter]::ToString($hash.ComputeHash($utf8.GetBytes($manifest)))).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
  $newRecord = ([ordered]@{ v = 1; installId = [guid]::NewGuid().ToString('N'); extensionId = $ExtensionId; hostPath = $binary; hostSha256 = $binaryHash; manifestPath = $manifestPath; manifestSha256 = $manifestHash; registryView = $RegistryView } | ConvertTo-Json -Compress) + "`n"
  # Exclusive creation; never overwrite an existing record or manifest.
  foreach ($entry in @(@($manifestPath, $manifest), @($recordPath, $newRecord))) {
    $file = [IO.File]::Open($entry[0], [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $bytes = $utf8.GetBytes($entry[1]); $file.Write($bytes, 0, $bytes.Length); $file.Flush($true) } finally { $file.Dispose() }
  }
  $key = $bases[$RegistryView].CreateSubKey($subkey, $true)
  try {
    if (@($key.GetValueNames()).Count -ne 0 -or @($key.GetSubKeyNames()).Count -ne 0) { throw 'COCKPIT_BRIDGE_REGISTRATION_CONFLICT' }
    $key.SetValue('', $manifestPath, [Microsoft.Win32.RegistryValueKind]::String)
    if ($key.GetValue('') -cne $manifestPath) { throw 'COCKPIT_BRIDGE_REGISTRATION_FAILED' }
  } finally { $key.Dispose() }
  Write-Output 'COCKPIT_BRIDGE_REGISTERED'
} finally {
  foreach ($base in $bases.Values) { $base.Dispose() }
}
