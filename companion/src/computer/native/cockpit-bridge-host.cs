// #723 D2 identity first vertical. This executable has no command execution,
// screen capture, input injection, window activation or mask operation.
// Windows/Chrome integration is a separate mandatory acceptance gate.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace CMspark.CockpitBridge {
  internal sealed class BridgeFault : Exception {
    internal readonly string Reason;
    internal BridgeFault(string reason) { Reason = reason; }
  }

  internal static class NativeFrame {
    internal const int MaximumBytes = 4096;
    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);

    // A clean EOF is distinct from a partial header/body. Never parse a prefix.
    internal static string Read(Stream input) {
      int first = input.ReadByte();
      if (first < 0) return null;
      byte[] header = new byte[4]; header[0] = (byte)first;
      Exact(input, header, 1, 3);
      uint count = (uint)header[0] | ((uint)header[1] << 8) |
                   ((uint)header[2] << 16) | ((uint)header[3] << 24);
      if (count == 0 || count > MaximumBytes) throw new BridgeFault("bridge_unavailable");
      byte[] body = new byte[(int)count]; Exact(input, body, 0, body.Length);
      try { return Utf8.GetString(body); }
      catch (DecoderFallbackException) { throw new BridgeFault("bridge_unavailable"); }
    }

    private static void Exact(Stream input, byte[] bytes, int offset, int count) {
      while (count > 0) {
        int n = input.Read(bytes, offset, count);
        if (n <= 0) throw new BridgeFault("bridge_unavailable");
        offset += n; count -= n;
      }
    }

    internal static void Write(Stream output, string json) {
      byte[] bytes = Utf8.GetBytes(json);
      if (bytes.Length == 0 || bytes.Length > MaximumBytes) throw new BridgeFault("bridge_unavailable");
      uint n = (uint)bytes.Length;
      output.Write(new byte[] { (byte)n, (byte)(n >> 8), (byte)(n >> 16), (byte)(n >> 24) }, 0, 4);
      output.Write(bytes, 0, bytes.Length); output.Flush();
    }
  }

  // This protocol accepts flat objects only. Do not use a permissive JSON
  // dictionary decoder which silently replaces duplicate keys.
  internal sealed class FlatJson {
    private readonly string text; private int at;
    private FlatJson(string text) { this.text = text; }
    internal static Dictionary<string, object> Read(string text) {
      FlatJson p = new FlatJson(text);
      Dictionary<string, object> fields = new Dictionary<string, object>(StringComparer.Ordinal);
      p.Space(); p.Expect('{'); p.Space();
      if (!p.Take('}')) {
        do {
          p.Space(); string key = p.String(); p.Space(); p.Expect(':'); p.Space();
          object value = p.at < text.Length && text[p.at] == '"' ? (object)p.String() : p.Integer();
          if (fields.ContainsKey(key)) throw new BridgeFault("bridge_unavailable");
          fields.Add(key, value); p.Space();
          if (p.Take('}')) break;
          p.Expect(',');
        } while (true);
      }
      p.Space(); if (p.at != text.Length) throw new BridgeFault("bridge_unavailable");
      return fields;
    }

    internal static string Quote(string value) {
      StringBuilder b = new StringBuilder("\"");
      foreach (char c in value) {
        if (c == '"' || c == '\\') { b.Append('\\'); b.Append(c); }
        else if (c < 32) b.Append("\\u" + ((int)c).ToString("x4", CultureInfo.InvariantCulture));
        else b.Append(c);
      }
      return b.Append('"').ToString();
    }

    private void Space() { while (at < text.Length && (text[at] == ' ' || text[at] == '\t' || text[at] == '\r' || text[at] == '\n')) at++; }
    private bool Take(char c) { if (at < text.Length && text[at] == c) { at++; return true; } return false; }
    private void Expect(char c) { if (!Take(c)) throw new BridgeFault("bridge_unavailable"); }
    private char HexChar() {
      if (at + 4 > text.Length) throw new BridgeFault("bridge_unavailable");
      int value = 0;
      for (int i = 0; i < 4; i++) {
        char c = text[at++]; int n = c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
        if (n < 0) throw new BridgeFault("bridge_unavailable"); value = (value << 4) | n;
      }
      return (char)value;
    }
    private string String() {
      Expect('"'); StringBuilder b = new StringBuilder();
      while (at < text.Length) {
        char c = text[at++];
        if (c == '"') return b.ToString();
        if (c < 32) throw new BridgeFault("bridge_unavailable");
        if (c == '\\') {
          if (at == text.Length) throw new BridgeFault("bridge_unavailable");
          c = text[at++];
          switch (c) {
            case '"': case '\\': case '/': b.Append(c); break;
            case 'b': b.Append('\b'); break; case 'f': b.Append('\f'); break;
            case 'n': b.Append('\n'); break; case 'r': b.Append('\r'); break; case 't': b.Append('\t'); break;
            case 'u':
              char decoded = HexChar();
              if (char.IsLowSurrogate(decoded)) throw new BridgeFault("bridge_unavailable");
              b.Append(decoded);
              if (char.IsHighSurrogate(decoded)) {
                Expect('\\'); Expect('u'); char low = HexChar();
                if (!char.IsLowSurrogate(low)) throw new BridgeFault("bridge_unavailable"); b.Append(low);
              }
              break;
            default: throw new BridgeFault("bridge_unavailable");
          }
        } else {
          if (char.IsLowSurrogate(c)) throw new BridgeFault("bridge_unavailable");
          b.Append(c);
          if (char.IsHighSurrogate(c)) {
            if (at == text.Length || !char.IsLowSurrogate(text[at])) throw new BridgeFault("bridge_unavailable");
            b.Append(text[at++]);
          }
        }
      }
      throw new BridgeFault("bridge_unavailable");
    }
    private long Integer() {
      int start = at;
      Take('-');
      if (Take('0')) {
        if (at < text.Length && text[at] >= '0' && text[at] <= '9') throw new BridgeFault("bridge_unavailable");
      } else {
        if (at == text.Length || text[at] < '1' || text[at] > '9') throw new BridgeFault("bridge_unavailable");
        while (at < text.Length && text[at] >= '0' && text[at] <= '9') at++;
      }
      long value;
      if (!long.TryParse(text.Substring(start, at - start), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out value)) throw new BridgeFault("bridge_unavailable");
      return value;
    }
  }

  internal static class NativeApi {
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr GetStdHandle(int index);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint GetFileType(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetNamedPipeServerProcessId(IntPtr pipe, out uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] internal static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] internal static extern bool CloseHandle(IntPtr handle);
    [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)] internal static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool SetPropW(IntPtr hwnd, string key, IntPtr value);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr GetPropW(IntPtr hwnd, string key);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr RemovePropW(IntPtr hwnd, string key);
  }

  internal sealed class NativeWindowLease : IDisposable {
    internal readonly IntPtr Hwnd;
    internal readonly uint Pid, Tid;
    internal readonly string TagKey, TagValue;
    private readonly IntPtr value;
    private IntPtr process;
    private bool installed, disposed;

    internal NativeWindowLease(IntPtr hwnd) {
      Hwnd = hwnd;
      uint inputPid, outputPid;
      IntPtr input = NativeApi.GetStdHandle(-10), output = NativeApi.GetStdHandle(-11);
      if (NativeApi.GetFileType(input) != 3 || NativeApi.GetFileType(output) != 3 ||
          !NativeApi.GetNamedPipeServerProcessId(input, out inputPid) ||
          !NativeApi.GetNamedPipeServerProcessId(output, out outputPid) ||
          inputPid == 0 || inputPid != outputPid || !NativeApi.IsWindow(hwnd)) throw new BridgeFault("window_lifetime_unknown");
      uint windowPid; uint windowTid = NativeApi.GetWindowThreadProcessId(hwnd, out windowPid);
      if (windowTid == 0 || windowPid != inputPid) throw new BridgeFault("window_lifetime_unknown");
      Pid = windowPid; Tid = windowTid;
      byte[] token = new byte[24];
      using (RandomNumberGenerator rng = RandomNumberGenerator.Create()) rng.GetBytes(token);
      TagKey = "CMspark.Cockpit.D2." + BitConverter.ToString(token, 0, 16).Replace("-", "").ToLowerInvariant();
      ulong number = BitConverter.ToUInt64(token, 16);
      if (IntPtr.Size != 8) throw new BridgeFault("window_lifetime_unknown");
      if (number == 0) number = 1;
      value = new IntPtr(unchecked((long)number)); TagValue = number.ToString(CultureInfo.InvariantCulture);
      process = NativeApi.OpenProcess(0x00100000 | 0x00001000, false, Pid); // SYNCHRONIZE | QUERY_LIMITED_INFORMATION
      if (process == IntPtr.Zero) throw new BridgeFault("window_lifetime_unknown");
      try {
        VerifyProcessAndWindow();
        if (NativeApi.GetPropW(Hwnd, TagKey) != IntPtr.Zero || !NativeApi.SetPropW(Hwnd, TagKey, value)) throw new BridgeFault("window_lifetime_unknown");
        installed = true;
        Verify();
      } catch { Dispose(); throw; }
    }

    private void VerifyProcessAndWindow() {
      uint pid;
      if (disposed || process == IntPtr.Zero || NativeApi.WaitForSingleObject(process, 0) != 258 ||
          !NativeApi.IsWindow(Hwnd) || NativeApi.GetWindowThreadProcessId(Hwnd, out pid) != Tid || pid != Pid) throw new BridgeFault("window_lifetime_unknown");
    }
    internal void Verify() {
      VerifyProcessAndWindow();
      if (!installed || NativeApi.GetPropW(Hwnd, TagKey) != value) throw new BridgeFault("window_lifetime_unknown");
      VerifyProcessAndWindow();
      if (NativeApi.GetPropW(Hwnd, TagKey) != value) throw new BridgeFault("window_lifetime_unknown");
    }
    public void Dispose() {
      if (disposed) return;
      disposed = true;
      // Unique key/value only. There is no Win32 compare-and-remove primitive;
      // do not claim this check locks an HWND object or closes every race.
      if (installed && NativeApi.GetPropW(Hwnd, TagKey) == value) NativeApi.RemovePropW(Hwnd, TagKey);
      installed = false;
      if (process != IntPtr.Zero) { NativeApi.CloseHandle(process); process = IntPtr.Zero; }
    }
  }

  internal sealed class NativeBind {
    internal readonly string OwnerNonce, Challenge, DocumentId;
    internal readonly long WindowId;
    internal NativeBind(string owner, string challenge, string document, long window) {
      OwnerNonce = owner; Challenge = challenge; DocumentId = document; WindowId = window;
    }
  }

  internal static class Program {
    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
    private static readonly string[] BoundKeys = { "v", "op", "ownerNonce", "challenge", "documentId", "windowId" };
    private static readonly string[] DisposeKeys = { "v", "op", "ownerNonce", "portNonce" };

    private static bool Alphabet(string value, int count, char low, char high) {
      if (value == null || value.Length != count) return false;
      foreach (char c in value) if (c < low || c > high) return false;
      return true;
    }
    private static bool Hex(string value, int count) {
      if (value == null || value.Length != count) return false;
      foreach (char c in value) if (!(c >= '0' && c <= '9') && !(c >= 'a' && c <= 'f')) return false;
      return true;
    }
    private static string Text(Dictionary<string, object> fields, string key) {
      object value;
      if (!fields.TryGetValue(key, out value) || !(value is string)) throw new BridgeFault("bridge_unavailable");
      return (string)value;
    }
    private static long Number(Dictionary<string, object> fields, string key) {
      object value;
      if (!fields.TryGetValue(key, out value) || !(value is long)) throw new BridgeFault("bridge_unavailable");
      return (long)value;
    }
    private static void ExactKeys(Dictionary<string, object> fields, string[] expected) {
      if (fields.Count != expected.Length) throw new BridgeFault("bridge_unavailable");
      foreach (string key in expected) if (!fields.ContainsKey(key)) throw new BridgeFault("bridge_unavailable");
    }
    private static string RandomHex(int count) {
      byte[] bytes = new byte[count]; using (RandomNumberGenerator rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
      return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
    }
    private static string ReadRegular(string path) {
      FileInfo file = new FileInfo(path);
      if (!file.Exists || (file.Attributes & FileAttributes.ReparsePoint) != 0 || file.Length == 0 || file.Length > 4096) throw new BridgeFault("bridge_unavailable");
      using (FileStream input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read)) {
        if (input.Length == 0 || input.Length > NativeFrame.MaximumBytes) throw new BridgeFault("bridge_unavailable");
        byte[] bytes = new byte[NativeFrame.MaximumBytes + 1]; int count = 0, n;
        while (count < bytes.Length && (n = input.Read(bytes, count, bytes.Length - count)) > 0) count += n;
        if (count == 0 || count > NativeFrame.MaximumBytes) throw new BridgeFault("bridge_unavailable");
        return Utf8.GetString(bytes, 0, count);
      }
    }

    // Exact one-ID installation record, never a command-line override. The
    // installed helper writes this record beside its one fixed manifest.
    private static void CheckRegistration(string origin) {
      if (origin.Length != 52 || !origin.StartsWith("chrome-extension://", StringComparison.Ordinal) || !origin.EndsWith("/", StringComparison.Ordinal) ||
          !Alphabet(origin.Substring(19, 32), 32, 'a', 'p')) throw new BridgeFault("bridge_unavailable");
      string executable = System.Reflection.Assembly.GetExecutingAssembly().Location;
      string install = Directory.GetParent(Path.GetDirectoryName(executable)).FullName;
      string folder = Path.Combine(install, "native-messaging");
      if ((File.GetAttributes(folder) & FileAttributes.ReparsePoint) != 0) throw new BridgeFault("bridge_unavailable");
      string manifest = Path.Combine(folder, "com.cmspark.cockpit.json");
      Dictionary<string, object> record = FlatJson.Read(ReadRegular(Path.Combine(folder, "registration.json")));
      ExactKeys(record, new string[] { "v", "installId", "extensionId", "hostPath", "hostSha256", "manifestPath", "manifestSha256", "registryView" });
      string view = Text(record, "registryView");
      if (Number(record, "v") != 1 || !Hex(Text(record, "installId"), 32) || !Hex(Text(record, "hostSha256"), 64) || !Hex(Text(record, "manifestSha256"), 64) ||
          Text(record, "extensionId") != origin.Substring(19, 32) || Text(record, "hostPath") != executable || Text(record, "manifestPath") != manifest ||
          (view != "Registry32" && view != "Registry64")) throw new BridgeFault("bridge_unavailable");
      byte[] manifestBytes = Utf8.GetBytes(ReadRegular(manifest));
      using (SHA256 hash = SHA256.Create())
      using (FileStream ownBytes = new FileStream(executable, FileMode.Open, FileAccess.Read, FileShare.Read)) {
        if (BitConverter.ToString(hash.ComputeHash(ownBytes)).Replace("-", "").ToLowerInvariant() != Text(record, "hostSha256") ||
            BitConverter.ToString(hash.ComputeHash(manifestBytes)).Replace("-", "").ToLowerInvariant() != Text(record, "manifestSha256")) throw new BridgeFault("bridge_unavailable");
      }
      string keyName = "Software\\Google\\Chrome\\NativeMessagingHosts\\com.cmspark.cockpit";
      bool found = false;
      foreach (RegistryView current in new RegistryView[] { RegistryView.Registry32, RegistryView.Registry64 }) {
        using (RegistryKey root = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, current))
        using (RegistryKey key = root.OpenSubKey(keyName, false)) {
          if (key == null) continue;
          // HKCU\Software is shared across WOW64 views; the same exact
          // owned key can be observed twice. A different value is still refused.
          if (key.GetValueKind("") != RegistryValueKind.String || (key.GetValue("") as string) != manifest || key.SubKeyCount != 0 || key.ValueCount != 1) throw new BridgeFault("bridge_unavailable");
          found = true;
        }
      }
      if (!found) throw new BridgeFault("bridge_unavailable");
    }

    private static IntPtr Parent(string[] args) {
      if (args.Length != 2 || !args[1].StartsWith("--parent-window=", StringComparison.Ordinal)) throw new BridgeFault("bridge_unavailable");
      string digits = args[1].Substring(16);
      if (digits.Length == 0 || digits.Length > 20 || digits[0] == '0') throw new BridgeFault("bridge_unavailable");
      foreach (char c in digits) if (c < '0' || c > '9') throw new BridgeFault("bridge_unavailable");
      long number;
      if (IntPtr.Size != 8 || !long.TryParse(digits, NumberStyles.None, CultureInfo.InvariantCulture, out number) || number <= 0) throw new BridgeFault("bridge_unavailable");
      CheckRegistration(args[0]);
      return new IntPtr(number);
    }

    internal static NativeBind ParseBind(string json) {
      Dictionary<string, object> bind = FlatJson.Read(json); ExactKeys(bind, BoundKeys);
      string owner = Text(bind, "ownerNonce"), challenge = Text(bind, "challenge"), document = Text(bind, "documentId");
      long window = Number(bind, "windowId");
      if (Number(bind, "v") != 1 || Text(bind, "op") != "bind" || !Hex(owner, 32) || !Hex(challenge, 64) ||
          document.Length == 0 || document.Length > 128 || window < 1 || window > Int32.MaxValue) throw new BridgeFault("bridge_unavailable");
      foreach (char c in document) if (c < 33 || c > 126) throw new BridgeFault("bridge_unavailable");
      return new NativeBind(owner, challenge, document, window);
    }

    internal static string BoundReply(NativeBind bind, string port, string hwnd, string tag, uint pid, uint tid) {
      // Sole successful wire producer. Main supplies native query results;
      // controlled C# tests may exercise this serializer without Win32 calls.
      return "{\"v\":1,\"op\":\"bound\",\"ownerNonce\":" + FlatJson.Quote(bind.OwnerNonce) +
        ",\"challenge\":" + FlatJson.Quote(bind.Challenge) + ",\"documentId\":" + FlatJson.Quote(bind.DocumentId) +
        ",\"windowId\":" + bind.WindowId.ToString(CultureInfo.InvariantCulture) + ",\"portNonce\":" + FlatJson.Quote(port) +
        ",\"hwndDecimal\":" + FlatJson.Quote(hwnd) + ",\"tagValue\":" + FlatJson.Quote(tag) +
        ",\"pid\":" + pid.ToString(CultureInfo.InvariantCulture) + ",\"tid\":" + tid.ToString(CultureInfo.InvariantCulture) + "}";
    }

    public static int Main(string[] args) {
      Stream output = Console.OpenStandardOutput(); NativeWindowLease lease = null;
      try {
        IntPtr parent = Parent(args);
        Stream input = Console.OpenStandardInput();
        // Only the first read has a new 5s bind budget. This background reader
        // performs no native effects; an expired bind never later creates a tag.
        Task<string> pending = Task.Factory.StartNew(delegate { return NativeFrame.Read(input); });
        if (!pending.Wait(5000)) throw new BridgeFault("bridge_unavailable");
        string first = pending.Result;
        if (first == null) return 1;
        NativeBind bind = ParseBind(first);
        string owner = bind.OwnerNonce;
        lease = new NativeWindowLease(parent); string port = RandomHex(16); lease.Verify();
        // Eleven exact keys, matching protocol-contract-root-names.json. No
        // tagKey or arbitrary exception/argv/registry detail crosses the port.
        NativeFrame.Write(output, BoundReply(bind, port, parent.ToInt64().ToString(CultureInfo.InvariantCulture), lease.TagValue, lease.Pid, lease.Tid));
        string next = NativeFrame.Read(input);
        if (next == null) return 0; // original native port ended; finally owns cleanup
        Dictionary<string, object> dispose = FlatJson.Read(next); ExactKeys(dispose, DisposeKeys);
        if (Number(dispose, "v") != 1 || Text(dispose, "op") != "dispose" || Text(dispose, "ownerNonce") != owner || Text(dispose, "portNonce") != port) throw new BridgeFault("bridge_unavailable");
        return 0;
      } catch {
        // Fixed, bounded refusal only. Pipe failure is UNKNOWN, never argv-only
        // identity, and never a reason to leak an error/handle/path/receipt.
        // Finish own metadata cleanup before emitting refusal: the browser may
        // close its port immediately when it receives this terminal reply.
        if (lease != null) { try { lease.Dispose(); } catch { } lease = null; }
        try { NativeFrame.Write(output, "{\"v\":1,\"op\":\"unavailable\",\"reason\":\"bridge_unavailable\"}"); } catch { }
        return 1;
      } finally { if (lease != null) lease.Dispose(); }
    }
  }
}
