# Test-owned #650 diagnostic only. Never used as a replacement for the production comparator.
# Exactly one owned inert file; no UI, native compilation, environment change or module import.
param([Parameter(Mandatory=$true)][string]$InputPath, [switch]$QualifiedLookup)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$script:clock650 = [Diagnostics.Stopwatch]::StartNew()
$script:count650 = 0
$script:stage650 = 'ENTERED'
function Mark-ReadBoundary650([string]$phase) {
  if ($script:count650 -ge 8 -or @('ENTERED','DIRECT_READ_ENTERED','DIRECT_READ_RETURNED','DISCOVERY_ENTERED','DISCOVERY_RETURNED','CMDLET_READ_ENTERED','CMDLET_READ_RETURNED','COMPLETE') -notcontains $phase) { throw 'FIXED_PHASE_INVALID' }
  $script:stage650 = $phase
  [Console]::Error.WriteLine("CMSPARK_READ_BOUNDARY_650:${phase}:$($script:clock650.ElapsedMilliseconds)")
  $script:count650++
}
try {
  Mark-ReadBoundary650 'ENTERED'
  # All four are observations only. A false layout/mode fact is not a diagnosis.
  $windowsPs51 = ($PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSEdition -eq 'Desktop')
  $modules = [IO.Path]::Combine($PSHOME, 'Modules')
  $modulesExists = [IO.Directory]::Exists($modules)
  $containsModules = $false
  foreach ($entry in ([string]$env:PSModulePath -split ';')) {
    if ([String]::Equals($entry.TrimEnd([char[]]'\/'), $modules.TrimEnd([char[]]'\/'), [StringComparison]::OrdinalIgnoreCase)) { $containsModules = $true }
  }
  $fullLanguage = ($ExecutionContext.SessionState.LanguageMode -eq [System.Management.Automation.PSLanguageMode]::FullLanguage)
  [Console]::Error.WriteLine([string]::Format([Globalization.CultureInfo]::InvariantCulture,
    'CMSPARK_READ_PREFLIGHT_650:{{"windows_ps51":{0},"pshome_modules_exists":{1},"psmodulepath_contains_pshome_modules":{2},"full_language":{3}}}',
    [object[]]@($windowsPs51.ToString().ToLowerInvariant(), $modulesExists.ToString().ToLowerInvariant(), $containsModules.ToString().ToLowerInvariant(), $fullLanguage.ToString().ToLowerInvariant())))
  $expected = 'CMSPARK_650_OWNED_READ_V1'
  Mark-ReadBoundary650 'DIRECT_READ_ENTERED'
  $direct = [IO.File]::ReadAllText($InputPath, [Text.Encoding]::UTF8)
  Mark-ReadBoundary650 'DIRECT_READ_RETURNED'
  if ($direct -cne $expected) { [Console]::Error.WriteLine('CMSPARK_READ_FAILURE_650:CONTENT'); exit 1 }
  $lookupName = if ($QualifiedLookup) { 'Microsoft.PowerShell.Management\Get-Content' } else { 'Get-Content' }
  Mark-ReadBoundary650 'DISCOVERY_ENTERED'
  $command = $ExecutionContext.InvokeCommand.GetCommand($lookupName, [System.Management.Automation.CommandTypes]::Cmdlet)
  Mark-ReadBoundary650 'DISCOVERY_RETURNED'
  if ($null -eq $command -or $command.Name -cne 'Get-Content' -or $command.ModuleName -cne 'Microsoft.PowerShell.Management' -or $command.CommandType -ne [System.Management.Automation.CommandTypes]::Cmdlet) {
    [Console]::Error.WriteLine('CMSPARK_READ_FAILURE_650:COMMAND_IDENTITY'); exit 1
  }
  Mark-ReadBoundary650 'CMDLET_READ_ENTERED'
  $value = & $command -Raw $InputPath
  Mark-ReadBoundary650 'CMDLET_READ_RETURNED'
  if ($value -cne $expected) { [Console]::Error.WriteLine('CMSPARK_READ_FAILURE_650:CONTENT'); exit 1 }
  Mark-ReadBoundary650 'COMPLETE'
  [Console]::Out.WriteLine('{"version":1,"direct_read_match":true,"command_match":true,"cmdlet_read_match":true}')
  exit 0
} catch {
  # Deliberately no Exception.Message / module path / file content / environment values.
  [Console]::Error.WriteLine("CMSPARK_READ_FAILURE_650:EXCEPTION:$script:stage650")
  exit 1
}
