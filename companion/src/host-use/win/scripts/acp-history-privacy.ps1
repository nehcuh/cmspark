# Fixed read-only #732 gate. Args are literal owned paths, never code/SDDL.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$answer = 'UNKNOWN'
try {
  if ($args.Count -lt 1 -or $args.Count -gt 2) { throw 'invalid' }
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($null -eq $sid) { throw 'unknown' }
  $allowed = @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')
  $answer = 'PRIVATE'
  foreach ($literal in $args) {
    $item = Get-Item -LiteralPath $literal -Force -ErrorAction Stop
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { $answer = 'REFUSED'; break }
    $acl = Get-Acl -LiteralPath $literal -ErrorAction Stop
    if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { $answer = 'REFUSED'; break }
    $raw = [System.Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
    if (($raw.ControlFlags -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclPresent) -eq 0 -or $null -eq $raw.DiscretionaryAcl) { $answer = 'REFUSED'; break }
    foreach ($ace in $raw.DiscretionaryAcl) {
      # No callback/conditional/object/unknown ACE interpretation or deny cancellation.
      if ($ace -isnot [System.Security.AccessControl.CommonAce] -or $ace.IsCallback) { $answer = 'UNKNOWN'; break }
      if ($ace.AceQualifier -eq [System.Security.AccessControl.AceQualifier]::AccessAllowed) {
        if ($allowed -notcontains $ace.SecurityIdentifier.Value) { $answer = 'REFUSED'; break }
      } elseif ($ace.AceQualifier -ne [System.Security.AccessControl.AceQualifier]::AccessDenied) { $answer = 'UNKNOWN'; break }
    }
    if ($answer -ne 'PRIVATE') { break }
  }
} catch { $answer = 'UNKNOWN' }
# Only a finite JSON string; no path, SID, SDDL or exception text crosses this boundary.
[Console]::Out.Write(('"' + $answer + '"'))
