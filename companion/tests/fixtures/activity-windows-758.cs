// Test-owned WPF process. No shell, command discovery, external app or user data.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;

static class Activity758Fixture {
  static readonly UTF8Encoding Encoding = new UTF8Encoding(false);
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
  static string DirectoryPath, PhaseName = "SETUP", LastControl = "";
  static Window Window;
  static void Record(string name, object value) {
    string target = Path.Combine(DirectoryPath, name), pending = target + ".pending";
    using (var stream = new FileStream(pending, FileMode.CreateNew, FileAccess.Write, FileShare.None))
    using (var writer = new StreamWriter(stream, Encoding)) writer.Write(Json.Serialize(value));
    File.Move(pending, target);
  }
  static void Phase(string value) {
    PhaseName = value;
    try { File.WriteAllText(Path.Combine(DirectoryPath, "phase.json"), Json.Serialize(new { phase = value }), Encoding); } catch { }
  }
  static void Failure(Exception error) {
    try {
      if (!File.Exists(Path.Combine(DirectoryPath, "failure.json"))) {
        string message = error.Message ?? "";
        Record("failure.json", new { phase = PhaseName, type = error.GetType().FullName, hresult = error.HResult, message = message.Substring(0, Math.Min(512, message.Length)) });
      }
    } catch { Console.Error.WriteLine("OWNED_ACTIVITY_FAILURE_RECORD_UNAVAILABLE"); }
  }
  [STAThread] static int Main(string[] args) {
    if (args.Length != 1) return 1;
    DirectoryPath = args[0];
    try {
      Phase("SETUP");
      var app = new Application();
      Window = new Window { Title = "CMspark Activity 758 Owned Fixture", Width = 800, Height = 300, Left = 80, Top = 80 };
      var text = new TextBox { Text = "PROJECT ALPHA\r\nSEND REPORT FRIDAY", FontSize = 32, Background = Brushes.White, Foreground = Brushes.Black, IsReadOnly = true };
      Window.Content = text;
      Window.ContentRendered += delegate {
        if (File.Exists(Path.Combine(DirectoryPath, "ready.json"))) return;
        Phase("CONTENT_RENDERED");
        try {
          Window.Activate(); text.Focus(); // One initial activation of our owned fixture only.
          var handle = new WindowInteropHelper(Window).Handle;
          Record("ready.json", new { pid = Process.GetCurrentProcess().Id, hwnd = handle.ToInt64() });
        } catch (Exception error) { Failure(error); app.Shutdown(1); }
      };
      var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(50) };
      timer.Tick += delegate {
        try {
          string file = Path.Combine(DirectoryPath, "control.json");
          if (!File.Exists(file)) return;
          string value = File.ReadAllText(file, Encoding);
          if (value == LastControl) return;
          LastControl = value; Phase("CONTROL");
          var control = Json.Deserialize<Dictionary<string, object>>(value);
          if (control.Count != 1 || !control.ContainsKey("command") || !(control["command"] is string)) throw new InvalidDataException("OWNED_CONTROL_INVALID");
          string command = (string)control["command"];
          if (command == "minimize") Window.WindowState = WindowState.Minimized;
          else if (command == "quit") { Window.Close(); return; }
          else throw new InvalidDataException("OWNED_CONTROL_INVALID");
          Record("ack.json", new { command = command, minimized = Window.WindowState == WindowState.Minimized });
        } catch (Exception error) { Failure(error); app.Shutdown(1); }
      };
      app.DispatcherUnhandledException += delegate(object sender, DispatcherUnhandledExceptionEventArgs value) { Failure(value.Exception); value.Handled = true; app.Shutdown(1); };
      timer.Start(); Phase("SHOW_DIALOG");
      try { return app.Run(Window); } finally { timer.Stop(); }
    } catch (Exception error) { Failure(error); return 1; }
  }
}
