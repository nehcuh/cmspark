// Actual test-isolation admission/completion consumer only. Never invokes a
// JobApi P/Invoke, Chrome, Native Messaging, or the product host Main.
using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
namespace CMspark.CockpitBridge.TestOnly {
  internal static class ChromeJobCpu {
    private static int passed;
    private static void Check(bool value) { if (!value) throw new InvalidOperationException("COCKPIT_BRIDGE_JOB_CPU_ASSERT"); passed++; }
    private static void Refused(Action action) { bool refused = false; try { action(); } catch (InvalidOperationException) { refused = true; } Check(refused); }
    private static bool Completion(long[] time, CompletionPacket[] packets) {
      int clock = 0, index = 0;
      return JobCompletion.WaitForEmpty(new IntPtr(1), delegate { return (int)time[Math.Min(clock++, time.Length - 1)]; }, delegate(uint ms) {
        if (index == packets.Length) return new CompletionPacket(false, 0, IntPtr.Zero);
        return packets[index++];
      });
    }
    public static int Main(string[] ignored) {
      string root = Environment.GetEnvironmentVariable("CMSPARK_TEST_RUN_DIR"), scope = null; JobInput parsed = null;
      try {
        if (Environment.OSVersion.Platform != PlatformID.Win32NT || Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true" || Environment.GetEnvironmentVariable("RUNNER_OS") != "Windows" || !Path.IsPathRooted(root)) throw new InvalidOperationException();
        Check(!Completion(new long[] { 100 }, new CompletionPacket[] { new CompletionPacket(true, 7, new IntPtr(1)) })); // initial/root EXIT_PROCESS is not a tree receipt
        Check(!Completion(new long[] { 100 }, new CompletionPacket[] { new CompletionPacket(true, 4, new IntPtr(2)) })); // wrong job
        Check(!Completion(new long[] { 100 }, new CompletionPacket[] { new CompletionPacket(false, 4, new IntPtr(1)) })); // failed dequeue cannot launder data
        Check(!Completion(new long[] { 0 }, new CompletionPacket[] { new CompletionPacket(true, 4, new IntPtr(1)) })); // expired before wait
        Check(!Completion(new long[] { 100, 0 }, new CompletionPacket[] { new CompletionPacket(true, 4, new IntPtr(1)) })); // receipt after deadline
        Check(Completion(new long[] { 100 }, new CompletionPacket[] { new CompletionPacket(true, 7, new IntPtr(1)), new CompletionPacket(true, 4, new IntPtr(1)) }));
        Check(JobCompletion.Quote("C:\\owned path\\") == "\"C:\\owned path\\\\\"");
        Check(JobCompletion.Quote("a\"b") == "\"a\\\"b\"");
        // The real JobInput.Parse constructor checks owned files/claim/hash;
        // this fixture supplies inert bytes and never calls CreateProcess.
        scope = Path.Combine(root, "chrome-job-cpu-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(scope);
        string binary = Path.Combine(scope, "not-executable.fixture"), extension = Path.Combine(scope, "extension"), profile = Path.Combine(scope, "profile");
        Directory.CreateDirectory(extension); Directory.CreateDirectory(profile); File.WriteAllText(binary, "controlled CPU input, never executed", new UTF8Encoding(false));
        string hash; using (SHA256 sha = SHA256.Create()) using (FileStream input = File.OpenRead(binary)) hash = BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
        // The Node lease deliberately retains its wx+ writer until teardown.
        // Framework ReadAllText shares only Read and must fail against it.
        bool legacyShareRefused = false;
        try { File.ReadAllText(Path.Combine(root, "native-surface-650", "claim"), Encoding.ASCII); }
        catch (IOException error) { legacyShareRefused = (error.HResult & 0xffff) == 32; }
        Check(legacyShareRefused);
        string nonce;
        using (FileStream claim = new FileStream(Path.Combine(root, "native-surface-650", "claim"), FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        using (StreamReader reader = new StreamReader(claim, Encoding.ASCII, true)) nonce = reader.ReadToEnd();
        long now = (DateTime.UtcNow.Ticks - 621355968000000000L) / 10000;
        string[] args = { root, binary, hash, extension, profile, nonce, (now + 45000).ToString(System.Globalization.CultureInfo.InvariantCulture) };
        parsed = JobInput.Parse(args, now); parsed.CheckClaim(); Check(parsed.FixedArguments().Length == 5);
        Check(parsed.FixedArguments()[1] == "--user-data-dir=" + profile && parsed.FixedArguments()[2] == "--remote-debugging-port=0" && parsed.FixedArguments()[3] == "--load-extension=" + extension);
        string[] wrong = (string[])args.Clone(); wrong[2] = new string('0', 64); Refused(delegate { JobInput.Parse(wrong, now); });
        wrong = (string[])args.Clone(); wrong[5] = new string('0', 64); Refused(delegate { JobInput.Parse(wrong, now); });
        wrong = (string[])args.Clone(); wrong[6] = now.ToString(System.Globalization.CultureInfo.InvariantCulture); Refused(delegate { JobInput.Parse(wrong, now); });
        wrong = (string[])args.Clone(); wrong[4] = root; Refused(delegate { JobInput.Parse(wrong, now); });
        File.WriteAllText(Path.Combine(profile, "foreign"), "keep"); Refused(delegate { JobInput.Parse(args, now); }); File.Delete(Path.Combine(profile, "foreign"));
        Console.WriteLine("{\"kind\":\"owned-chrome-job-controlled-cpu\",\"passed\":" + passed + ",\"native\":\"NOT_RUN\"}"); return 0;
      } catch { Console.Error.WriteLine("COCKPIT_BRIDGE_JOB_CPU_FAILED"); return 1; }
      finally { if (parsed != null) parsed.Dispose(); if (scope != null && Directory.Exists(scope)) Directory.Delete(scope, true); }
    }
  }
}
