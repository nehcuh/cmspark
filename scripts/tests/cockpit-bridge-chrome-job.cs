// Remote test isolation only. No product spawn API, attach, PID enumeration,
// breakaway, taskkill or process-name cleanup. Windows native acceptance NOT_RUN.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;

namespace CMspark.CockpitBridge.TestOnly {
  internal struct CompletionPacket {
    internal bool Success; internal uint Message; internal IntPtr Key;
    internal CompletionPacket(bool success, uint message, IntPtr key) { Success = success; Message = message; Key = key; }
  }
  internal static class JobCompletion {
    internal const uint ActiveProcessZero = 4;
    // The real GetQueuedCompletionStatus consumes this job's already-associated
    // port. A main-process exit or a packet for another key is never empty.
    internal static bool WaitForEmpty(IntPtr ownKey, Func<int> remaining, Func<uint, CompletionPacket> read) {
      while (true) {
        int ms = remaining(); if (ms <= 0) return false;
        CompletionPacket packet = read((uint)ms);
        if (!packet.Success) return false;
        if (packet.Key == ownKey && packet.Message == ActiveProcessZero) return remaining() > 0;
      }
    }
    internal static string Quote(string value) {
      StringBuilder b = new StringBuilder("\""); int slashes = 0;
      foreach (char c in value) {
        if (c == '\\') { slashes++; continue; }
        if (c == '"') b.Append('\\', slashes * 2 + 1);
        else b.Append('\\', slashes);
        slashes = 0; b.Append(c);
      }
      b.Append('\\', slashes * 2); return b.Append('"').ToString();
    }
  }
  internal static class JobApi {
    [StructLayout(LayoutKind.Sequential)] public struct BasicLimits {
      public long PerProcessUserTime, PerJobUserTime; public uint Flags;
      public UIntPtr MinimumWorkingSet, MaximumWorkingSet; public uint ActiveProcessLimit;
      public UIntPtr Affinity; public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] public struct IoCounters {
      public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] public struct ExtendedLimits {
      public BasicLimits Basic; public IoCounters Io;
      public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] public struct Association { public IntPtr Key, Port; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct Startup {
      public uint Size; public string Reserved, Desktop, Title;
      public uint X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags;
      public ushort ShowWindow, ReservedBytes; public IntPtr ReservedPointer, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] public struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr CreateIoCompletionPort(IntPtr file, IntPtr existingPort, UIntPtr key, uint threads);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetQueuedCompletionStatus(IntPtr port, out uint bytes, out IntPtr key, out IntPtr overlapped, uint ms);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref Startup startup, out ProcessInfo info);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll")] internal static extern uint WaitForSingleObject(IntPtr handle, uint ms);
    [DllImport("kernel32.dll")] internal static extern bool CloseHandle(IntPtr handle);
  }
  internal sealed class JobInput : IDisposable {
    internal readonly string Root, Browser, Extension, Profile, ClaimNonce;
    private readonly long budgetMs;
    private readonly Stopwatch clock;
    private readonly FileStream pinnedBrowser;
    private JobInput(string root, string browser, string extension, string profile, string nonce, long budget, Stopwatch watch, FileStream pin) {
      Root = root; Browser = browser; Extension = extension; Profile = profile; ClaimNonce = nonce;
      budgetMs = budget; clock = watch; pinnedBrowser = pin;
    }
    internal int Remaining() { long value = budgetMs - clock.ElapsedMilliseconds; return value <= 0 ? 0 : (int)Math.Min(value, Int32.MaxValue); }
    public void Dispose() { pinnedBrowser.Dispose(); }
    private static void Require(bool value) { if (!value) throw new InvalidOperationException("COCKPIT_BRIDGE_JOB_ADMISSION_REFUSED"); }
    private static string DirectoryPath(string value) {
      Require(Path.IsPathRooted(value)); string full = Path.GetFullPath(value).TrimEnd(Path.DirectorySeparatorChar);
      DirectoryInfo info = new DirectoryInfo(full); Require(info.Exists && (info.Attributes & FileAttributes.ReparsePoint) == 0);
      // Reject every reparse ancestor, not only the final component.
      for (DirectoryInfo parent = info.Parent; parent != null; parent = parent.Parent) Require((parent.Attributes & FileAttributes.ReparsePoint) == 0);
      return full;
    }
    private static bool Hex(string value, int count) {
      if (value == null || value.Length != count) return false;
      foreach (char c in value) if (!(c >= '0' && c <= '9') && !(c >= 'a' && c <= 'f')) return false;
      return true;
    }
    internal static JobInput Parse(string[] args, long now) {
      Stopwatch clock = Stopwatch.StartNew();
      Require(Environment.OSVersion.Platform == PlatformID.Win32NT && IntPtr.Size == 8 &&
        Environment.GetEnvironmentVariable("GITHUB_ACTIONS") == "true" && Environment.GetEnvironmentVariable("RUNNER_OS") == "Windows");
      // root/browser/hash/extension/profile/claim/deadline; no arbitrary argv.
      Require(args.Length == 7 && Hex(args[2], 64) && Hex(args[5], 64));
      string root = DirectoryPath(args[0]), browser = Path.GetFullPath(args[1]), extension = DirectoryPath(args[3]), profile = DirectoryPath(args[4]);
      Require(Path.IsPathRooted(args[1]) && DirectoryPath(Path.GetDirectoryName(browser)) != null);
      FileInfo binary = new FileInfo(browser); Require(binary.Exists && (binary.Attributes & FileAttributes.ReparsePoint) == 0 && binary.Length > 0);
      Require(String.Equals(root, DirectoryPath(Environment.GetEnvironmentVariable("CMSPARK_TEST_RUN_DIR") ?? ""), StringComparison.OrdinalIgnoreCase) && Path.GetFileName(root).StartsWith("cmspark-test-run-", StringComparison.Ordinal));
      Require(profile.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && Directory.GetFileSystemEntries(profile).Length == 0);
      Require(extension.IndexOf(',') < 0 && extension.Length <= 1024 && browser.Length <= 1024 && profile.Length <= 1024);
      foreach (string value in args) Require(value.IndexOf('\0') < 0 && value.IndexOf('\r') < 0 && value.IndexOf('\n') < 0);
      long deadline; Require(long.TryParse(args[6], NumberStyles.None, CultureInfo.InvariantCulture, out deadline) && deadline > now && deadline - now <= 45000);
      FileStream pin = new FileStream(browser, FileMode.Open, FileAccess.Read, FileShare.Read);
      try {
        using (SHA256 hash = SHA256.Create()) Require(BitConverter.ToString(hash.ComputeHash(pin)).Replace("-", "").ToLowerInvariant() == args[2]);
        JobInput parsed = new JobInput(root, browser, extension, profile, args[5], deadline - now, clock, pin);
        parsed.CheckClaim(); return parsed;
      } catch { pin.Dispose(); throw; }
    }
    internal void CheckClaim() {
      DirectoryPath(Root); string claimRoot = DirectoryPath(Path.Combine(Root, "native-surface-650")), claim = Path.Combine(claimRoot, "claim");
      FileInfo info = new FileInfo(claim); Require(info.Exists && (info.Attributes & FileAttributes.ReparsePoint) == 0 && info.Length == 64);
      using (FileStream input = new FileStream(claim, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) {
        Require(input.Length == 64); byte[] bytes = new byte[65]; int count = 0, n;
        while (count < bytes.Length && (n = input.Read(bytes, count, bytes.Length - count)) > 0) count += n;
        Require(count == 64 && Encoding.ASCII.GetString(bytes, 0, count) == ClaimNonce);
      }
    }
    internal string[] FixedArguments() { return new string[] { Browser, "--user-data-dir=" + Profile, "--remote-debugging-port=0", "--load-extension=" + Extension, "about:blank" }; }
    internal string EnvironmentBlock() {
      string systemRoot = DirectoryPath(Environment.GetEnvironmentVariable("SystemRoot") ?? ""), temporary = Path.Combine(Root, "chrome-job-temp");
      Require(!Directory.Exists(temporary)); Directory.CreateDirectory(temporary); DirectoryPath(temporary);
      SortedDictionary<string, string> fields = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
      fields.Add("SystemRoot", systemRoot); fields.Add("WINDIR", systemRoot); fields.Add("PATH", Path.Combine(systemRoot, "System32")); fields.Add("TEMP", temporary); fields.Add("TMP", temporary);
      fields.Add("ComSpec", Path.Combine(systemRoot, "System32", "cmd.exe"));
      StringBuilder result = new StringBuilder(); foreach (KeyValuePair<string, string> field in fields) result.Append(field.Key).Append('=').Append(field.Value).Append('\0');
      return result.Append('\0').ToString();
    }
  }
  internal static class ChromeJob {
    private static long Now() { return (DateTime.UtcNow.Ticks - 621355968000000000L) / 10000; }
    private static int Remaining(JobInput input) { return input.Remaining(); }
    private static void SetInfo<T>(IntPtr job, int kind, T info) where T : struct {
      int bytes = Marshal.SizeOf(typeof(T)); IntPtr memory = Marshal.AllocHGlobal(bytes);
      try { Marshal.StructureToPtr(info, memory, false); if (!JobApi.SetInformationJobObject(job, kind, memory, (uint)bytes)) throw new InvalidOperationException("COCKPIT_BRIDGE_JOB_REFUSED"); }
      finally { Marshal.FreeHGlobal(memory); }
    }
    private static bool Cleanup(IntPtr job, IntPtr port, IntPtr key, JobInput input) {
      if (!JobApi.TerminateJobObject(job, 1)) return false;
      return JobCompletion.WaitForEmpty(key, delegate { return Remaining(input); }, delegate(uint ms) {
        uint message; IntPtr completionKey, processValue;
        bool success = JobApi.GetQueuedCompletionStatus(port, out message, out completionKey, out processValue, ms);
        return new CompletionPacket(success, message, completionKey);
      });
    }
    private static bool CleanupCommand(Stream input) {
      byte[] expected = Encoding.ASCII.GetBytes("cleanup\n");
      foreach (byte value in expected) if (input.ReadByte() != value) return false;
      return true;
    }
    public static int Main(string[] args) {
      IntPtr job = IntPtr.Zero, port = IntPtr.Zero, environment = IntPtr.Zero, key = new IntPtr(1);
      JobApi.ProcessInfo process = new JobApi.ProcessInfo(); JobInput input = null;
      bool assigned = false, started = false, cleanup = false, successful = false;
      try {
        input = JobInput.Parse(args, Now()); input.CheckClaim();
        job = JobApi.CreateJobObjectW(IntPtr.Zero, null); if (job == IntPtr.Zero) throw new InvalidOperationException();
        port = JobApi.CreateIoCompletionPort(new IntPtr(-1), IntPtr.Zero, UIntPtr.Zero, 1); if (port == IntPtr.Zero) throw new InvalidOperationException();
        JobApi.Association association = new JobApi.Association(); association.Key = key; association.Port = port;
        SetInfo(job, 7, association); // Associate before the first process assignment.
        JobApi.ExtendedLimits limits = new JobApi.ExtendedLimits(); limits.Basic.Flags = 0x00002000; // KILL_ON_JOB_CLOSE; no breakaway flags.
        SetInfo(job, 9, limits);
        string[] fixedArgs = input.FixedArguments(); StringBuilder command = new StringBuilder();
        foreach (string arg in fixedArgs) { if (command.Length != 0) command.Append(' '); command.Append(JobCompletion.Quote(arg)); }
        environment = Marshal.StringToHGlobalUni(input.EnvironmentBlock());
        JobApi.Startup startup = new JobApi.Startup(); startup.Size = (uint)Marshal.SizeOf(typeof(JobApi.Startup));
        input.CheckClaim(); if (Remaining(input) <= 0 || !JobApi.CreateProcessW(input.Browser, command, IntPtr.Zero, IntPtr.Zero, false, 0x00000004 | 0x00000400, environment, input.Profile, ref startup, out process)) throw new InvalidOperationException();
        // Initial thread is still suspended. Assignment failure must never run it.
        if (!JobApi.AssignProcessToJobObject(job, process.Process)) throw new InvalidOperationException(); assigned = true;
        input.CheckClaim(); if (Remaining(input) <= 0 || JobApi.ResumeThread(process.Thread) == 0xffffffff) throw new InvalidOperationException(); started = true;
        Console.WriteLine("{\"kind\":\"owned-chrome-job\",\"stage\":\"started\"}"); Console.Out.Flush();
        Task<bool> commandRead = Task.Factory.StartNew(delegate { return CleanupCommand(Console.OpenStandardInput()); });
        if (!commandRead.Wait(Remaining(input)) || !commandRead.Result) throw new InvalidOperationException();
        successful = true;
      } catch { successful = false; }
      finally {
        // Terminate the entire assigned job, then wait for this same job's
        // ACTIVE_PROCESS_ZERO within the original outer remaining budget.
        // Closing a KILL_ON_JOB_CLOSE handle alone is never cleanup=true.
        if (assigned) { try { cleanup = Cleanup(job, port, key, input); } catch { cleanup = false; } }
        else if (process.Process != IntPtr.Zero) {
          // Failed assignment: only our never-resumed initial process exists.
          // It must be terminated and observed signaled; this is not a native
          // positive and does not emit the job-empty success receipt.
          try { JobApi.TerminateProcess(process.Process, 1); JobApi.WaitForSingleObject(process.Process, (uint)Remaining(input)); } catch { }
        }
        if (process.Thread != IntPtr.Zero) JobApi.CloseHandle(process.Thread);
        if (process.Process != IntPtr.Zero) JobApi.CloseHandle(process.Process);
        if (job != IntPtr.Zero) JobApi.CloseHandle(job);
        if (port != IntPtr.Zero) JobApi.CloseHandle(port);
        if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
        if (input != null) input.Dispose();
      }
      try { Console.WriteLine(cleanup ? "{\"kind\":\"owned-chrome-job\",\"cleanup\":true}" : "{\"kind\":\"owned-chrome-job\",\"cleanup\":false}"); Console.Out.Flush(); } catch { return 1; }
      return successful && started && cleanup ? 0 : 1;
    }
  }
}
