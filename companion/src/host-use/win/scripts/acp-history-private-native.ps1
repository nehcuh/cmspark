# #732 private first-party native definitions. No path discovery, output or token changes.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not ('CMsparkHistoryPrivate732' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;
public static class CMsparkHistoryPrivate732 {
  const uint READ_CONTROL=0x20000, WRITE_DAC=0x40000, WRITE_OWNER=0x80000, READ_ATTRIBUTES=0x80;
  const uint SHARE_READ=1, SHARE_WRITE=2, OPEN_EXISTING=3, CREATE_NEW=1, REPARSE=0x200000, BACKUP=0x02000000;
  const uint OWNER_INFO=1, DACL_INFO=4, PROTECTED_DACL=0x80000000;
  [StructLayout(LayoutKind.Sequential)] struct IO_STATUS { public IntPtr Status; public UIntPtr Information; }
  [StructLayout(LayoutKind.Sequential)] struct INTERNAL { public long IndexNumber; }
  [StructLayout(LayoutKind.Sequential)] struct VOLUME { public long Creation; public uint Serial; public uint LabelLength; public byte SupportsObjects; }
  [StructLayout(LayoutKind.Sequential)] struct INFO { public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write; public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow; }
  [StructLayout(LayoutKind.Sequential)] struct SECURITY { public uint Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit; }
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFileW(string path,uint access,uint share,ref SECURITY security,uint disposition,uint flags,IntPtr template);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateDirectoryW(string path,ref SECURITY security);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out INFO info);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint GetFileType(SafeFileHandle handle);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,StringBuilder path,uint size,uint flags);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [DllImport("ntdll.dll")] static extern int NtQueryInformationFile(SafeFileHandle handle,out IO_STATUS status,out INTERNAL info,uint size,int kind);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [DllImport("ntdll.dll")] static extern int NtQueryVolumeInformationFile(SafeFileHandle handle,out IO_STATUS status,out VOLUME info,uint size,int kind);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetKernelObjectSecurity(SafeFileHandle handle,uint flags,byte[] descriptor,uint size,out uint needed);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string value,uint revision,out IntPtr descriptor,out uint size);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetSecurityDescriptorOwner(IntPtr descriptor,out IntPtr owner,out bool defaulted);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetSecurityDescriptorDacl(IntPtr descriptor,out bool present,out IntPtr dacl,out bool defaulted);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [DllImport("advapi32.dll")] static extern uint SetSecurityInfo(SafeFileHandle handle,int type,uint flags,IntPtr owner,IntPtr group,IntPtr dacl,IntPtr sacl);
  static bool Decimal(string text,out ulong value) { value=0; return text!=null && Regex.IsMatch(text,"^(0|[1-9][0-9]{0,19})$") && ulong.TryParse(text,out value); }
  static bool PathIs(SafeFileHandle h,string expected) {
    StringBuilder text=new StringBuilder(32768);uint n=GetFinalPathNameByHandleW(h,text,32768,0);if(n==0||n>=32768)return false;
    string actual=text.ToString();if(actual.StartsWith("\\\\?\\UNC\\",StringComparison.Ordinal))actual="\\\\"+actual.Substring(8);else if(actual.StartsWith("\\\\?\\",StringComparison.Ordinal))actual=actual.Substring(4);
    return String.Equals(actual.TrimEnd('\\'),expected.TrimEnd('\\'),StringComparison.OrdinalIgnoreCase);
  }
  static bool Bound(SafeFileHandle h,ulong volume,ulong index,bool directory,bool empty,string expected) {
    if(h==null||h.IsInvalid||h.IsClosed||GetFileType(h)!=1)return false;
    INFO f;INTERNAL id;VOLUME v;IO_STATUS io;
    if(!GetFileInformationByHandle(h,out f)||(f.Attributes&0x400)!=0||((f.Attributes&0x10)!=0)!=directory||(!directory&&f.Links!=1)||
       (empty&&(f.SizeHigh!=0||f.SizeLow!=0))||!PathIs(h,expected))return false;
    // Identical native information classes to pinned Node22/libuv, not lossy Number.
    if(NtQueryInformationFile(h,out io,out id,(uint)Marshal.SizeOf(typeof(INTERNAL)),6)<0)return false;
    int result=NtQueryVolumeInformationFile(h,out io,out v,(uint)Marshal.SizeOf(typeof(VOLUME)),1);
    if(result<0&&result!=unchecked((int)0x80000005))return false; // variable label buffer overflow is expected
    return volume<=UInt32.MaxValue&&index!=0&&v.Serial==(uint)volume&&unchecked((ulong)id.IndexNumber)==index;
  }
  static bool Private(SafeFileHandle h,SecurityIdentifier user,bool protectedAcl=false) {
    uint needed;GetKernelObjectSecurity(h,OWNER_INFO|DACL_INFO,null,0,out needed);if(needed==0||needed>65536)return false;
    byte[] bytes=new byte[needed];if(!GetKernelObjectSecurity(h,OWNER_INFO|DACL_INFO,bytes,needed,out needed))return false;
    RawSecurityDescriptor sd=new RawSecurityDescriptor(bytes,0);if(protectedAcl&&(sd.ControlFlags&ControlFlags.DiscretionaryAclProtected)==0)return false;if(sd.Owner==null||!sd.Owner.Equals(user)||(sd.ControlFlags&ControlFlags.DiscretionaryAclPresent)==0||sd.DiscretionaryAcl==null)return false;
    foreach(GenericAce a in sd.DiscretionaryAcl){CommonAce ace=a as CommonAce;if(ace==null||ace.IsCallback)return false;
      if(ace.AceQualifier==AceQualifier.AccessAllowed){string sid=ace.SecurityIdentifier.Value;if(sid!=user.Value&&sid!="S-1-5-18"&&sid!="S-1-5-32-544")return false;}
      else if(ace.AceQualifier!=AceQualifier.AccessDenied)return false;
    }return true;
  }
  static IntPtr Descriptor(SecurityIdentifier user,bool directory) {
    IntPtr sd;uint size;string flags=directory?"OICI":"";string value="O:"+user.Value+"D:P(A;"+flags+";FA;;;"+user.Value+")(A;"+flags+";FA;;;SY)(A;"+flags+";FA;;;BA)";
    if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(value,1,out sd,out size)||sd==IntPtr.Zero)throw new InvalidOperationException();return sd;
  }
  static bool Canonical(string root) {return root!=null&&Regex.IsMatch(root,@"^[A-Za-z]:\\")&&Path.IsPathRooted(root)&&root.IndexOf('\0')<0&&String.Equals(Path.GetFullPath(root).TrimEnd('\\'),root.TrimEnd('\\'),StringComparison.OrdinalIgnoreCase);}
  public static string Initialize(string root,string name,string rootDev,string rootIno,string fileDev,string fileIno) {
    IntPtr sd=IntPtr.Zero;try {
      ulong dv,di,fv,fi;if(!Canonical(root)||!Regex.IsMatch(name??"","^acp-history\\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.tmp$")||
        !Decimal(rootDev,out dv)||!Decimal(rootIno,out di)||!Decimal(fileDev,out fv)||!Decimal(fileIno,out fi))return "REFUSED";
      SecurityIdentifier user=WindowsIdentity.GetCurrent().User;if(user==null)return "UNKNOWN";string file=Path.Combine(root,name);
      // Omit FILE_SHARE_DELETE while these exact retained handles are used.
      using(SafeFileHandle parent=CreateFileW(root,READ_CONTROL|READ_ATTRIBUTES,SHARE_READ|SHARE_WRITE,IntPtr.Zero,OPEN_EXISTING,REPARSE|BACKUP,IntPtr.Zero)) {
        if(!Bound(parent,dv,di,true,false,root)||!Private(parent,user))return "REFUSED";
        using(SafeFileHandle child=CreateFileW(file,READ_CONTROL|READ_ATTRIBUTES|WRITE_DAC|WRITE_OWNER,SHARE_READ|SHARE_WRITE,IntPtr.Zero,OPEN_EXISTING,REPARSE,IntPtr.Zero)) {
          if(!Bound(child,fv,fi,false,true,file)||!Bound(parent,dv,di,true,false,root)||!Private(parent,user))return "REFUSED";
          sd=Descriptor(user,false);IntPtr owner,dacl;bool present,defaulted;
          if(!GetSecurityDescriptorOwner(sd,out owner,out defaulted)||!GetSecurityDescriptorDacl(sd,out present,out dacl,out defaulted)||!present||dacl==IntPtr.Zero)return "UNKNOWN";
          if(SetSecurityInfo(child,1,OWNER_INFO|DACL_INFO|PROTECTED_DACL,owner,IntPtr.Zero,dacl,IntPtr.Zero)!=0)return "REFUSED";
          if(!Bound(child,fv,fi,false,true,file)||!Private(child,user,true)||!Bound(parent,dv,di,true,false,root)||!Private(parent,user))return "REFUSED";
          return "INITIALIZED";
        }
      }
    }catch{return "UNKNOWN";}finally{if(sd!=IntPtr.Zero)LocalFree(sd);}
  }
  public static string Fixture(string parentPath,string name,string dev,string ino,bool file) {
    if(Environment.OSVersion.Platform!=PlatformID.Win32NT||Environment.GetEnvironmentVariable("GITHUB_ACTIONS")!="true"||Environment.GetEnvironmentVariable("RUNNER_OS")!="Windows")return "REFUSED";
    IntPtr sd=IntPtr.Zero;try {
      ulong dv,di;if(!Canonical(parentPath)||!Decimal(dev,out dv)||!Decimal(ino,out di)||
        (file?name!="empty":!Regex.IsMatch(name??"","^history-root-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")))return "REFUSED";
      SecurityIdentifier user=WindowsIdentity.GetCurrent().User;if(user==null)return "UNKNOWN";string target=Path.Combine(parentPath,name);
      using(SafeFileHandle parent=CreateFileW(parentPath,READ_CONTROL|READ_ATTRIBUTES,SHARE_READ|SHARE_WRITE,IntPtr.Zero,OPEN_EXISTING,REPARSE|BACKUP,IntPtr.Zero)) {
        if(!Bound(parent,dv,di,true,false,parentPath)||(file&&!Private(parent,user)))return "REFUSED";
        sd=Descriptor(user,!file);SECURITY sa=new SECURITY();sa.Length=(uint)Marshal.SizeOf(typeof(SECURITY));sa.Descriptor=sd;sa.Inherit=false;
        if(file){
          using(SafeFileHandle created=CreateFileW(target,0x100000|READ_CONTROL|READ_ATTRIBUTES,SHARE_READ|SHARE_WRITE,ref sa,CREATE_NEW,0x80,IntPtr.Zero)) {
            INFO info;if(created.IsInvalid||!GetFileInformationByHandle(created,out info)||(info.Attributes&(0x400|0x10))!=0||info.Links!=1||info.SizeHigh!=0||info.SizeLow!=0||!PathIs(created,target)||!Private(created,user,true))return "REFUSED";
            return Bound(parent,dv,di,true,false,parentPath)?"INITIALIZED":"REFUSED";
          }
        }
        if(!CreateDirectoryW(target,ref sa))return "REFUSED"; // existing final path is never accepted
        using(SafeFileHandle created=CreateFileW(target,READ_CONTROL|READ_ATTRIBUTES,SHARE_READ|SHARE_WRITE,IntPtr.Zero,OPEN_EXISTING,REPARSE|BACKUP,IntPtr.Zero)) {
          INFO info;if(created.IsInvalid||!GetFileInformationByHandle(created,out info)||(info.Attributes&0x400)!=0||(info.Attributes&0x10)==0||!PathIs(created,target)||!Private(created,user,true))return "REFUSED";
          return Bound(parent,dv,di,true,false,parentPath)?"INITIALIZED":"REFUSED";
        }
      }
    }catch{return "UNKNOWN";}finally{if(sd!=IntPtr.Zero)LocalFree(sd);}
  }
}
'@ -ErrorAction Stop | Out-Null
}
