# Test-owned #650 cold discovery experiment only; original A/B and production stay unchanged.
param([Parameter(Mandatory=$true)][string]$InputPath)
$ErrorActionPreference = 'Stop'
try {
  # All setup is .NET/language-only: no import, command discovery, warmup or module enumeration.
  $original = [IO.Path]::Combine($PSScriptRoot, 'computer-bg-read-boundary-650.ps1')
  $modules = [IO.Path]::Combine($PSHOME, 'Modules')
  if (-not [IO.File]::Exists($original) -or -not [IO.Directory]::Exists($modules)) { throw 'OWNED_SCOPE_LAYOUT' }
  [Environment]::SetEnvironmentVariable('PSModulePath', $modules, [EnvironmentVariableTarget]::Process)
  $effective = [Environment]::GetEnvironmentVariable('PSModulePath', [EnvironmentVariableTarget]::Process)
  $entries = $effective.Split([char]59)
  if ($entries.Length -ne 1 -or -not [String]::Equals($entries[0], $modules, [StringComparison]::OrdinalIgnoreCase)) { throw 'OWNED_SCOPE_MISMATCH' }
} catch {
  # One fixed false marker only; never print exception, environment or path values.
  [Console]::Error.WriteLine('CMSPARK_MODULE_SCOPE_650:false')
  exit 1
}
[Console]::Error.WriteLine('CMSPARK_MODULE_SCOPE_650:true')
& $original -InputPath $InputPath
exit $LASTEXITCODE
