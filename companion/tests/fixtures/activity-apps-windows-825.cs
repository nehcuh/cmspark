// Test-owned process for visible/minimized/hidden/no-window application discovery.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Threading;

static class ActivityApps825Fixture {
  static readonly UTF8Encoding Encoding = new UTF8Encoding(false);
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
  static string Root;
  static Window Window;
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
    if (command == "minimize" && Window != null) Window.WindowState = WindowState.Minimized;
    else if (command == "hide" && Window != null) { Window.WindowState = WindowState.Normal; Window.Hide(); }
    else if (command != "snapshot" && command != "quit") throw new InvalidDataException("OWNED_CONTROL_INVALID");
    Record("response-" + sequence + ".json", new { sequence = sequence, command = command, pid = Process.GetCurrentProcess().Id, foreground = GetForegroundWindow().ToInt64(), visible = Window != null && Window.IsVisible, minimized = Window != null && Window.WindowState == WindowState.Minimized });
    return command != "quit";
  }
  [STAThread] static int Main(string[] args) {
    if (args.Length != 2) return 1;
    Root = args[0];
    try {
      if (args[1] == "headless") {
        Record("ready.json", new { pid = Process.GetCurrentProcess().Id, hwnd = 0 });
        while (Control()) Thread.Sleep(20);
        return 0;
      }
      if (args[1] != "gui") return 1;
      var app = new Application();
      Window = new Window { Title = "CMspark Owned Apps 825", Width = 600, Height = 240, Left = 80, Top = 80 };
      var text = new TextBox { Text = "OWNED APPLICATION DISCOVERY", IsReadOnly = true, FontSize = 24 };
      Window.Content = text;
      Window.ContentRendered += delegate {
        if (File.Exists(Path.Combine(Root, "ready.json"))) return;
        Window.Activate(); text.Focus();
        var hwnd = new WindowInteropHelper(Window).Handle;
        var windowClass = new StringBuilder(257);
        GetClassName(hwnd, windowClass, windowClass.Capacity);
        Record("ready.json", new { pid = Process.GetCurrentProcess().Id, hwnd = hwnd.ToInt64(), window_class = windowClass.ToString() });
      };
      var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(50) };
      timer.Tick += delegate { try { if (!Control()) app.Shutdown(0); } catch (Exception error) { Failure(error); app.Shutdown(1); } };
      app.DispatcherUnhandledException += delegate(object sender, DispatcherUnhandledExceptionEventArgs value) { Failure(value.Exception); value.Handled = true; app.Shutdown(1); };
      timer.Start();
      try { return app.Run(Window); } finally { timer.Stop(); }
    } catch (Exception error) { Failure(error); return 1; }
  }
  static void Failure(Exception error) {
    try { Record("failure.json", new { type = error.GetType().FullName, hresult = error.HResult }); } catch { }
  }
}
