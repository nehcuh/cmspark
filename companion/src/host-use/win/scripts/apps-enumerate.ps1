# apps-enumerate.ps1 — enumerate add-app candidates for the App tab (WP2).
# Merges two sources (existing running/StartApps, plus #644 bounded Registry discovery):
#   (a) running GUI processes: Get-Process with a MainWindowTitle + resolvable .Path
#   (b) Get-StartApps: AppID containing "!" → UWP AUMID; otherwise treated as a
#       win32 path candidate and kept only when it resolves to an existing file.
#
# Contract (companion/src/host-use/win/powershell.ts):
#   exit 0 + single-line JSON on stdout:
#     {"apps":[{"name":"...","source":"running"|"startapps"|"registry","path":"...","aumid":"..."}]}
#   (exactly one of path/aumid per entry)
#   failure → non-zero exit + stderr message.
# The script takes NO argv input — nothing caller-controlled is interpolated.

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

# #644: fixed native read methods enforce limits BEFORE allocating metadata.
# Neither API mutates the Registry; the process still has one fixed zero-argv entry.
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
public sealed class AppsRegistryValue644 { public int Result; public string Text; }
public sealed class AppsRegistryName644 { public int Result; public string Name; }
public sealed class AppsRegistryNameOrder644 : System.Collections.IComparer {
  public int Compare(object x,object y) {
    int c=StringComparer.OrdinalIgnoreCase.Compare((string)x,(string)y);
    return c!=0 ? c : StringComparer.Ordinal.Compare((string)x,(string)y);
  }
}
public static class AppsRegistryReader644 {
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, EntryPoint="RegEnumKeyExW")]
  private static extern int EnumKey(IntPtr key,uint index,StringBuilder name,ref uint chars,IntPtr reserved,IntPtr cls,IntPtr clsChars,IntPtr stamp);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, EntryPoint="RegQueryValueExW")]
  private static extern int Query(IntPtr key,string name,IntPtr reserved,out uint kind,[Out] byte[] data,ref uint bytes);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, EntryPoint="GetDriveTypeW")]
  public static extern uint DriveType(string root);
  public delegate int NameReader(IntPtr key,uint index,StringBuilder name,ref uint chars,IntPtr reserved,IntPtr cls,IntPtr clsChars,IntPtr stamp);
  public static AppsRegistryName644 NameAt(IntPtr key,uint index) { return NameAtCore(key,index,EnumKey); }
  public static AppsRegistryName644 NameAtCore(IntPtr key,uint index,NameReader reader) {
    var b=new StringBuilder(256); uint n=256;
    int rc=reader(key,index,b,ref n,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
    if(rc==0 && n>255)rc=13;
    return new AppsRegistryName644 {Result=rc,Name=rc==0 ? b.ToString() : null};
  }
  public delegate int QueryReader(IntPtr key,string name,IntPtr reserved,out uint kind,byte[] data,ref uint bytes);
  public static AppsRegistryValue644 Value(IntPtr key,string name,uint cap) { return ValueCore(key,name,cap,Query); }
  // The production binding is fixed Query. The core permits bounded primitive
  // fault tests without changing process argv, Registry roots or production APIs.
  public static AppsRegistryValue644 ValueCore(IntPtr key,string name,uint cap,QueryReader reader) {
    if(cap>4096)return new AppsRegistryValue644 {Result=234};
    uint count=0,kind; int rc=reader(key,name,IntPtr.Zero,out kind,null,ref count);
    if(rc!=0)return new AppsRegistryValue644 {Result=rc};
    if(kind!=1 && kind!=2)return new AppsRegistryValue644 {Result=13};
    if(count>cap)return new AppsRegistryValue644 {Result=234};
    uint originalKind=kind,originalCount=count;
    var buffer=new byte[(int)cap]; count=cap;
    rc=reader(key,name,IntPtr.Zero,out kind,buffer,ref count);
    if(rc!=0)return new AppsRegistryValue644 {Result=rc};
    if(count>originalCount || count>cap)return new AppsRegistryValue644 {Result=234};
    if(kind!=originalKind || count%2!=0)return new AppsRegistryValue644 {Result=13};
    try {
      string s=new UnicodeEncoding(false,false,true).GetString(buffer,0,(int)count);
      if(s.EndsWith("\0",StringComparison.Ordinal))s=s.Substring(0,s.Length-1);
      if(s.IndexOf('\0')>=0)return new AppsRegistryValue644 {Result=13};
      return new AppsRegistryValue644 {Result=0,Text=s};
    } catch(DecoderFallbackException) {return new AppsRegistryValue644 {Result=13};}
  }
}
'@ | Out-Null

function Get-AppsJson644 {
  param([AllowEmptyCollection()][object[]]$Rows, [object]$Summary=$null)
  if ($null -eq $Rows) { $Rows=[object[]]@() }
  if ($null -eq $Summary) { return (ConvertTo-Json -Compress -InputObject @{apps=[object[]]$Rows}) }
  return (ConvertTo-Json -Compress -InputObject ([ordered]@{apps=[object[]]$Rows;registry_summary=$Summary}))
}
function Get-AppsWireBytes644 {
  param([string]$Json)
  # Count actual Console stdout bytes, not UTF-16 chars or an encoding's optional
  # preamble: .NET Framework Console.Out suppresses that preamble. The native
  # PS5.1 fixture verifies the raw prefix, encoding and emitted newline exactly.
  $writer=[Console]::Out
  return $writer.Encoding.GetByteCount($Json) + $writer.Encoding.GetByteCount($writer.NewLine)
}
function Get-RegistryExe644 {
  param([string]$Value)
  $none=@{path=$null;reason=$null}
  if ($null -eq $Value -or $Value -match '[\x00-\x1f\x7f]') { return $none }
  $v=$Value.Trim([char[]]' ')
  $literal=$null
  if ($v -match '^"(?<path>[^"]+)"(?:,[+-]?[0-9]{1,6})?$') { $literal=$Matches.path }
  elseif ($v -match '(?i)^(?<path>[A-Za-z]:\\[^\s"]+\.exe)(?:,[+-]?[0-9]{1,6})?$') { $literal=$Matches.path }
  if ($literal -and $literal.Length -gt 1024) { return @{path=$null;reason='VALUE_LIMIT'} }
  if (!$literal -or $literal -notmatch '^[A-Za-z]:\\' -or $literal -notmatch '(?i)\.exe$' -or
    $literal.Substring(2).Contains(':') -or $literal -match '[<>"/|?*]') { return $none }
  $parts=$literal.Substring(3).Split([char]'\')
  if ($parts -contains '.' -or $parts -contains '..' -or $parts -contains '') { return $none }
  try {
    $root=$literal.Substring(0,3)
    $drive=[AppsRegistryReader644]::DriveType($root)
    if ($drive -ne 2 -and $drive -ne 3 -and $drive -ne 5 -and $drive -ne 6) { return $none }
    $at=$root
    $attrs=[IO.File]::GetAttributes($at)
    if (($attrs -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $none }
    for ($i=0;$i -lt $parts.Length;$i++) {
      $at=[IO.Path]::Combine($at,$parts[$i]);$attrs=[IO.File]::GetAttributes($at)
      if (($attrs -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $none }
      if ($i -lt $parts.Length-1 -and ($attrs -band [IO.FileAttributes]::Directory) -eq 0) { return $none }
    }
    if (($attrs -band [IO.FileAttributes]::Directory) -ne 0 -or ($attrs -band [IO.FileAttributes]::Device) -ne 0) { return $none }
    return @{path=[IO.Path]::GetFullPath($literal);reason=$null}
  } catch [UnauthorizedAccessException] { return @{path=$null;reason='ACCESS_DENIED'} }
  catch { return $none }
}
# Shared by the real append loop and controlled boundary tests. No Registry reads
# or caller-controlled process argv; serialization is the existing compact emitter.
function Get-RegistryCandidateBudget644 {
  param([int]$Count,[int]$Segment,[string]$RowJson,[int]$Space,[int]$OldCount,[long]$OldBytes,[int]$Reserve)
  if ($Count -ge 512) { return @{reason='CANDIDATE_LIMIT';segment=$Segment} }
  $next=$Segment+[Console]::Out.Encoding.GetByteCount($RowJson)
  if ($Count -gt 0) { $next++ }
  $growth=$next-2
  if ($OldCount -gt 0) { $growth++ }
  if ($next -gt $Space -or $next -gt 1048576 -or $OldBytes+$Reserve+$growth -gt 16777216) {
    return @{reason='OUTPUT_LIMIT';segment=$Segment}
  }
  return @{reason=$null;segment=$next}
}
function Get-AppsRegistryJson644 {
  param([AllowEmptyCollection()][object[]]$OldRows,[hashtable]$Seen)
  $maxWire=16777216;$maxSegment=1048576;$maxKeys=4096
  $order=[string[]]@('KEY_LIMIT','CANDIDATE_LIMIT','OUTPUT_LIMIT','VALUE_LIMIT','ACCESS_DENIED','REGISTRY_READ_FAILED')
  $oldJson=Get-AppsJson644 -Rows $OldRows;$oldBytes=Get-AppsWireBytes644 $oldJson
  # Never clip or recover a preexisting legacy overflow; the unchanged runner rejects it.
  if ($oldBytes -gt $maxWire) { return $oldJson }
  $worst=@{status='partial';reasons=$order}
  $reserve=(Get-AppsWireBytes644 (Get-AppsJson644 -Rows $OldRows -Summary $worst))-$oldBytes
  $space=[Math]::Min($maxSegment,[Math]::Max(0,$maxWire-$oldBytes-$reserve))
  $limited=@{status='partial';reasons=[string[]]@('OUTPUT_LIMIT')}
  if ($space -lt 2) {
    $small=Get-AppsJson644 -Rows $OldRows -Summary $limited
    if ((Get-AppsWireBytes644 $small) -le $maxWire) { return $small }
    return $oldJson # Exact legacy shape, not a fabricated complete/unavailable summary.
  }
  $rows=New-Object System.Collections.Generic.List[object]
  $reasons=@{};$keys=0;$segment=2;$readable=0;$stop=$false
  $views=[Microsoft.Win32.RegistryView[]]@([Microsoft.Win32.RegistryView]::Registry32)
  if ([Environment]::Is64BitOperatingSystem) { $views=[Microsoft.Win32.RegistryView[]]@([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32) }
  foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)) {
    foreach ($view in $views) {
      if ($stop) { break }
      $base=$null;$rootKey=$null
      try {
        $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
        $rootKey=$base.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',$false)
        if ($null -eq $rootKey) { continue }
        $readable++
        $names=New-Object System.Collections.Generic.List[string]
        $index=[uint32]0
        while ($true) {
          if ($keys -ge $maxKeys) { $reasons.KEY_LIMIT=$true;$stop=$true;break }
          $n=[AppsRegistryReader644]::NameAt($rootKey.Handle.DangerousGetHandle(),$index)
          if ($n.Result -eq 259) { break }
          if ($n.Result -ne 0 -or !$n.Name) {
            if ($n.Result -eq 5) { $reasons.ACCESS_DENIED=$true } else { $reasons.REGISTRY_READ_FAILED=$true }
            break
          }
          $names.Add($n.Name);$keys++;$index++
        }
        $sorted=[string[]]@($names.ToArray());[Array]::Sort($sorted,(New-Object AppsRegistryNameOrder644))
        foreach ($name in $sorted) {
          $child=$null
          try {
            $child=$rootKey.OpenSubKey($name,$false)
            if ($null -eq $child) { continue }
            $title=[AppsRegistryReader644]::Value($child.Handle.DangerousGetHandle(),'DisplayName',2048)
            $icon=[AppsRegistryReader644]::Value($child.Handle.DangerousGetHandle(),'DisplayIcon',4096)
            $omit=$false
            foreach ($value in @($title,$icon)) {
              if ($value.Result -ne 0) {
                $omit=$true
                if ($value.Result -eq 234) { $reasons.VALUE_LIMIT=$true }
                elseif ($value.Result -eq 5) { $reasons.ACCESS_DENIED=$true }
                elseif ($value.Result -ne 2 -and $value.Result -ne 13) { $reasons.REGISTRY_READ_FAILED=$true }
              }
            }
            if ($omit -or !$title.Text -or $title.Text -match '[\x00-\x1f\x7f]') { continue }
            $display=$title.Text.Trim()
            if ($display.Length -gt 256) { $reasons.VALUE_LIMIT=$true;continue }
            if (!$display) { continue }
            $file=Get-RegistryExe644 $icon.Text
            if ($file.reason) { $reasons[$file.reason]=$true }
            if (!$file.path) { continue }
            $key=$file.path.ToLowerInvariant()
            if ($Seen.ContainsKey($key)) { continue }
            $row=@{name=$display;source='registry';path=$file.path}
            $budget=Get-RegistryCandidateBudget644 -Count $rows.Count -Segment $segment -RowJson (ConvertTo-Json -Compress -InputObject $row) -Space $space -OldCount $OldRows.Count -OldBytes $oldBytes -Reserve $reserve
            if ($budget.reason) { $reasons[$budget.reason]=$true;$stop=$true;break }
            $rows.Add($row);$Seen[$key]=$true;$segment=$budget.segment
          } catch [UnauthorizedAccessException] { $reasons.ACCESS_DENIED=$true }
          catch { $reasons.REGISTRY_READ_FAILED=$true }
          finally { if ($null -ne $child) { $child.Dispose() } }
        }
      } catch [UnauthorizedAccessException] { $reasons.ACCESS_DENIED=$true }
      catch { $reasons.REGISTRY_READ_FAILED=$true }
      finally { if ($null -ne $rootKey) { $rootKey.Dispose() };if ($null -ne $base) { $base.Dispose() } }
    }
  }
  $codes=New-Object System.Collections.Generic.List[string]
  foreach ($code in $order) { if ($reasons.ContainsKey($code)) { $codes.Add($code) } }
  $status='complete'
  if ($codes.Count -gt 0) {
    $status='partial'
    if ($readable -eq 0 -and !$reasons.KEY_LIMIT -and !$reasons.CANDIDATE_LIMIT -and !$reasons.OUTPUT_LIMIT -and !$reasons.VALUE_LIMIT) { $status='unavailable' }
  }
  $all=New-Object System.Collections.Generic.List[object]
  foreach ($row in $OldRows) { $all.Add($row) };foreach ($row in $rows) { $all.Add($row) }
  $json=Get-AppsJson644 -Rows $all.ToArray() -Summary @{status=$status;reasons=$codes.ToArray()}
  if ((Get-AppsWireBytes644 $json) -gt $maxWire) {
    # Final serialization discrepancy never loses old rows or emits broken JSON.
    $small=Get-AppsJson644 -Rows $OldRows -Summary $limited
    if ((Get-AppsWireBytes644 $small) -le $maxWire) { return $small }
    return $oldJson
  }
  return $json
}

$apps = New-Object System.Collections.Generic.List[object]
$seen = @{}   # dedupe key: lowercase canonical path, or "aumid:<lowercase id>"

# --- (a) running GUI processes ---------------------------------------------
# Best-effort: .Path can throw access-denied for elevated/system processes —
# those entries are skipped, not fatal.
try {
  Get-Process | Where-Object { -not [string]::IsNullOrEmpty($_.MainWindowTitle) } | ForEach-Object {
    $p = $null
    try { $p = $_.Path } catch { $p = $null }
    if ([string]::IsNullOrEmpty($p)) { return }
    $key = $p.ToLowerInvariant()
    if ($seen.ContainsKey($key)) { return }
    $seen[$key] = $true
    $name = $_.Description
    if ([string]::IsNullOrEmpty($name)) { $name = $_.ProcessName }
    $apps.Add(@{ name = [string]$name; source = "running"; path = [string]$p })
  }
} catch {
  # running-process enumeration is best-effort; startapps may still succeed.
}

# --- (b) Get-StartApps (win32 Start Menu + UWP) -----------------------------
try {
  Get-StartApps | ForEach-Object {
    $appId = [string]$_.AppID
    $name = [string]$_.Name
    if ([string]::IsNullOrEmpty($appId)) { return }
    if ($appId.Contains("!")) {
      # UWP / packaged app — AppID is an AUMID (PackageFamilyName!AppId).
      $key = "aumid:" + $appId.ToLowerInvariant()
      if ($seen.ContainsKey($key)) { return }
      $seen[$key] = $true
      $apps.Add(@{ name = $name; source = "startapps"; aumid = $appId })
    } else {
      # win32 entry: AppID may be a path (or a bare name). Keep only when it
      # resolves to an existing file — unresolved registry names are skipped
      # (surfacing them is P2 registry-Uninstall scope).
      $resolved = $null
      try {
        if (Test-Path -LiteralPath $appId) { $resolved = (Resolve-Path -LiteralPath $appId).Path }
      } catch { $resolved = $null }
      if ([string]::IsNullOrEmpty($resolved)) { return }
      $key = $resolved.ToLowerInvariant()
      if ($seen.ContainsKey($key)) { return }
      $seen[$key] = $true
      $apps.Add(@{ name = $name; source = "startapps"; path = $resolved })
    }
  }
} catch {
  # Get-StartApps unavailable (exotic SKU) — running-only result is still useful.
}

# NOTE: ConvertTo-Json in PS 5.1 rejects @($genericList) ("参数类型不匹配") —
# materialize with .ToArray() first.
Write-Output (Get-AppsRegistryJson644 -OldRows $apps.ToArray() -Seen $seen)
exit 0
