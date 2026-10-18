param([ValidateSet('create','cleanup','check')][string]$Mode,[Guid]$Id,[string]$Directory)
# REGISTRY644_PASSIVE_PHASE_BEGIN
$script:registryPhaseSequence644=0
$script:registryPhaseClock644=$null
if ($Mode -eq 'create') { try { $script:registryPhaseClock644=[Diagnostics.Stopwatch]::StartNew() } catch {} }
function Write-RegistryPhase644 {
 param([string]$Stage)
 try {
  if ($Mode -ne 'create' -or $Stage -cnotin @('ENTERED','OWNER_VERIFIED','ADD_TYPE_ENTERED','ADD_TYPE_RETURNED','VALUES_READY','REGISTRY_ENTERED','REGISTRY_COMPLETE','COMPLETE') -or $script:registryPhaseSequence644 -ge 8) { return }
  $script:registryPhaseSequence644++
  $elapsed='null'
  try { if ($null -ne $script:registryPhaseClock644) { $value=$script:registryPhaseClock644.ElapsedMilliseconds;if ($value -ge 0 -and $value -le 90000) { $elapsed=$value.ToString([Globalization.CultureInfo]::InvariantCulture) } } } catch {}
  [Console]::Error.WriteLine(('REGISTRY644_FIXTURE_PHASE {"schema":1,"mode":"create","sequence":'+$script:registryPhaseSequence644.ToString([Globalization.CultureInfo]::InvariantCulture)+',"stage":"'+$Stage+'","elapsed_ms":'+$elapsed+'}'))
 } catch { # Passive failure must never replace the original fixture operation.
 }
}
Write-RegistryPhase644 'ENTERED'
# REGISTRY644_PASSIVE_PHASE_END
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='Stop'
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or $PSVersionTable.PSEdition -ne 'Desktop') { throw 'OWNED_REQUIRES_NATIVE_PS51' }
$owner=$Id.ToString('D')
if ($Id -eq [Guid]::Empty -or (Microsoft.PowerShell.Management\Get-Content -LiteralPath (Microsoft.PowerShell.Management\Join-Path $Directory '.owner') -Raw) -ne $owner) { throw 'OWNED_DIRECTORY_IDENTITY_REQUIRED' }
Write-RegistryPhase644 'OWNER_VERIFIED'
$prefix='CMsparkOwned644_'+$owner+'_'
$uninstall='SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
$ledgerPath=Microsoft.PowerShell.Management\Join-Path $Directory 'registry-ledger.json'
Write-RegistryPhase644 'ADD_TYPE_ENTERED'
Microsoft.PowerShell.Utility\Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class RegistryOwned644 {
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,EntryPoint="RegCreateKeyExW")]
 public static extern int Create(IntPtr hive,string name,uint reserved,string cls,uint options,uint rights,IntPtr security,out SafeRegistryHandle key,out uint disposition);
}
'@ | Out-Null
Write-RegistryPhase644 'ADD_TYPE_RETURNED'
$created=Microsoft.PowerShell.Utility\New-Object System.Collections.Generic.List[object]
$views=@([Microsoft.Win32.RegistryView]::Registry32)
if ([Environment]::Is64BitOperatingSystem) { $views=@([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32) }
function Save-OwnedLedger { [IO.File]::WriteAllText($ledgerPath,(Microsoft.PowerShell.Utility\ConvertTo-Json -Compress -InputObject @{entries=$created.ToArray()}),([Text.UTF8Encoding]::new($false))) }
function Remove-OwnedKeys {
 if (!(Microsoft.PowerShell.Management\Test-Path -LiteralPath $ledgerPath)) { return }
 $saved=Microsoft.PowerShell.Utility\ConvertFrom-Json ([IO.File]::ReadAllText($ledgerPath))
 foreach ($entry in $saved.entries) {
  if ($entry.name -notmatch ('^'+[regex]::Escape($prefix)+'(?:good|unquoted|reparse|dll|icon|folder|missing|args|env|relative|long)_(?:32|64)$') -or ($entry.view -ne 32 -and $entry.view -ne 64)) { throw 'OWNED_LEDGER_INVALID' }
  $view=[Microsoft.Win32.RegistryView]::Registry32;if ($entry.view -eq 64) { $view=[Microsoft.Win32.RegistryView]::Registry64 }
  $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$view)
  $parent=$null;$key=$null
  try {
   $parent=$base.OpenSubKey($uninstall,$true)
   if ($null -eq $parent) { continue }
   $key=$parent.OpenSubKey([string]$entry.name,$false)
   if ($null -eq $key) { continue }
   if ($key.GetValue('CMsparkFixtureOwner') -ne $owner) { throw 'OWNED_KEY_IDENTITY_REFUSED' }
   $key.Dispose();$key=$null
   if ($Mode -eq 'check') { throw 'OWNED_KEY_STILL_PRESENT' }
   $parent.DeleteSubKeyTree([string]$entry.name,$false) # Exact owned child, never Uninstall root.
  } finally { if ($null -ne $key) { $key.Dispose() };if ($null -ne $parent) { $parent.Dispose() };$base.Dispose() }
 }
}
if ($Mode -eq 'cleanup' -or $Mode -eq 'check') { Remove-OwnedKeys;Microsoft.PowerShell.Utility\Write-Output '{"cleanup":true,"native_ps51":true}';exit 0 }
$items=Microsoft.PowerShell.Utility\ConvertFrom-Json ([IO.File]::ReadAllText((Microsoft.PowerShell.Management\Join-Path $Directory 'values.json')))
Write-RegistryPhase644 'VALUES_READY'
Write-RegistryPhase644 'REGISTRY_ENTERED'
try {
 foreach ($view in $views) {
  $tag=32;$flag=0x200;if ($view -eq [Microsoft.Win32.RegistryView]::Registry64) { $tag=64;$flag=0x100 }
  $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$view)
  $parent=$null
  try {
   $parent=$base.OpenSubKey($uninstall,$true)
   if ($null -eq $parent) { throw 'OWNED_EXISTING_UNINSTALL_ROOT_REQUIRED' }
  foreach ($item in $items) {
   if ($item.kind -notmatch '^(good|unquoted|reparse|dll|icon|folder|missing|args|env|relative|long)$') { throw 'OWNED_CASE_INVALID' }
   $name=$prefix+$item.kind+'_'+$tag;$handle=$null;$key=$null;$disp=[uint32]0
   try {
    $rc=[RegistryOwned644]::Create($parent.Handle.DangerousGetHandle(),$name,0,$null,0,(0x2001b -bor $flag),[IntPtr]::Zero,[ref]$handle,[ref]$disp)
    if ($rc -ne 0) { throw 'OWNED_CREATE_FAILED' }
    if ($disp -ne 1) { throw 'OWNED_CREATE_COLLISION' } # Atomic disposition, no existence-check overwrite race.
    $key=[Microsoft.Win32.RegistryKey]::FromHandle($handle,$view)
    $key.SetValue('CMsparkFixtureOwner',$owner,[Microsoft.Win32.RegistryValueKind]::String)
    $created.Add(@{name=$name;view=$tag});Save-OwnedLedger
    $key.SetValue('DisplayName',('Owned644_'+$owner+'_'+$item.kind),[Microsoft.Win32.RegistryValueKind]::String)
    $key.SetValue('DisplayIcon',[string]$item.value,[Microsoft.Win32.RegistryValueKind]::String)
    $key.SetValue('UninstallString','THIS_INERT_COMMAND_MUST_NEVER_EXECUTE',[Microsoft.Win32.RegistryValueKind]::String)
    $key.SetValue('InstallLocation','THIS_DIRECTORY_MUST_NEVER_BE_SCANNED',[Microsoft.Win32.RegistryValueKind]::String)
   } finally { if ($null -ne $key) { $key.Dispose() };if ($null -ne $handle) { $handle.Dispose() } }
  }
  } finally { if ($null -ne $parent) { $parent.Dispose() };$base.Dispose() }
 }
 Write-RegistryPhase644 'REGISTRY_COMPLETE'
 Microsoft.PowerShell.Utility\Write-Output (Microsoft.PowerShell.Utility\ConvertTo-Json -Compress -InputObject @{created=$created.Count;native_ps51=$true;logical_views=$views.Count})
 Write-RegistryPhase644 'COMPLETE'
} catch { Remove-OwnedKeys;throw }
