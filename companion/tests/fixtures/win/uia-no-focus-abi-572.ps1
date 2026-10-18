# Owned ABI-negative driver. Only invalid arguments reach the fixed export;
# no action/provider fault injection or user-selected executable is supported.
param([Parameter(Mandatory=$true)][long]$Hwnd,[Parameter(Mandatory=$true)][string]$Library)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$info = [IO.FileInfo]::new($Library)
if (-not [IO.Path]::IsPathRooted($Library) -or -not $info.Exists -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'UIA572_ABI_LIBRARY_UNAVAILABLE' }
$literal = $info.FullName.Replace('"','""')
$source = @"
using System;
using System.Runtime.InteropServices;
public static class OwnedAbi572 {
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [DllImport(@"$literal", EntryPoint="CUiAction", ExactSpelling=true, CallingConvention=CallingConvention.Winapi, CharSet=CharSet.Unicode)]
  private static extern int Act(IntPtr root, uint rootPid, uint selectedPid, int mode,
    [In, MarshalAs(UnmanagedType.LPArray, SizeParamIndex=5)] int[] runtime, int runtimeCount, int controlType,
    [MarshalAs(UnmanagedType.LPWStr)] string automationId, int automationLength,
    [MarshalAs(UnmanagedType.LPWStr)] string value, int valueLength, int direction, int count,
    int depth, int nodes, [MarshalAs(UnmanagedType.LPWStr)] string stop, int stopLength);
  public static bool RejectAll(long ownedRoot) {
    IntPtr root = new IntPtr(ownedRoot); uint owner;
    if(GetWindowThreadProcessId(root,out owner)==0 || owner==0) return false;
    for(int which=0;which<10;which++) {
      IntPtr h=root;uint rootPid=owner, selectedPid=owner;int mode=2, runtimeCount=1, direction=1, depth=24, nodes=4000;
      int[] runtime=new int[]{1};
      switch(which) {
        case 0:h=IntPtr.Zero;break;
        case 1:rootPid=0;break;
        case 2:selectedPid=0;break;
        case 3:runtime=null;break;
        case 4:runtimeCount=0;break;
        case 5:runtime=new int[65];runtimeCount=65;break;
        case 6:mode=0;break;
        case 7:direction=0;break;
        case 8:depth=0;break;
        case 9:nodes=0;break;
      }
      if(Act(h,rootPid,selectedPid,mode,runtime,runtimeCount,50004,"owned_setvalue572",17,"",0,direction,1,depth,nodes,"",0)!=5)return false;
    }
    return true;
  }
}
"@
Microsoft.PowerShell.Utility\Add-Type -TypeDefinition $source
if (-not [OwnedAbi572]::RejectAll($Hwnd)) { throw 'UIA572_ABI_INVALID_ARGUMENT_ACCEPTED' }
[ordered]@{schema=1;kind='UIA572_ABI_INVALID';cases=10;allRejected=$true} | Microsoft.PowerShell.Utility\ConvertTo-Json -Compress
