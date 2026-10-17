# #686 owned CI target observation only. No input synthesis/foreign attach/kill.
# NPPM_GETNBOPENFILES = WM_USER(1024)+1000+7, ALL_OPEN_FILES=0.
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
   if ($a -ne [IntPtr]::Zero -and $b -ne [IntPtr]::Zero -and $count.ToUInt64() -eq 1 -and $title.ToString().Contains($OwnedName)) {
    @{native_ps51=$true;owned_window=$true;matching_file_title=$true;open_files=1;actual_target_parser=$true} | ConvertTo-Json -Compress
    exit 0
   }
  }
 } finally { $owned.Dispose() }
 Start-Sleep -Milliseconds 20
}
throw 'OWNED_TARGET_FILE_NOT_OBSERVED'
