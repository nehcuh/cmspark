param([ValidateSet('small-wire','measure-small','partial-wire','legacy-wire','overflow-wire','primitives','owned-precedence')][string]$Mode,[string]$Script,[string]$Directory)
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='Stop'
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or $PSVersionTable.PSEdition -ne 'Desktop') { throw 'OWNED_REQUIRES_NATIVE_PS51' }
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($Script,[ref]$tokens,[ref]$errors)
if ($errors.Count -ne 0) {
 # Public parser identities/locations only; never Message, Extent.Text or source.
 foreach ($parseError in @($errors | Microsoft.PowerShell.Utility\Select-Object -First 8)) {
  $errorId=[string]$parseError.ErrorId
  if ($errorId -notmatch '^[A-Za-z][A-Za-z0-9]{0,63}$') { $errorId='UNKNOWN' }
  [Console]::Error.WriteLine(('OWNED_PRODUCTION_PS_SYNTAX ErrorId={0} Line={1} Column={2}' -f $errorId,[int]$parseError.Extent.StartLineNumber,[int]$parseError.Extent.StartColumnNumber))
 }
 throw 'OWNED_PRODUCTION_PS_SYNTAX'
}
$add=$ast.FindAll({param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -in @('Add-Type','Microsoft.PowerShell.Utility\Add-Type')},$true)
if ($add.Count -ne 1 -or $add[0].CommandElements[2] -isnot [Management.Automation.Language.StringConstantExpressionAst]) { throw 'OWNED_NATIVE_LITERAL_REQUIRED' }
$code=$add[0].CommandElements[2].Value
$faults=@'
public static class RegistryFaults644 {
 public static string[] Run() {
  var names=new System.Collections.Generic.List<string>();
  for(int scenario=0;scenario<8;scenario++) {
   int calls=0;int which=scenario;
   AppsRegistryReader644.QueryReader q=delegate(System.IntPtr h,string n,System.IntPtr z,out uint k,byte[] data,ref uint bytes) {
    calls++;k=1;
    if(data==null) { bytes=which==0 ? 4097u : which==5 ? 6u : 4u;return 0; }
    if(data.Length!=4096)throw new System.Exception("OWNED_PREALLOCATION_BOUND");
    if(which==1) {bytes=5000;return 234;}
    if(which==7) {data[0]=65;data[1]=0;data[2]=66;data[3]=0;data[4]=0;data[5]=0;bytes=6;return 0;}
    if(which==2) {k=4;bytes=4;return 0;}
    if(which==3) {bytes=1;return 0;}
    if(which==4) {data[0]=0;data[1]=0xd8;bytes=2;return 0;}
    if(which==5) {data[0]=65;data[1]=0;data[2]=0;data[3]=0;data[4]=66;data[5]=0;bytes=6;return 0;}
    data[0]=65;data[1]=0;data[2]=0;data[3]=0;bytes=4;return 0;
   };
   var v=AppsRegistryReader644.ValueCore(System.IntPtr.Zero,"owned",4096,q);
   int expected=scenario<2 || scenario==7 ? 234 : scenario<6 ? 13 : 0;
   if(v.Result!=expected || calls!=(scenario==0?1:2) || (scenario==6 && v.Text!="A"))throw new System.Exception("OWNED_BOUND_OR_DECODE");
   names.Add("value-core-"+scenario);
  }
  for(int scenario=0;scenario<4;scenario++) {
   int calls=0;int which=scenario;
   AppsRegistryReader644.NameReader reader=delegate(System.IntPtr h,uint index,System.Text.StringBuilder name,ref uint chars,System.IntPtr r,System.IntPtr c,System.IntPtr cc,System.IntPtr stamp) {
    calls++;if(name.Capacity!=256 || chars!=256 || index!=3)throw new System.Exception("OWNED_KEY_BUFFER_BOUND");
    if(which==1)return 234;if(which==2)return 259;if(which==3){chars=256;return 0;}
    name.Append("Owned");chars=5;return 0;
   };
   var v=AppsRegistryReader644.NameAtCore(System.IntPtr.Zero,3,reader);
   int expected=scenario==0?0:scenario==1?234:scenario==2?259:13;
   if(v.Result!=expected || calls!=1 || (scenario==0 && v.Name!="Owned") || (scenario!=0 && v.Name!=null))throw new System.Exception("OWNED_KEY_ERROR_OR_RETRY");
   names.Add("name-core-"+scenario);
  }
  return names.ToArray();
 }
}
'@
Microsoft.PowerShell.Utility\Add-Type -TypeDefinition ($code+$faults) | Microsoft.PowerShell.Core\Out-Null
$wanted=@('Get-AppsJson644','Get-AppsWireBytes644','Get-RegistryExe644','Get-RegistryCandidateBudget644','Get-AppsRegistryJson644')
foreach ($f in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true)) {
 if ($wanted -contains $f.Name) { Microsoft.PowerShell.Management\Set-Item -Path ('function:global:'+$f.Name) -Value $f.Body.GetScriptBlock() }
}
if ($Mode -eq 'primitives') {
 $cases=[RegistryFaults644]::Run()
 $good=Microsoft.PowerShell.Management\Join-Path $Directory 'App.exe'
 # Expected path comes from Node's native filesystem oracle for this owned file,
 # independently of Get-RegistryExe644. Raw input grammar still uses $good.
 $expected=(Microsoft.PowerShell.Utility\ConvertFrom-Json ([IO.File]::ReadAllText((Microsoft.PowerShell.Management\Join-Path $Directory 'owned-native-files.json')))).app
 if ([string]::IsNullOrEmpty($expected)) { throw 'OWNED_NATIVE_FILE_ORACLE_REQUIRED' }
 $quoted=(Get-RegistryExe644 ('"'+$good+'",-1')).path
 $unquoted=(Get-RegistryExe644 ($good+',1')).path
 if ($quoted -ne $expected) { throw 'OWNED_LITERAL_POSITIVE' }
 if ($good -match '\s' -or $unquoted -ne $expected) { throw 'OWNED_UNQUOTED_LITERAL_POSITIVE' }
 foreach ($bad in @('relative.exe','%SystemRoot%\App.exe','\\remote\App.exe','C:\x.exe:stream',('"'+$good+'" /quiet'),($good+' --arg'),('"'+(Microsoft.PowerShell.Management\Join-Path $Directory 'App.dll')+'",0'),('"'+(Microsoft.PowerShell.Management\Join-Path $Directory 'Folder.exe')+'",0'))) {
  if ((Get-RegistryExe644 $bad).path) { throw 'OWNED_LITERAL_NEGATIVE' }
 }
 if ((Get-RegistryExe644 ('C:\'+('x'*1024)+'.exe')).reason -ne 'VALUE_LIMIT') { throw 'OWNED_PATH_FIELD_LIMIT' }
 $rowJson=Microsoft.PowerShell.Utility\ConvertTo-Json -Compress -InputObject @{name=([string][char]0x6c49+' " \');source='registry';path=$good}
 $cost=[Console]::Out.Encoding.GetByteCount($rowJson)
 # Actual append primitive: inclusive count/segment/full-envelope boundaries,
 # existing-source comma and escaped UTF-8, without thousands of Registry keys.
 if ((Get-RegistryCandidateBudget644 511 2 $rowJson 1048576 0 10 200).reason) { throw 'OWNED_ROW_512_ALLOWED' }
 if ((Get-RegistryCandidateBudget644 512 2 $rowJson 1048576 0 10 200).reason -ne 'CANDIDATE_LIMIT') { throw 'OWNED_ROW_513_REFUSED' }
 if ((Get-RegistryCandidateBudget644 1 (1048576-$cost-1) $rowJson 1048576 0 10 200).segment -ne 1048576) { throw 'OWNED_SEGMENT_EXACT' }
 if ((Get-RegistryCandidateBudget644 1 (1048576-$cost) $rowJson 1048576 0 10 200).reason -ne 'OUTPUT_LIMIT') { throw 'OWNED_SEGMENT_OVER' }
 $legacy=16777216-200-$cost-1
 if ((Get-RegistryCandidateBudget644 0 2 $rowJson 1048576 1 $legacy 200).reason) { throw 'OWNED_TOTAL_EXACT' }
 if ((Get-RegistryCandidateBudget644 0 2 $rowJson 1048576 1 ($legacy+1) 200).reason -ne 'OUTPUT_LIMIT') { throw 'OWNED_TOTAL_OVER' }
 Microsoft.PowerShell.Utility\Write-Output (Microsoft.PowerShell.Utility\ConvertTo-Json -Compress -InputObject @{admission_boundaries=6;cases=$cases;native_ps51=$true;declared_query_fault_seam=$true;literal_controls=$true;quoted_path=$quoted;unquoted_path=$unquoted})
 exit 0
}
if ($Mode -eq 'owned-precedence') {
 $item=(Microsoft.PowerShell.Utility\ConvertFrom-Json ([IO.File]::ReadAllText((Microsoft.PowerShell.Management\Join-Path $Directory 'values.json')))) | Microsoft.PowerShell.Core\Where-Object {$_.kind -eq 'good'} | Microsoft.PowerShell.Utility\Select-Object -First 1
 $file=Get-RegistryExe644 ([string]$item.value)
 if (!$file.path) { throw 'OWNED_PRECEDENCE_PATH_REQUIRED' }
 $old=@{name='OwnedLegacy644';source='running';path=$file.path}
 $seen=@{};$seen[$file.path.ToLowerInvariant()]=$true
 Microsoft.PowerShell.Utility\Write-Output (Get-AppsRegistryJson644 -OldRows @($old) -Seen $seen);exit 0
}
$row=@{name='';source='startapps';aumid='Owned644!Legacy'}
if ($Mode -eq 'small-wire' -or $Mode -eq 'measure-small') {
 $row.name='Unicode '+[char]0x6c49+[char]0x5b57+' " \'
 $body=Get-AppsJson644 -Rows @($row)
 if ($Mode -eq 'measure-small') { Microsoft.PowerShell.Utility\Write-Output (Microsoft.PowerShell.Utility\ConvertTo-Json -Compress -InputObject @{wire_bytes=(Get-AppsWireBytes644 $body);body_bytes=([Console]::Out.Encoding.GetByteCount($body));newline_bytes=([Console]::Out.Encoding.GetByteCount([Console]::Out.NewLine));configured_preamble_bytes=([Console]::Out.Encoding.GetPreamble().Length);encoding_codepage=([Console]::Out.Encoding.CodePage);native_ps51=$true});exit 0 }
 Microsoft.PowerShell.Utility\Write-Output $body;exit 0
}
$small=@{status='partial';reasons=[string[]]@('OUTPUT_LIMIT')}
$base=Get-AppsJson644 -Rows @($row)
$overhead=(Get-AppsWireBytes644 (Get-AppsJson644 -Rows @($row) -Summary $small))-(Get-AppsWireBytes644 $base)
$target=16777216
if ($Mode -eq 'partial-wire') { $target-=$overhead }
if ($Mode -eq 'overflow-wire') { $target++ }
$row.name='L'*($target-(Get-AppsWireBytes644 $base))
$result=Get-AppsRegistryJson644 -OldRows @($row) -Seen @{}
$parsed=Microsoft.PowerShell.Utility\ConvertFrom-Json $result
if ($Mode -eq 'partial-wire') {
 if ($parsed.registry_summary.status -ne 'partial' -or $parsed.registry_summary.reasons[0] -ne 'OUTPUT_LIMIT' -or $parsed.apps.Count -ne 1) { throw 'OWNED_PARTIAL_ZERO' }
} elseif ($parsed.PSObject.Properties.Name -contains 'registry_summary') { throw 'OWNED_LEGACY_SHAPE_REQUIRED' }
if ($parsed.apps[0].name -cne $row.name) { throw 'OWNED_LEGACY_ROWS_CHANGED' }
Microsoft.PowerShell.Utility\Write-Output $result
