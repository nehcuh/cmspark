// Compile with the actual host source and /main:CMspark.CockpitBridge.FramingTests.
// CPU-only C# contract checks. These never construct NativeWindowLease or call
// Main/Win32/registry; they do not prove a native browser port or pipe API.
using System;
using System.IO;
using System.Text;

namespace CMspark.CockpitBridge {
  internal static class FramingTests {
    private static int passed;
    private static void Check(bool value) { if (!value) throw new Exception("COCKPIT_BRIDGE_FRAMING_ASSERT"); passed++; }
    private static void Refused(Action run) {
      try { run(); } catch (BridgeFault e) { Check(e.Reason == "bridge_unavailable"); return; }
      throw new Exception("COCKPIT_BRIDGE_FRAMING_EXPECTED_REFUSAL");
    }
    private static MemoryStream Bytes(params byte[] bytes) { return new MemoryStream(bytes); }
    private static string Bind(string tail) {
      return "{\"v\":1,\"op\":\"bind\",\"ownerNonce\":\"" + new string('a', 32) +
        "\",\"challenge\":\"" + new string('b', 64) + "\",\"documentId\":\"document-1\",\"windowId\":1" + tail + "}";
    }
    public static int Main() {
      try {
        Check(NativeFrame.Read(Bytes()) == null);
        Refused(delegate { NativeFrame.Read(Bytes(1, 0)); });
        Refused(delegate { NativeFrame.Read(Bytes(0, 0, 0, 0)); });
        Refused(delegate { NativeFrame.Read(Bytes(1, 16, 0, 0)); });
        Refused(delegate { NativeFrame.Read(Bytes(2, 0, 0, 0, 123)); });
        Refused(delegate { NativeFrame.Read(Bytes(2, 0, 0, 0, 195, 40)); });
        using (MemoryStream stream = new MemoryStream()) {
          NativeFrame.Write(stream, "\u4e2d\u6587");
          byte[] encoded = stream.ToArray(); Check(encoded[0] == 6 && encoded.Length == 10);
          stream.Position = 0; Check(NativeFrame.Read(stream) == "\u4e2d\u6587");
        }
        using (MemoryStream stream = new MemoryStream()) {
          NativeFrame.Write(stream, new string('x', 4096)); stream.Position = 0;
          Check(NativeFrame.Read(stream).Length == 4096);
        }
        Refused(delegate { NativeFrame.Write(new MemoryStream(), new string('x', 4097)); });
        Refused(delegate { FlatJson.Read("{\"v\":1,\"v\":2}"); });
        Refused(delegate { FlatJson.Read("{\"v\":1,\"\\u0076\":2}"); });
        Refused(delegate { FlatJson.Read("{\"v\":1}true"); });
        Refused(delegate { FlatJson.Read("{\"v\":{\"n\":1}}"); });
        Refused(delegate { FlatJson.Read("{\"v\":1.0}"); });
        Refused(delegate { FlatJson.Read("{\"v\":1e0}"); });
        Refused(delegate { FlatJson.Read("{\"v\":01}"); });
        Refused(delegate { FlatJson.Read("{\"v\":1,}"); });
        Refused(delegate { FlatJson.Read("{\"s\":\"\\ud800\"}"); });
        Check((string)FlatJson.Read("{\"s\":\"\\ud83d\\ude00\"}")["s"] == "\ud83d\ude00");
        NativeBind good = Program.ParseBind(Bind(""));
        Check(good.WindowId == 1 && good.DocumentId == "document-1" && good.OwnerNonce == new string('a', 32));
        Refused(delegate { Program.ParseBind(Bind(",\"hwndDecimal\":\"123\"")); });
        Refused(delegate { Program.ParseBind(Bind(",\"trusted\":1")); });
        Refused(delegate { Program.ParseBind(Bind("").Replace("\"windowId\":1", "\"windowId\":2147483648")); });
        Refused(delegate { Program.ParseBind(Bind("").Replace("\"windowId\":1", "\"windowId\":0")); });
        Refused(delegate { Program.ParseBind(Bind("").Replace("\"op\":\"bind\"", "\"op\":\"sample\"")); });
        Refused(delegate { Program.ParseBind(Bind("").Replace("document-1", new string('d', 129))); });
        Refused(delegate { Program.ParseBind(Bind("").Replace(new string('a', 32), new string('A', 32))); });
        string boundFixture = Program.BoundReply(good, new string('c', 32), "123", "18446744073709551615", 10, 11);
        var actual = FlatJson.Read(boundFixture);
        Check(actual.Count == 11 && (string)actual["op"] == "bound" && (string)actual["tagValue"] == "18446744073709551615");
        Console.WriteLine("{\"kind\":\"controlled-csharp-framing\",\"passed\":" + passed + ",\"native\":\"NOT_RUN\",\"boundFixture\":" + boundFixture + "}");
        return 0;
      } catch { Console.Error.WriteLine("COCKPIT_BRIDGE_FRAMING_FAILED"); return 1; }
    }
  }
}
