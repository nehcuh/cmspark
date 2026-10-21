# #732 only canonical native test setup; initialize NEW owned objects, never repair paths.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$result = 'UNKNOWN'
try {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { '"REFUSED"'; exit 0 }
  if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows' -or $args.Count -ne 5 -or ($args[4] -cne 'root' -and $args[4] -cne 'empty')) { throw 'invalid' }
  . (Join-Path $PSScriptRoot 'acp-history-private-native.ps1')
  $result = [CMsparkHistoryPrivate732]::Fixture($args[0], $args[1], $args[2], $args[3], ($args[4] -ceq 'empty'))
} catch { $result = 'UNKNOWN' }
if ($result -cne 'INITIALIZED' -and $result -cne 'REFUSED') { $result = 'UNKNOWN' }
[Console]::Out.Write(('"' + $result + '"'))
