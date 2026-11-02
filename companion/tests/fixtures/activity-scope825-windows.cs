// Owned two-column chat UI. All names, messages and image pixels are inert fixtures.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

static class ActivityScope825Fixture {
  static string Root, LastControl = "";
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
  static readonly UTF8Encoding Encoding = new UTF8Encoding(false);
  static Window Current;
  static FrameworkElement ContentRegion, TitleRegion;
  static Window ReceiptWindow;
  static string PendingReceipt;
  static Action CheckCurrentReceipt;
  static Window InitialWindow;
  static int MainThread;
  static bool InitialReady;
  static readonly HashSet<string> Observed = new HashSet<string>();
  // Test-only positive history, attempted once per fixed point. Never readiness.
  static void Observe(string phase) {
    try {
      if (!Observed.Add(phase)) return;
      RecordObservation(phase, new { phase = phase, sameSta = Thread.CurrentThread.ManagedThreadId == MainThread });
    } catch { }
  }
  static void RecordObservation(string phase, object value) {
    string file = Path.Combine(Root, "scope-initial-" + phase + ".json"), pending = file + ".pending";
    using (var stream = new FileStream(pending, FileMode.CreateNew, FileAccess.Write, FileShare.None))
    using (var writer = new StreamWriter(stream, Encoding)) writer.Write(Json.Serialize(value));
    File.Move(pending, file);
  }
  static bool ReadyResult(Window window, bool result, string reason) {
    if (window == InitialWindow && !InitialReady) Observe(reason);
    return result;
  }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  static bool IsReady(Window window, TextBox focus, bool rendered) {
    if (!rendered) return ReadyResult(window, false, "NOT_RENDERED");
    if (Current != window) return ReadyResult(window, false, "NOT_CURRENT");
    if (ReceiptWindow != window) return ReadyResult(window, false, "NOT_RECEIPT_WINDOW");
    if (PendingReceipt == null) return ReadyResult(window, false, "NO_PENDING");
    var hwnd = new WindowInteropHelper(window).Handle;
    if (hwnd == IntPtr.Zero) return ReadyResult(window, false, "NO_HWND");
    if (GetForegroundWindow() != hwnd) return ReadyResult(window, false, "NOT_FOREGROUND");
    if (!focus.IsKeyboardFocused) return ReadyResult(window, false, "NO_KEYBOARD_FOCUS");
    return ReadyResult(window, true, "QUALIFIED");
  }
  static void Write(string name, object data) {
    string file = Path.Combine(Root, name), pending = file + ".pending";
    File.WriteAllText(pending, Json.Serialize(data), Encoding); File.Move(pending, file);
  }
  static object Rect(FrameworkElement element) {
    Point a = element.PointToScreen(new Point(0, 0));
    Point b = element.PointToScreen(new Point(element.ActualWidth, element.ActualHeight));
    return new { x = a.X, y = a.Y, width = b.X - a.X, height = b.Y - a.Y };
  }
  static object Snapshot() {
    return new { pid = Process.GetCurrentProcess().Id, hwnd = new WindowInteropHelper(Current).Handle.ToInt64(), content = Rect(ContentRegion), title = Rect(TitleRegion) };
  }
  static Image EmbeddedImage() {
    var drawing = new DrawingVisual();
    using (var dc = drawing.RenderOpen()) {
      dc.DrawRectangle(Brushes.White, null, new Rect(0, 0, 420, 150));
      dc.DrawText(new FormattedText("SEND REPORT\nFRIDAY", CultureInfo.InvariantCulture, FlowDirection.LeftToRight, new Typeface("Arial"), 32, Brushes.Black), new Point(10, 10));
      dc.DrawRectangle(new SolidColorBrush(Color.FromRgb(0, 40, 220)), null, new Rect(350, 110, 40, 25));
    }
    var bitmap = new RenderTargetBitmap(420, 150, 96, 96, PixelFormats.Pbgra32);
    bitmap.Render(drawing); bitmap.Freeze();
    return new Image { Source = bitmap, Width = 420, Height = 150, HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(12) };
  }
  static Window Build(bool popup) {
    var window = new Window { Title = popup ? "Owned Independent Chat 825" : "Owned Main Chat 825", Width = popup ? 720 : 900, Height = popup ? 470 : 600, Left = 40, Top = 40, Background = Brushes.White };
    var layout = new Grid(); layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(210) }); layout.ColumnDefinitions.Add(new ColumnDefinition());
    var sidebar = new Border { Background = new SolidColorBrush(Color.FromRgb(220, 0, 220)), Child = new TextBlock { Text = "BETA GROUP\nSIDEBAR PRIVATE", FontSize = 24, Foreground = Brushes.Black, Margin = new Thickness(8) } };
    layout.Children.Add(sidebar);
    var content = new Grid { Background = Brushes.White }; Grid.SetColumn(content, 1);
    content.RowDefinitions.Add(new RowDefinition { Height = new GridLength(75) }); content.RowDefinitions.Add(new RowDefinition { Height = new GridLength(65) }); content.RowDefinitions.Add(new RowDefinition());
    var title = new Border { Background = Brushes.White, Child = new TextBlock { Text = "ALPHA GROUP", FontSize = 32, Foreground = Brushes.Black, Margin = new Thickness(12, 14, 0, 0) } };
    content.Children.Add(title);
    var focus = new TextBox { Text = "Message mentions BETA GROUP", IsReadOnly = true, FontSize = 20, Background = Brushes.White, Foreground = Brushes.Black, BorderThickness = new Thickness(0), Margin = new Thickness(12) }; Grid.SetRow(focus, 1); content.Children.Add(focus);
    var image = EmbeddedImage(); Grid.SetRow(image, 2); content.Children.Add(image);
    layout.Children.Add(content); window.Content = layout;
    Current = window; ContentRegion = content; TitleRegion = title;
    if (!popup) InitialWindow = window;
    ReceiptWindow = window; PendingReceipt = popup ? "ack.json" : "ready.json";
    bool rendered = false, requested = false;
    Action check = delegate {
      if (!IsReady(window, focus, rendered)) return;
      string name = PendingReceipt; PendingReceipt = null;
      Write(name, Snapshot());
      if (window == InitialWindow && name == "ready.json") { Observe("READY_WRITTEN"); InitialReady = true; }
    };
    CheckCurrentReceipt = check;
    window.ContentRendered += delegate {
      if (window == InitialWindow) Observe("CONTENT_RENDERED");
      if (Current != window) return;
      rendered = true;
      if (!requested) {
        requested = true;
        bool activated = window.Activate();
        if (window == InitialWindow) Observe(activated ? "ACTIVATE_TRUE" : "ACTIVATE_FALSE");
        bool focused = focus.Focus();
        if (window == InitialWindow) Observe(focused ? "FOCUS_TRUE" : "FOCUS_FALSE");
      }
      check();
    };
    // Recheck after WPF processes activation/focus; never request them again.
    window.Activated += delegate { window.Dispatcher.BeginInvoke(DispatcherPriority.Input, check); };
    focus.GotKeyboardFocus += delegate { window.Dispatcher.BeginInvoke(DispatcherPriority.Input, check); };
    if (!popup) {
      window.SourceInitialized += delegate { Observe("SOURCE_INITIALIZED"); };
      window.Loaded += delegate { Observe("LOADED"); };
    }
    return window;
  }
  [STAThread] static int Main(string[] args) {
    if (args.Length != 1) return 1;
    Root = args[0]; MainThread = Thread.CurrentThread.ManagedThreadId;
    var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
    try {
      var window = Build(false);
      var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(50) };
      timer.Tick += delegate {
        try {
          string file = Path.Combine(Root, "control.json"); if (!File.Exists(file)) return;
          string raw = File.ReadAllText(file, Encoding); if (raw == LastControl) return; LastControl = raw;
          var command = Json.Deserialize<System.Collections.Generic.Dictionary<string, object>>(raw);
          string action = (string)command["command"];
          if (action == "resize") { Current.Width += 80; Current.UpdateLayout(); ReceiptWindow = Current; PendingReceipt = "ack.json"; CheckCurrentReceipt(); }
          else if (action == "popup") { var old = Current; var popup = Build(true); popup.Show(); old.Hide(); popup.UpdateLayout(); }
          else throw new Exception("OWNED_UNKNOWN_CONTROL");
        } catch (Exception error) { try { Write("failure.json", new { type = error.GetType().Name, hresult = error.HResult }); } catch { } app.Shutdown(2); }
      };
      timer.Start(); window.Show(); Observe("RUN_ENTER"); app.Run(); Observe("RUN_RETURN"); return 0;
    } catch (Exception error) { try { Write("failure.json", new { type = error.GetType().Name, hresult = error.HResult }); } catch { } return 3; }
  }
}
