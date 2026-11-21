// Test-owned process for visible/minimized/hidden/no-window application discovery.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static class ActivityApps825Fixture {
  static readonly UTF8Encoding Encoding = new UTF8Encoding(false);
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
  static string Root;
  static Form Window;
  static int MainThread;
  static readonly HashSet<string> Observed = new HashSet<string>();
  // Positive history only: a missing point is unknown, never readiness.
  static void Observe(string phase) {
    try {
      if (!Observed.Add(phase)) return;
      Record("apps-initial-" + phase + ".json", new { phase = phase, sameSta = Thread.CurrentThread.ManagedThreadId == MainThread });
    } catch { }
  }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
  static void Record(string name, object value) {
    string target = Path.Combine(Root, name), pending = target + ".pending";
    using (var stream = new FileStream(pending, FileMode.CreateNew, FileAccess.Write, FileShare.None))
    using (var writer = new StreamWriter(stream, Encoding)) writer.Write(Json.Serialize(value));
    File.Move(pending, target);
  }
  static bool Control() {
    string file = Path.Combine(Root, "control.json");
    if (!File.Exists(file)) return true;
    var control = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file, Encoding));
    File.Delete(file);
    if (control.Count != 2 || !control.ContainsKey("sequence") || !control.ContainsKey("command") || !(control["command"] is string)) throw new InvalidDataException("OWNED_CONTROL_INVALID");
    int sequence = Convert.ToInt32(control["sequence"]);
    string command = (string)control["command"];
    if (command == "minimize" && Window != null) Window.WindowState = FormWindowState.Minimized;
    else if (command == "hide" && Window != null) { Window.WindowState = FormWindowState.Normal; Window.Hide(); }
    else if (command != "snapshot" && command != "quit") throw new InvalidDataException("OWNED_CONTROL_INVALID");
    Record("response-" + sequence + ".json", new { sequence = sequence, command = command, pid = Process.GetCurrentProcess().Id, foreground = GetForegroundWindow().ToInt64(), visible = Window != null && Window.Visible, minimized = Window != null && Window.WindowState == FormWindowState.Minimized });
    return command != "quit";
  }
  [STAThread] static int Main(string[] args) {
    if (args.Length != 2) return 1;
    Root = args[0];
    MainThread = Thread.CurrentThread.ManagedThreadId; Observe("MAIN_ENTER");
    try {
      if (args[1] == "headless") {
        Record("ready.json", new { pid = Process.GetCurrentProcess().Id, hwnd = 0 });
        while (Control()) Thread.Sleep(20);
        return 0;
      }
      if (args[1] != "gui") return 1;
      Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
      using (var form = new Form { Text = "CMspark Owned Apps 825", StartPosition = FormStartPosition.Manual, Width = 600, Height = 240, Left = 80, Top = 80 })
      using (var font = new Font(SystemFonts.DefaultFont.FontFamily, 24))
      using (var timer = new System.Windows.Forms.Timer { Interval = 50 }) {
        Window = form;
        var text = new TextBox { Text = "OWNED APPLICATION DISCOVERY", ReadOnly = true, Font = font, Dock = DockStyle.Top };
        Window.Controls.Add(text);
        Window.HandleCreated += delegate { Observe("SOURCE_INITIALIZED"); };
        Window.Load += delegate { Observe("LOADED"); };
        Window.Shown += delegate {
          Window.Refresh();
          Observe("CONTENT_RENDERED");
          Window.Activate(); text.Focus();
          var hwnd = Window.Handle;
          var windowClass = new StringBuilder(257);
          if (GetClassName(hwnd, windowClass, windowClass.Capacity) == 0) throw new InvalidOperationException("OWNED_APPS_WINDOW_CLASS_MISSING");
          Record("ready.json", new { pid = Process.GetCurrentProcess().Id, hwnd = hwnd.ToInt64(), window_class = windowClass.ToString() });
          Observe("READY_WRITTEN");
        };
        timer.Tick += delegate { if (!Control()) Window.Close(); };
        timer.Start();
        Observe("RUN_ENTER");
        Application.Run(Window);
        return 0;
      }
    } catch (Exception error) { Failure(error); return 1; }
  }
  static void Failure(Exception error) {
    try { Record("failure.json", new { type = error.GetType().FullName, hresult = error.HResult }); } catch { }
  }
}
