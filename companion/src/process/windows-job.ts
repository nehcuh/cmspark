// Start an owned Windows process suspended, assign it to a non-inherited
// kill-on-close Job Object, then resume. Kernel ownership also covers a wrapper
// that exits before its descendants and a forcefully terminated Companion.
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"
import path from "node:path"
import { fileURLToPath, URL as NodeURL } from "node:url"
import { randomBytes } from "node:crypto"
import { windowsCmdExePath, windowsPowerShellExePath } from "../acp/win-spawn"
import { windowsTargetEnvironment } from "./windows-env"
import { windowsJobOwner } from "./windows-owner"
export { prepareWindowsJob } from "./windows-owner"

const ownedJobChildren = new WeakSet<ChildProcess>()
export const isOwnedWindowsJobChild = (child: ChildProcess): boolean => ownedJobChildren.has(child)

const JOB_BOOTSTRAP = String.raw`
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class CMsparkOwnedJob {
  [StructLayout(LayoutKind.Sequential)] struct Basic {
    public long PerProcess, PerJob; public uint Flags;
    public UIntPtr Min, Max; public uint Active; public UIntPtr Affinity;
    public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IO {
    public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
  }
  [StructLayout(LayoutKind.Sequential)] struct Limits {
    public Basic Basic; public IO IO; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public uint Size; public string Reserved, Desktop, Title;
    public uint X,Y,XSize,YSize,XChars,YChars,Fill,Flags; public ushort Show,ReservedSize;
    public IntPtr ReservedPtr, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
    public IntPtr Process, Thread; public uint ProcessId, ThreadId;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref Limits limits, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app, StringBuilder line, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref Startup start, out ProcessInfo info);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint Low, High; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out FileTime created, out FileTime exited, out FileTime kernel, out FileTime user);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool all, uint timeout);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  static void Fail(string stage) {
    int code=Marshal.GetLastWin32Error();
    throw new System.ComponentModel.Win32Exception(code,stage+" ("+code+"): "+new System.ComponentModel.Win32Exception(code).Message);
  }
  static IntPtr InheritableStandardHandle(int kind) {
    IntPtr source=GetStdHandle(kind), temporary=IntPtr.Zero, duplicate;
    // Node's stdio:ignore can leave a console-less host without a standard
    // handle. Supply NUL, rather than passing an invalid STARTUPINFO handle.
    if(source==IntPtr.Zero || source==new IntPtr(-1)) {
      temporary=CreateFile("NUL",kind==-10 ? 0x80000000u : 0x40000000u,3,IntPtr.Zero,3,0,IntPtr.Zero);
      if(temporary==new IntPtr(-1)) Fail("CreateFile(NUL)");
      source=temporary;
    }
    try {
      // A valid host handle is not necessarily inheritable. STARTF_USESTDHANDLES
      // alone does not make the child's copy valid. Duplicate the handle with
      // inheritance enabled, without mutating the host's handle.
      if(!DuplicateHandle(GetCurrentProcess(),source,GetCurrentProcess(),out duplicate,0,true,2)) Fail("DuplicateHandle(stdio)");
      return duplicate;
    } finally { if(temporary!=IntPtr.Zero) CloseHandle(temporary); }
  }
  static byte[] TargetEnvironment(string encoded) {
    byte[] bytes=Convert.FromBase64String(encoded);
    if(bytes.Length<4 || bytes.Length%2!=0 || bytes[bytes.Length-1]!=0 || bytes[bytes.Length-2]!=0 || bytes[bytes.Length-3]!=0 || bytes[bytes.Length-4]!=0)
      throw new InvalidOperationException("Invalid target environment block");
    string[] entries=Encoding.Unicode.GetString(bytes).Split(new char[] {'\0'},StringSplitOptions.RemoveEmptyEntries);
    Array.Sort(entries,delegate(string a,string b) {
      int ai=a.IndexOf('=',a.StartsWith("=") ? 1 : 0), bi=b.IndexOf('=',b.StartsWith("=") ? 1 : 0);
      return StringComparer.OrdinalIgnoreCase.Compare(a.Substring(0,ai),b.Substring(0,bi));
    });
    return Encoding.Unicode.GetBytes(String.Join("\0",entries)+"\0\0");
  }
  public static int Run(string app, string line, string cwd, uint parentPid, ulong parentCreated, string encodedEnv) {
    IntPtr parent=OpenProcess(0x00101000,false,parentPid), job=IntPtr.Zero;
    IntPtr input=IntPtr.Zero, output=IntPtr.Zero, error=IntPtr.Zero, environment=IntPtr.Zero;
    ProcessInfo info=new ProcessInfo(); bool resumed=false;
    if(parent==IntPtr.Zero) Fail("OpenProcess(parent)");
    try {
      byte[] targetEnv=TargetEnvironment(encodedEnv);
      environment=Marshal.AllocHGlobal(targetEnv.Length);
      Marshal.Copy(targetEnv,0,environment,targetEnv.Length);
      FileTime created, exited, kernel, user;
      if(!GetProcessTimes(parent,out created,out exited,out kernel,out user)) Fail("GetProcessTimes(parent)");
      if((((ulong)created.High<<32)|created.Low)!=parentCreated || WaitForSingleObject(parent,0)==0)
        throw new InvalidOperationException("Companion owner has exited or changed");
      job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero) Fail("CreateJobObject");
      Limits limits=new Limits(); limits.Basic.Flags=0x2000;
      if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Limits)))) Fail("SetInformationJobObject");
      Startup start=new Startup(); start.Size=(uint)Marshal.SizeOf(typeof(Startup)); start.Flags=0x100;
      start.Input=input=InheritableStandardHandle(-10);
      start.Output=output=InheritableStandardHandle(-11);
      start.Error=error=InheritableStandardHandle(-12);
      // PowerShell binds $null to String.Empty for a string method parameter.
      // Win32 needs a null pointer to inherit cwd; an empty path is invalid.
      if(!CreateProcess(app,new StringBuilder(line),IntPtr.Zero,IntPtr.Zero,true,0x08000404,environment,String.IsNullOrEmpty(cwd) ? null : cwd,ref start,out info)) Fail("CreateProcess");
      if(!AssignProcessToJobObject(job,info.Process)) Fail("AssignProcessToJobObject");
      if(ResumeThread(info.Thread)==0xffffffff) Fail("ResumeThread");
      resumed=true;
      uint completed=WaitForMultipleObjects(2,new IntPtr[] { info.Process,parent },false,0xffffffff);
      if(completed==1) return 1; // Owner crash: closing our job still reclaims the complete tree.
      if(completed!=0) Fail("WaitForMultipleObjects");
      uint code; if(!GetExitCodeProcess(info.Process,out code)) Fail("GetExitCodeProcess");
      return unchecked((int)code);
    } finally {
      if(environment!=IntPtr.Zero) Marshal.FreeHGlobal(environment);
      if(input!=IntPtr.Zero) CloseHandle(input);
      if(output!=IntPtr.Zero) CloseHandle(output);
      if(error!=IntPtr.Zero) CloseHandle(error);
      if(!resumed && info.Process!=IntPtr.Zero) { TerminateProcess(info.Process,1); WaitForSingleObject(info.Process,1000); }
      if(info.Thread!=IntPtr.Zero) CloseHandle(info.Thread);
      if(info.Process!=IntPtr.Zero) CloseHandle(info.Process);
      if(job!=IntPtr.Zero) CloseHandle(job);
      CloseHandle(parent);
    }
  }
}
`

/** Windows CRT quoting; .cmd operands are already escaped by cross-spawn. */
export function quoteWindowsJobArg(value: string): string {
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"'
}
const psLiteral = (value: string) => "'" + value.replace(/'/g, "''") + "'"

/** Caller must await prepareWindowsJob within its cancellable startup lifetime. */
export function spawnWindowsJob(command: string, args: string[], options: SpawnOptions): ChildProcess {
  // Isolate cross-spawn's pinned parser so npm shims retain their existing argv
  // behavior. Never trust ComSpec or PATH to select the Windows control shell.
  const cwd = options.cwd ? path.resolve(options.cwd instanceof NodeURL ? fileURLToPath(options.cwd) : options.cwd) : undefined
  const created = windowsJobOwner.created
  const parsed = require("cross-spawn")._parse(command, args, { ...options, shell: false })
  if (!parsed.file) throw Object.assign(new Error(`spawn ${command} ENOENT`), { code: "ENOENT" })
  const app = parsed.options.windowsVerbatimArguments ? windowsCmdExePath() : parsed.command === command ? parsed.file : parsed.command
  const line = quoteWindowsJobArg(app) + " " + (parsed.options.windowsVerbatimArguments ? parsed.args.join(" ") : parsed.args.map(quoteWindowsJobArg).join(" "))
  const targetEnv = options.env ?? { ...process.env }
  const encodedEnv = windowsTargetEnvironment(targetEnv).toString("base64")
  const controlEnv = { ...process.env }
  const existingKeys = [...Object.keys(controlEnv), ...Object.keys(targetEnv)].map(key => key.toUpperCase())
  let envPrefix: string
  do { envPrefix = `CMSPARK_OWNED_JOB_ENV_${randomBytes(16).toString("hex")}_` }
  while (existingKeys.some(key => key.startsWith(envPrefix.toUpperCase())))
  // Bound each carrier well below Windows' per-variable limit. Values never
  // appear in argv/EncodedCommand, and the target receives an explicit block.
  let envCount = 0
  for (let offset = 0; offset < encodedEnv.length; offset += 12000) controlEnv[envPrefix + envCount++] = encodedEnv.slice(offset, offset + 12000)
  // EncodedCommand leaves stdin exclusively for the configured protocol, and
  // embedding the fixed bootstrap also works in the SEA bundle without files.
  // Windows PowerShell's Add-Type compiler also starts a child and imposes a
  // legacy environment-size limit. Read/clear carriers before compiling, so
  // neither that compiler nor the target inherits the potentially large blob.
  const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $WarningPreference='SilentlyContinue'; try { $targetEnvironment=[Text.StringBuilder]::new(); for($i=0;$i -lt ${envCount};$i++){ $key=${psLiteral(envPrefix)}+$i; $piece=[Environment]::GetEnvironmentVariable($key); [Environment]::SetEnvironmentVariable($key,$null); if($null -eq $piece){throw 'Missing target environment carrier'}; [void]$targetEnvironment.Append($piece); $piece=$null }; Microsoft.PowerShell.Utility\\Add-Type -TypeDefinition @'\n${JOB_BOOTSTRAP}\n'@; exit ([CMsparkOwnedJob]::Run(${psLiteral(app)},${psLiteral(line)},${cwd ? psLiteral(cwd) : "$null"},${process.pid},[UInt64]::Parse('${created}'),$targetEnvironment.ToString())) } catch { [Console]::Error.WriteLine($_.Exception.ToString()); exit 1 }`
  const child = spawn(windowsPowerShellExePath(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    ...options, env: controlEnv, shell: false, windowsHide: true, windowsVerbatimArguments: false,
  })
  ownedJobChildren.add(child)
  return child
}
