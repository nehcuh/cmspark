# Fixed read-only #732 gate. Args are literal owned paths, never code/SDDL.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Explicit CI-only supplementary observation; never changes the read-only gate.
$diagnostic = $false
$paths = $args
if ($args.Count -gt 0 -and $args[0] -ceq '--diagnostic-732') {
  if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows') {
    [Console]::Out.Write('"UNKNOWN"')
    return
  }
  $diagnostic = $true
  $paths = @()
  if ($args.Count -gt 1) { $paths = @($args[1..($args.Count - 1)]) }
}
$reason = 'IO_UNKNOWN'
$pathIndex = $null
$currentPathIndex = 0
$answer = 'UNKNOWN'
try {
  if ($paths.Count -lt 1 -or $paths.Count -gt 2) { $reason = 'PATHARGS'; throw 'invalid' }
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($null -eq $sid) { throw 'unknown' }
  $allowed = @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')
  $answer = 'PRIVATE'
  $reason = 'NONE'
  foreach ($literal in $paths) {
    $pathIndex = $currentPathIndex
    $currentPathIndex++
    $item = Get-Item -LiteralPath $literal -Force -ErrorAction Stop
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { $reason = 'REPARSE'; $answer = 'REFUSED'; break }
    $acl = Get-Acl -LiteralPath $literal -ErrorAction Stop
    if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { $reason = 'OWNER'; $answer = 'REFUSED'; break }
    $raw = [System.Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
    if (($raw.ControlFlags -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclPresent) -eq 0 -or $null -eq $raw.DiscretionaryAcl) { $reason = 'DACL'; $answer = 'REFUSED'; break }
    foreach ($ace in $raw.DiscretionaryAcl) {
      # No callback/conditional/object/unknown ACE interpretation or deny cancellation.
      if ($ace -isnot [System.Security.AccessControl.CommonAce] -or $ace.IsCallback) { $reason = 'ACE_TYPE'; $answer = 'UNKNOWN'; break }
      if ($ace.AceQualifier -eq [System.Security.AccessControl.AceQualifier]::AccessAllowed) {
        if ($allowed -notcontains $ace.SecurityIdentifier.Value) { $reason = 'ACE_PRINCIPAL'; $answer = 'REFUSED'; break }
      } elseif ($ace.AceQualifier -ne [System.Security.AccessControl.AceQualifier]::AccessDenied) { $reason = 'ACE_QUALIFIER'; $answer = 'UNKNOWN'; break }
    }
    if ($answer -ne 'PRIVATE') { break }
  }
} catch { if ($reason -ne 'PATHARGS') { $reason = 'IO_UNKNOWN' }; $answer = 'UNKNOWN' }
# Only a finite JSON string; no path, SID, SDDL or exception text crosses this boundary.
if ($diagnostic) {
  if ($answer -eq 'PRIVATE') { $reason = 'NONE'; $pathIndex = $null }
  $result = [ordered]@{ status = $answer; reason = $reason; pathIndex = $pathIndex }
  [Console]::Out.Write(($result | ConvertTo-Json -Compress))
} else {
  [Console]::Out.Write(('"' + $answer + '"'))
}
