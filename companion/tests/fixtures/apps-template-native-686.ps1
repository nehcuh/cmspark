# #686 owned CI target observation only. No input synthesis/foreign attach/kill.
# NPPM_GETNBOPENFILES = 2031: ALL_OPEN_FILES=0, PRIMARY_VIEW=1.
# NPPM_GETCURRENTDOCINDEX = 2047: SUB_VIEW=1; hidden returns signed -1.
# A fresh NPP has one tab per view: main file + hidden unnamed placeholder.
# Primary: notepad-plus-plus dd40fe45598791e9aa38f3aeb200e10fb3d6338a
# PowerEditor/src/MISC/PluginsManager/Notepad_plus_msgs.h:76-84.
param([Parameter(Mandatory=$true)][int]$OwnedPid,
      [Parameter(Mandatory=$true)][string]$OwnedExe,
      [Parameter(Mandatory=$true)][string]$OwnedName)
$ErrorActionPreference='Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { throw 'OWNED_PS51_REQUIRED' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class OwnedNpp686 {
 [DllImport("user32.dll",SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true,EntryPoint="SendMessageTimeoutW")]
 public static extern IntPtr Text(IntPtr w,uint m,UIntPtr a,StringBuilder b,uint flags,uint timeout,out UIntPtr result);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true,EntryPoint="SendMessageTimeoutW")]
 public static extern IntPtr Count(IntPtr w,uint m,UIntPtr a,IntPtr b,uint flags,uint timeout,out UIntPtr result);
}
'@
$clock=[Diagnostics.Stopwatch]::StartNew()
# Failure-only latest sample: -1=none; 8 bits are the acceptance predicates below.
$observedMask=-1
# SendMessageTimeout returns DWORD_PTR bits; interpret signed -1 at this PS pointer width.
$hiddenIndex=[UInt64]::MaxValue
if ([IntPtr]::Size -eq 4) { $hiddenIndex=[UInt64][UInt32]::MaxValue }
while ($clock.ElapsedMilliseconds -lt 10000) {
 $owned=[Diagnostics.Process]::GetProcessById($OwnedPid)
 try {
  if ($owned.HasExited) { throw 'OWNED_TARGET_EXITED' }
  if (-not [string]::Equals($owned.MainModule.FileName,$OwnedExe,[StringComparison]::OrdinalIgnoreCase)) { throw 'OWNED_TARGET_IDENTITY_MISMATCH' }
  $owned.Refresh();$window=$owned.MainWindowHandle
  if ($window -ne [IntPtr]::Zero) {
   [uint32]$windowPid=0;$null=[OwnedNpp686]::GetWindowThreadProcessId($window,[ref]$windowPid)
   if ($windowPid -ne $OwnedPid) { throw 'OWNED_WINDOW_MISMATCH' }
   $title=New-Object System.Text.StringBuilder -ArgumentList 512
   [UIntPtr]$titleLength=[UIntPtr]::Zero;[UIntPtr]$count=[UIntPtr]::Zero
   $a=[OwnedNpp686]::Text($window,13,[UIntPtr]::new([uint32]512),$title,2,200,[ref]$titleLength)
   $b=[OwnedNpp686]::Count($window,2031,[UIntPtr]::Zero,[IntPtr]::Zero,2,200,[ref]$count)
   [UIntPtr]$primaryCount=[UIntPtr]::Zero;[UIntPtr]$secondaryIndex=[UIntPtr]::Zero
   $c=[OwnedNpp686]::Count($window,2031,[UIntPtr]::Zero,[IntPtr]::new([int]1),2,200,[ref]$primaryCount)
   $d=[OwnedNpp686]::Count($window,2047,[UIntPtr]::Zero,[IntPtr]::new([int]1),2,200,[ref]$secondaryIndex)
   $observedMask=0
   if ($a -ne [IntPtr]::Zero) { $observedMask=$observedMask -bor 1 }
   if ($b -ne [IntPtr]::Zero) { $observedMask=$observedMask -bor 2 }
   if ($count.ToUInt64() -eq 2) { $observedMask=$observedMask -bor 4 }
   if ($title.ToString().Contains($OwnedName)) { $observedMask=$observedMask -bor 8 }
   if ($c -ne [IntPtr]::Zero) { $observedMask=$observedMask -bor 16 }
   if ($primaryCount.ToUInt64() -eq 1) { $observedMask=$observedMask -bor 32 }
   if ($d -ne [IntPtr]::Zero) { $observedMask=$observedMask -bor 64 }
   if ($secondaryIndex.ToUInt64() -eq $hiddenIndex) { $observedMask=$observedMask -bor 128 }
   if ($a -ne [IntPtr]::Zero -and $b -ne [IntPtr]::Zero -and $count.ToUInt64() -eq 2 -and $title.ToString().Contains($OwnedName) -and
       $c -ne [IntPtr]::Zero -and $primaryCount.ToUInt64() -eq 1 -and $d -ne [IntPtr]::Zero -and $secondaryIndex.ToUInt64() -eq $hiddenIndex) {
    @{native_ps51=$true;owned_window=$true;matching_file_title=$true;visible_files=1;total_tabs=2;hidden_secondary_placeholder=$true;actual_target_parser=$true} | ConvertTo-Json -Compress
    exit 0
   }
  }
 } finally { $owned.Dispose() }
 Start-Sleep -Milliseconds 20
}
throw ('OWNED_TARGET_FILE_NOT_OBSERVED observed_mask={0}' -f $observedMask)
