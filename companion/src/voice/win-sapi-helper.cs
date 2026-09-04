// win-sapi-helper.cs -- #259 Windows SAPI fallback STT helper.
// spec: docs/superpowers/specs/2026-09-04-windows-sapi-fallback.md 3.2
//
// One-shot process: reads ONE line of JSON from stdin, writes ONE line of JSON
// to stdout, exits. Protocol (companion/src/voice/win-sapi.ts):
//   {"probe":true}                          -> {"available":true|false,"reason":...}
//   {"wav_path":"...","lang":"zh-CN"}       -> {"text":"..."} | {"error":"...","code":...}
//
// Recognition: System.Speech.Recognition (desktop, fully local, Windows inbox).
// Windows.Media.SpeechRecognition (WinRT) is BANNED here: some SKUs route it to
// the cloud, which would break the "audio never leaves this machine" promise.
//
// Kept C# 2.0-compatible (no var / lambdas / object initializers / string
// interpolation) so even the legacy v2.0.50727 csc.exe can build it -- same
// discipline as scripts/tests/win-launcher-smoke.ps1's SEA stub.
//
// Compile (build-windows-exe.ps1 does this at packaging time):
//   csc /nologo /target:exe /r:System.Speech.dll /out:win-sapi-helper.exe win-sapi-helper.cs

using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Speech.Recognition;
using System.Text;

public static class WinSapiHelper
{
    // Hard wall per request; mirrors SAPI_HELPER_TIMEOUT_MS in win-sapi.ts.
    private static readonly TimeSpan TotalBudget = TimeSpan.FromSeconds(15);

    public static int Main(string[] args)
    {
        // Node writes UTF-8 without BOM; default console encodings are OEM
        // codepages and would mangle non-ASCII paths.
        try { Console.InputEncoding = Encoding.UTF8; } catch {}
        try { Console.OutputEncoding = Encoding.UTF8; } catch {}

        string line = Console.ReadLine();
        if (line == null)
        {
            WriteError("no request line on stdin", "protocol");
            return 0;
        }
        line = line.Trim();
        if (line.Length == 0)
        {
            WriteError("empty request line", "protocol");
            return 0;
        }

        if (HasTrueField(line, "probe"))
        {
            RunProbe();
            return 0;
        }

        string wavPath;
        string lang;
        if (!TryGetString(line, "wav_path", out wavPath))
        {
            WriteError("wav_path missing", "protocol");
            return 0;
        }
        if (!TryGetString(line, "lang", out lang) || lang == null || lang.Length == 0)
        {
            lang = "zh-CN";
        }
        RunTranscribe(wavPath, lang);
        return 0;
    }

    // --- probe -----------------------------------------------------------------

    private static void RunProbe()
    {
        try
        {
            RecognizerInfo[] infos = SpeechRecognitionEngine.InstalledRecognizers();
            if (infos == null || infos.Length == 0)
            {
                Console.WriteLine("{\"available\":false,\"reason\":\"no_recognizer_installed\"}");
                return;
            }
            Console.WriteLine("{\"available\":true}");
        }
        catch (Exception ex)
        {
            Console.WriteLine("{\"available\":false,\"reason\":\"" + JsonEscape(ex.Message) + "\"}");
        }
    }

    // --- transcribe ------------------------------------------------------------

    private static void RunTranscribe(string wavPath, string culture)
    {
        SpeechRecognitionEngine engine = null;
        try
        {
            engine = CreateEngineForCulture(culture);
            if (engine == null)
            {
                Console.WriteLine(
                    "{\"error\":\"system speech recognition does not support this language: "
                    + JsonEscape(culture) + "\",\"code\":\"unsupported_culture\"}");
                return;
            }

            engine.LoadGrammar(new DictationGrammar());
            engine.InitialSilenceTimeout = TimeSpan.FromSeconds(4);
            engine.BabbleTimeout = TimeSpan.FromSeconds(4);
            engine.EndSilenceTimeout = TimeSpan.FromMilliseconds(750);
            engine.EndSilenceTimeoutAmbiguous = TimeSpan.FromSeconds(1);
            engine.SetInputToWavFile(wavPath);

            StringBuilder text = new StringBuilder();
            Stopwatch wall = Stopwatch.StartNew();
            bool budgetOut = false;
            while (true)
            {
                TimeSpan remaining = TotalBudget - wall.Elapsed;
                if (remaining.Ticks <= 0)
                {
                    budgetOut = true;
                    break;
                }
                RecognitionResult result = engine.Recognize(remaining);
                if (result == null)
                {
                    break; // end of stream (or per-call window elapsed)
                }
                if (result.Text != null && result.Text.Length > 0)
                {
                    if (text.Length > 0) text.Append(' ');
                    text.Append(result.Text);
                }
            }

            string final = text.ToString();
            if (final.Length == 0 && budgetOut)
            {
                Console.WriteLine("{\"error\":\"recognition exceeded time budget\",\"code\":\"timeout\"}");
                return;
            }
            Console.WriteLine("{\"text\":\"" + JsonEscape(final) + "\"}");
        }
        catch (ArgumentException ex)
        {
            // bad wav / format mismatch / bad culture argument
            Console.WriteLine("{\"error\":\"" + JsonEscape(ex.Message) + "\",\"code\":\"invalid_audio\"}");
        }
        catch (Exception ex)
        {
            Console.WriteLine("{\"error\":\"" + JsonEscape(ex.Message) + "\",\"code\":\"internal_error\"}");
        }
        finally
        {
            if (engine != null)
            {
                try { engine.Dispose(); } catch {}
            }
        }
    }

    private static SpeechRecognitionEngine CreateEngineForCulture(string culture)
    {
        RecognizerInfo[] infos = SpeechRecognitionEngine.InstalledRecognizers();
        if (infos == null || infos.Length == 0)
        {
            return null;
        }
        string wanted = culture.ToLowerInvariant();
        RecognizerInfo match = null;
        RecognizerInfo primaryMatch = null;
        string primary = wanted;
        int dash = wanted.IndexOf('-');
        if (dash > 0) primary = wanted.Substring(0, dash);
        for (int i = 0; i < infos.Length; i++)
        {
            RecognizerInfo ri = infos[i];
            if (ri == null || ri.Culture == null) continue;
            string name = ri.Culture.Name.ToLowerInvariant();
            if (name == wanted) { match = ri; break; }
            if (primaryMatch == null && name.Length > primary.Length
                && name.Substring(0, primary.Length) == primary
                && name[primary.Length] == '-')
            {
                primaryMatch = ri;
            }
        }
        if (match == null) match = primaryMatch;
        if (match == null) return null;
        return new SpeechRecognitionEngine(match);
    }

    // --- minimal JSON ----------------------------------------------------------
    // Input from companion is JSON.stringify output; we only ever need to pull
    // flat string fields and detect {"probe":true}. No nested objects involved.

    private static bool HasTrueField(string json, string field)
    {
        string needle = "\"" + field + "\"";
        int at = json.IndexOf(needle, StringComparison.Ordinal);
        if (at < 0) return false;
        int colon = json.IndexOf(':', at + needle.Length);
        if (colon < 0) return false;
        string tail = json.Substring(colon + 1).TrimStart();
        return tail.StartsWith("true", StringComparison.Ordinal);
    }

    private static bool TryGetString(string json, string field, out string value)
    {
        value = null;
        string needle = "\"" + field + "\"";
        int at = json.IndexOf(needle, StringComparison.Ordinal);
        if (at < 0) return false;
        int colon = json.IndexOf(':', at + needle.Length);
        if (colon < 0) return false;
        int i = colon + 1;
        while (i < json.Length && char.IsWhiteSpace(json[i])) i++;
        if (i >= json.Length || json[i] != '"') return false;
        i++;
        StringBuilder sb = new StringBuilder();
        while (i < json.Length)
        {
            char c = json[i];
            if (c == '"')
            {
                value = sb.ToString();
                return true;
            }
            if (c == '\\')
            {
                i++;
                if (i >= json.Length) return false;
                char e = json[i];
                if (e == 'n') sb.Append('\n');
                else if (e == 'r') sb.Append('\r');
                else if (e == 't') sb.Append('\t');
                else if (e == 'b') sb.Append('\b');
                else if (e == 'f') sb.Append('\f');
                else if (e == '/') sb.Append('/');
                else if (e == '"') sb.Append('"');
                else if (e == '\\') sb.Append('\\');
                else if (e == 'u')
                {
                    if (i + 4 >= json.Length) return false;
                    int code = 0;
                    for (int k = 1; k <= 4; k++)
                    {
                        int hex = HexValue(json[i + k]);
                        if (hex < 0) return false;
                        code = code * 16 + hex;
                    }
                    sb.Append((char)code);
                    i += 4;
                }
                else
                {
                    return false;
                }
            }
            else
            {
                sb.Append(c);
            }
            i++;
        }
        return false;
    }

    private static int HexValue(char c)
    {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    }

    private static string JsonEscape(string s)
    {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder(s.Length + 8);
        for (int i = 0; i < s.Length; i++)
        {
            char c = s[i];
            if (c == '"') sb.Append("\\\"");
            else if (c == '\\') sb.Append("\\\\");
            else if (c == '\n') sb.Append("\\n");
            else if (c == '\r') sb.Append("\\r");
            else if (c == '\t') sb.Append("\\t");
            else if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
            // escape non-ASCII so stdout is codepage-proof (surrogate pairs pass
            // through as two \uXXXX units, which is valid JSON)
            else if (c > 0x7e) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
            else sb.Append(c);
        }
        return sb.ToString();
    }

    private static void WriteError(string message, string code)
    {
        Console.WriteLine("{\"error\":\"" + JsonEscape(message) + "\",\"code\":\"" + code + "\"}");
    }
}
