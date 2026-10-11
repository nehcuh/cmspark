// Start an owned Windows process suspended, assign it to a non-inherited
// kill-on-close Job Object, then resume. Kernel ownership also covers a wrapper
// that exits before its descendants and a forcefully terminated Companion.
import { spawn, execFileSync, type ChildProcess, type SpawnOptions } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { windowsCmdExePath, windowsPowerShellExePath } from "../acp/win-spawn"

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
  static void Fail(string stage) { throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), stage); }
  public static int Run(string app, string line, string cwd, uint parentPid, ulong parentCreated) {
    IntPtr parent=OpenProcess(0x00101000,false,parentPid), job=IntPtr.Zero;
    ProcessInfo info=new ProcessInfo(); bool resumed=false;
    if(parent==IntPtr.Zero) Fail("OpenProcess(parent)");
    try {
      FileTime created, exited, kernel, user;
      if(!GetProcessTimes(parent,out created,out exited,out kernel,out user)) Fail("GetProcessTimes(parent)");
      if((((ulong)created.High<<32)|created.Low)!=parentCreated || WaitForSingleObject(parent,0)==0)
        throw new InvalidOperationException("Companion owner has exited or changed");
      job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero) Fail("CreateJobObject");
      Limits limits=new Limits(); limits.Basic.Flags=0x2000;
      if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Limits)))) Fail("SetInformationJobObject");
      Startup start=new Startup(); start.Size=(uint)Marshal.SizeOf(typeof(Startup)); start.Flags=0x100;
      start.Input=GetStdHandle(-10); start.Output=GetStdHandle(-11); start.Error=GetStdHandle(-12);
      if(!CreateProcess(app,new StringBuilder(line),IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,cwd,ref start,out info)) Fail("CreateProcess");
      if(!AssignProcessToJobObject(job,info.Process)) Fail("AssignProcessToJobObject");
      if(ResumeThread(info.Thread)==0xffffffff) Fail("ResumeThread");
      resumed=true;
      uint completed=WaitForMultipleObjects(2,new IntPtr[] { info.Process,parent },false,0xffffffff);
      if(completed==1) return 1; // Owner crash: closing our job still reclaims the complete tree.
      if(completed!=0) Fail("WaitForMultipleObjects");
      uint code; if(!GetExitCodeProcess(info.Process,out code)) Fail("GetExitCodeProcess");
      return unchecked((int)code);
    } finally {
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
let ownerCreated: string | undefined
function ownerCreationFileTime(): string {
  if (ownerCreated) return ownerCreated
  // Bind the launcher to this process instance, not a reusable PID. Control
  // binaries always use the host environment, never an MCP server's overrides.
  const value = execFileSync(windowsPowerShellExePath(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
    `(Get-Process -Id ${process.pid}).StartTime.ToUniversalTime().ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture)`],
    { encoding: "utf8", windowsHide: true, timeout: 10000 }).trim()
  if (!/^\d+$/.test(value)) throw new Error("Cannot establish Windows process ownership")
  return ownerCreated = value
}
const psLiteral = (value: string) => "'" + value.replace(/'/g, "''") + "'"

export function spawnWindowsJob(command: string, args: string[], options: SpawnOptions): ChildProcess {
  // Isolate cross-spawn's pinned parser so npm shims retain their existing argv
  // behavior. Never trust ComSpec or PATH to select the Windows control shell.
  const cwd = options.cwd ? path.resolve(options.cwd instanceof URL ? fileURLToPath(options.cwd) : options.cwd) : undefined
  const created = ownerCreationFileTime()
  const parsed = require("cross-spawn")._parse(command, args, { ...options, shell: false })
  if (!parsed.file) throw Object.assign(new Error(`spawn ${command} ENOENT`), { code: "ENOENT" })
  const app = parsed.options.windowsVerbatimArguments ? windowsCmdExePath() : parsed.command === command ? parsed.file : parsed.command
  const line = quoteWindowsJobArg(app) + " " + (parsed.options.windowsVerbatimArguments ? parsed.args.join(" ") : parsed.args.map(quoteWindowsJobArg).join(" "))
  // EncodedCommand leaves stdin exclusively for the configured protocol, and
  // embedding the fixed bootstrap also works in the SEA bundle without files.
  const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $WarningPreference='SilentlyContinue'; Add-Type -TypeDefinition @'\n${JOB_BOOTSTRAP}\n'@; try { exit ([CMsparkOwnedJob]::Run(${psLiteral(app)},${psLiteral(line)},${cwd ? psLiteral(cwd) : "$null"},${process.pid},[UInt64]::Parse('${created}'))) } catch { [Console]::Error.WriteLine($_.Exception.ToString()); exit 1 }`
  const child = spawn(windowsPowerShellExePath(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    ...options, shell: false, windowsHide: true, windowsVerbatimArguments: false,
  })
  ownedJobChildren.add(child)
  return child
}
