# #732 fixed commit-only operation: no existing root/history ACL remediation.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$result = 'UNKNOWN'
try {
  if ($args.Count -ne 6) { throw 'invalid' }
  . (Join-Path $PSScriptRoot 'acp-history-private-native.ps1')
  $result = [CMsparkHistoryPrivate732]::Initialize($args[0], $args[1], $args[2], $args[3], $args[4], $args[5])
} catch { $result = 'UNKNOWN' }
if ($result -cne 'INITIALIZED' -and $result -cne 'REFUSED') { $result = 'UNKNOWN' }
[Console]::Out.Write(('"' + $result + '"'))
