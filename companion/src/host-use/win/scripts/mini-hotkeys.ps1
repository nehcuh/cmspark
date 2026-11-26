$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase,System.Xaml,System.Web.Extensions
$refs = @(
    [System.Windows.Window].Assembly.Location
    [System.Windows.Media.Brush].Assembly.Location
    [System.Windows.Point].Assembly.Location
    [System.Xaml.XamlReader].Assembly.Location
    [System.ComponentModel.Component].Assembly.Location
    [System.Web.Script.Serialization.JavaScriptSerializer].Assembly.Location
)
Add-Type -ReferencedAssemblies $refs -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;

namespace CMspark.Mini {
public class GlobalHotkeys : IDisposable {
    const int NoRepeat = 0x4000, WmHotkey = 0x0312, WmInput = 0x00ff;
    static readonly Chord DefaultSummon = new Chord(3, 0x20);
    static readonly string[] Actions = { "chat", "search", "shot", "capture", "todo", "ask", "ocr", "meeting", "summon" };
    static readonly string[] Labels = { "快速对话",     "资料搜索", "截图菜单", "仅截图",
                                        "截图抽取待办", "截图询问", "截图 OCR", "会议记录", "召唤 Mini" };
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint key);
    [DllImport("user32.dll")]
    static extern bool UnregisterHotKey(IntPtr hwnd, int id);
    [DllImport("user32.dll")]
    static extern bool AllowSetForegroundWindow(int processId);
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")]
    static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [StructLayout(LayoutKind.Sequential)]
    struct RawDevice {
        public ushort Page, Usage;
        public uint Flags;
        public IntPtr Target;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct RawHeader {
        public uint Type, Size;
        public IntPtr Device, Param;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct RawKey {
        public RawHeader Header;
        public ushort MakeCode, Flags, Reserved, VirtualKey;
        public uint Message, Extra;
    }
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool RegisterRawInputDevices(RawDevice[] devices, uint count, uint size);
    [DllImport("user32.dll")]
    static extern uint GetRawInputData(IntPtr raw, uint command, out RawKey data, ref uint size, uint header);

    struct Chord {
        public int Mods, Key;
        public Chord(int mods, int key) {
            Mods = mods;
            Key = key;
        }
        public bool Same(Chord other) {
            return Mods == other.Mods && Key == other.Key;
        }
        public bool Reserved() {
            return Key == 0x7b || (Key == 0x2e && (Mods & 3) == 3) || (Key == 0x4c && Mods == 8) ||
                   (Key == 0x20 && (Mods & 8) != 0 && (Mods & 1) == 0);
        }
        public bool Valid() {
            if ((Mods & ~15) != 0 || Reserved())
                return false;
            bool function = Key >= 0x70 && Key <= 0x87;
            bool ordinary = (Key >= 0x30 && Key <= 0x39) || (Key >= 0x41 && Key <= 0x5a) ||
                            (Key >= 0x60 && Key <= 0x6f) || (Key >= 0x21 && Key <= 0x28) || Key == 0x20 ||
                            Key == 0x2d || Key == 0x2e || (Key >= 0xba && Key <= 0xc0) ||
                            (Key >= 0xdb && Key <= 0xde);
            return function || (ordinary && (Mods & (1 | 2 | 8)) != 0);
        }
        public override string ToString() {
            var parts = new List<string>();
            if ((Mods & 2) != 0)
                parts.Add("Ctrl");
            if ((Mods & 1) != 0)
                parts.Add("Alt");
            if ((Mods & 4) != 0)
                parts.Add("Shift");
            if ((Mods & 8) != 0)
                parts.Add("Win");
            string key = Key >= 0x30 && Key <= 0x39 ? ((char)Key).ToString()
                                                    : KeyInterop.KeyFromVirtualKey(Key).ToString();
            parts.Add(key);
            return String.Join(" + ", parts.ToArray());
        }
    }

    readonly string file;
    readonly HwndSource listener;
    readonly Window settings = new Window();
    readonly TextBlock status = new TextBlock();
    readonly Dictionary<string, Button> record = new Dictionary<string, Button>(),
                                        clear = new Dictionary<string, Button>();
    readonly Dictionary<string, int> ids = new Dictionary<string, int>();
    Dictionary<string, Chord> bindings = new Dictionary<string, Chord>();
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 32768, RecursionLimit = 6 };
    string recording;
    IntPtr settingsHandle;
    bool quitting, rawActive, startupConflict, ignoreSpaceRelease;
    int modifiers, orbPid;
    DateTime grantUntil;

    GlobalHotkeys(string path) {
        file = path;
        var parameters = new HwndSourceParameters("CMspark Mini global hotkeys");
        parameters.ParentWindow = new IntPtr(-3); // HWND_MESSAGE receives WM_HOTKEY without an onscreen window.
        parameters.WindowStyle = 0;
        listener = new HwndSource(parameters);
        listener.AddHook(OnHotkey);
        BuildSettings();
        Load();
        Refresh();
    }
    static void Emit(string line) {
        Console.WriteLine(line);
        Console.Out.Flush();
    }
    static string Suffix(string action) {
        return Char.ToUpperInvariant(action[0]) + action.Substring(1);
    }
    static SolidColorBrush Color(string hex) {
        return (SolidColorBrush) new BrushConverter().ConvertFromString(hex);
    }
    static void Identify(FrameworkElement element, string id, string name) {
        AutomationProperties.SetAutomationId(element, id);
        AutomationProperties.SetName(element, name);
    }
    static Button ButtonFor(string id, string name, string caption) {
        var result = new Button { Content = caption,
                                  MinHeight = 32,
                                  Padding = new Thickness(8, 3, 8, 3),
                                  Margin = new Thickness(4),
                                  Foreground = Color("#182F40"),
                                  BorderBrush = Color("#AEC3CF"),
                                  Background = Color("#F4FAFE") };
        Identify(result, id, name);
        return result;
    }
    void BuildSettings() {
        settings.Title = "CMspark Mini 快捷键";
        Identify(settings, "MiniHotkeySettings", settings.Title);
        settings.Width = 520;
        settings.Height = 590;
        settings.MinWidth = 370;
        settings.MinHeight = 320;
        settings.WindowStartupLocation = WindowStartupLocation.CenterScreen;
        settings.Background = Color("#F1F6FA");
        settings.FontFamily = new FontFamily("Microsoft YaHei UI");
        var shell = new DockPanel { Margin = new Thickness(18) };
        settings.Content = shell;
        var intro = new TextBlock { Text = "点击快捷键栏，再按下组合键。按 Esc 取消录制。",
                                    Margin = new Thickness(4, 4, 4, 14), TextWrapping = TextWrapping.Wrap,
                                    Foreground = Color("#314B5D") };
        DockPanel.SetDock(intro, Dock.Top);
        shell.Children.Add(intro);
        var footer = new DockPanel { Margin = new Thickness(0, 10, 0, 0) };
        DockPanel.SetDock(footer, Dock.Bottom);
        shell.Children.Add(footer);
        var close = ButtonFor("MiniHotkeyClose", "关闭", "关闭");
        close.Click += delegate {
            settings.Hide();
        };
        DockPanel.SetDock(close, Dock.Right);
        footer.Children.Add(close);
        status.TextWrapping = TextWrapping.Wrap;
        status.VerticalAlignment = VerticalAlignment.Center;
        status.Margin = new Thickness(4, 0, 6, 0);
        status.Foreground = Color("#24516A");
        AutomationProperties.SetAutomationId(status, "MiniHotkeyStatus");
        AutomationProperties.SetLiveSetting(status, AutomationLiveSetting.Polite);
        footer.Children.Add(status);
        var rows = new StackPanel();
        shell.Children.Add(
            new ScrollViewer { Content = rows, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        for (int i = 0; i < Actions.Length; i++) {
            string action = Actions[i], label = Labels[i], suffix = Suffix(action);
            var row = new Grid { Margin = new Thickness(0, 3, 0, 3) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(100) });
            row.ColumnDefinitions.Add(new ColumnDefinition());
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            rows.Children.Add(row);
            var title = new TextBlock { Text = label, VerticalAlignment = VerticalAlignment.Center,
                                        Margin = new Thickness(4), Foreground = Color("#203644"),
                                        FontWeight = FontWeights.SemiBold };
            row.Children.Add(title);
            var recorder = ButtonFor("MiniHotkeyRecord" + suffix, "录制" + label + "快捷键", "未设置");
            recorder.Click += delegate {
                BeginRecording(action);
            };
            record[action] = recorder;
            Grid.SetColumn(recorder, 1);
            row.Children.Add(recorder);
            var remove = ButtonFor("MiniHotkeyClear" + suffix, "清除" + label + "快捷键", "清除");
            remove.Click += delegate {
                Clear(action);
            };
            clear[action] = remove;
            Grid.SetColumn(remove, 2);
            row.Children.Add(remove);
        }
        settings.SourceInitialized += delegate {
            settingsHandle = new WindowInteropHelper(settings).Handle;
            HwndSource.FromHwnd(settingsHandle).AddHook(OnSettingsInput);
        };
        settings.PreviewKeyDown += delegate(object sender, KeyEventArgs e) {
            if (recording == null)
                return;
            e.Handled = true;
            var key = e.Key == Key.System ? e.SystemKey : e.Key;
            if (!e.IsRepeat)
                RecordKey(KeyInterop.VirtualKeyFromKey(key), (int)Keyboard.Modifiers);
        };
        settings.Deactivated += delegate {
            if (recording != null) {
                StopRecording();
                Refresh();
                Message("录制窗口已失去焦点。若组合键打开了其他应用，请换一个组合键。");
            }
        };
        settings.IsVisibleChanged += delegate {
            if (!settings.IsVisible && recording != null)
                CancelRecording();
        };
        settings.Closing += delegate(object sender, System.ComponentModel.CancelEventArgs e) {
            if (!quitting) {
                e.Cancel = true;
                settings.Hide();
            }
        };
    }
    void Message(string text) {
        status.Text = text;
        AutomationProperties.SetName(status, text);
    }
    void Refresh() {
        foreach (string action in Actions) {
            Chord chord;
            bool configured = bindings.TryGetValue(action, out chord);
            string label = configured ? chord.ToString() : "未设置";
            if (configured && !ids.ContainsKey(action))
                label += "（未启用）";
            record[action].Content = action == recording ? "请按组合键…" : label;
            AutomationProperties.SetHelpText(record[action], label);
            record[action].Background = Color(action == recording ? "#B3F3F3" : "#F4FAFE");
            clear[action].IsEnabled = configured;
        }
    }
    void BeginRecording(string action) {
        StopRecording();
        recording = action;
        modifiers = (int)Keyboard.Modifiers;
        record[action].Focus();
        ignoreSpaceRelease = GetAsyncKeyState(0x20) < 0;
        // Foreground-only raw keyboard messages also expose chords consumed by another app's registered
        // hotkey. Request the keyboard only while the focused user is explicitly recording this row.
        var device = new RawDevice { Page = 1, Usage = 6, Target = settingsHandle };
        rawActive = RegisterRawInputDevices(new[] { device }, 1, (uint)Marshal.SizeOf(typeof(RawDevice)));
        Refresh();
        Message("按下组合键，或按 Esc 取消。");
    }
    void StopRecording() {
        recording = null;
        if (!rawActive)
            return;
        var remove = new RawDevice { Page = 1, Usage = 6, Flags = 1 };
        RegisterRawInputDevices(new[] { remove }, 1, (uint)Marshal.SizeOf(typeof(RawDevice)));
        rawActive = false;
    }
    void CancelRecording() {
        StopRecording();
        Refresh();
        Message("已取消录制。");
    }
    static int Modifier(int key) {
        if (key == 0x10 || key == 0xa0 || key == 0xa1)
            return 4;
        if (key == 0x11 || key == 0xa2 || key == 0xa3)
            return 2;
        if (key == 0x12 || key == 0xa4 || key == 0xa5)
            return 1;
        return key == 0x5b || key == 0x5c ? 8 : 0;
    }
    IntPtr OnSettingsInput(IntPtr hwnd, int msg, IntPtr wp, IntPtr lp, ref bool handled) {
        if (msg != WmInput || recording == null || !rawActive || GetForegroundWindow() != settingsHandle)
            return IntPtr.Zero;
        RawKey key;
        uint size = (uint)Marshal.SizeOf(typeof(RawKey));
        if (GetRawInputData(lp, 0x10000003, out key, ref size, (uint)Marshal.SizeOf(typeof(RawHeader))) ==
                UInt32.MaxValue ||
            key.Header.Type != 1)
            return IntPtr.Zero;
        int mod = Modifier(key.VirtualKey);
        bool release = (key.Flags & 1) != 0;
        if (mod != 0)
            modifiers = release ? modifiers & ~mod : modifiers | mod;
        else if (!release)
            RecordKey(key.VirtualKey, modifiers);
        else if (key.VirtualKey == 0x20 && ignoreSpaceRelease)
            ignoreSpaceRelease = false;
        else
            CheckReleaseConflict(new Chord(modifiers, key.VirtualKey));
        return IntPtr.Zero;
    }
    void CheckReleaseConflict(Chord chord) {
        // Windows can route the key-down exclusively to another app's RegisterHotKey owner while
        // forwarding the key-up to this foreground recorder. A release can report an actual conflict
        // but can never save a binding (including a key already held when the recorder was opened).
        if (!chord.Valid())
            return;
        foreach (var pair in bindings)
            if (ids.ContainsKey(pair.Key) && pair.Value.Same(chord))
                return;
        const int probeId = 0x5140;
        if (Register(probeId, chord)) {
            UnregisterHotKey(listener.Handle, probeId);
        } else if (Marshal.GetLastWin32Error() == 1409) { // ERROR_HOTKEY_ALREADY_REGISTERED
            StopRecording();
            Refresh();
            Message(chord + " 已被占用，请更换组合键。");
        }
    }
    void RecordKey(int key, int mods) {
        if (recording == null || Modifier(key) != 0)
            return;
        if (key == 0x1b) {
            CancelRecording();
            return;
        }
        var next = new Chord(mods, key);
        if (!next.Valid()) {
            Message(next.Reserved() ? "Windows 保留此组合键，请选择其他组合键。"
                                    : "请使用功能键，或使用 Ctrl、Alt 或 Win 加一个键。");
            return;
        }
        string action = recording;
        StopRecording();
        SetBinding(action, next);
        Refresh();
    }
    int NextId(string action) {
        int first = 0x5120 + Array.IndexOf(Actions, action) * 2, current;
        return ids.TryGetValue(action, out current) && current == first ? first + 1 : first;
    }
    bool Register(int id, Chord chord) {
        return RegisterHotKey(listener.Handle, id, (uint)(NoRepeat | chord.Mods), (uint)chord.Key);
    }
    void Release(string action) {
        int id;
        if (ids.TryGetValue(action, out id)) {
            UnregisterHotKey(listener.Handle, id);
            ids.Remove(action);
        }
    }
    void SetBinding(string action, Chord next) {
        foreach (var pair in bindings) {
            if (!pair.Value.Same(next))
                continue;
            if (pair.Key != action) {
                Message(next + " 已被占用：" + Labels[Array.IndexOf(Actions, pair.Key)] + "。");
                return;
            }
            if (ids.ContainsKey(action)) {
                Message("已保存：" + next + "。");
                return;
            }
        }
        int id = NextId(action);
        if (!Register(id, next)) {
            int error = Marshal.GetLastWin32Error();
            Message(error == 1409 ? next + " 已被占用，请更换组合键。"
                                  : "Windows 未能注册 " + next + "，原设置已保留。");
            return;
        }
        // Keep both the old registration and its file intact until the replacement has been reserved
        // with Windows and persisted. A failed write drops only the tentative registration.
        var candidate = new Dictionary<string, Chord>(bindings);
        candidate[action] = next;
        if (!Save(candidate)) {
            UnregisterHotKey(listener.Handle, id);
            return;
        }
        Release(action);
        ids[action] = id;
        bindings = candidate;
        Message("已保存：" + next + "。");
    }
    void Clear(string action) {
        StopRecording();
        var candidate = new Dictionary<string, Chord>(bindings);
        candidate.Remove(action);
        if (Save(candidate)) {
            Release(action);
            bindings = candidate;
            Message("已清除快捷键。");
        }
        Refresh();
    }
    bool Save(Dictionary<string, Chord> candidate) {
        string tmp = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try {
            var map = new Dictionary<string, object>();
            foreach (var pair in candidate)
                map[pair.Key] = new { modifiers = pair.Value.Mods, key = pair.Value.Key };
            byte[] body = Encoding.UTF8.GetBytes(json.Serialize(new { version = 2, bindings = map }));
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            using (var stream = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                stream.Write(body, 0, body.Length);
                stream.Flush(true);
            }
            if (File.Exists(file))
                File.Replace(tmp, file, null);
            else
                File.Move(tmp, file);
            return true;
        } catch (IOException) {
            Message("无法保存快捷键，原设置已保留。");
        } catch (UnauthorizedAccessException) {
            Message("没有写入快捷键设置的权限，原设置已保留。");
        } finally {
            try {
                File.Delete(tmp);
            } catch (IOException) {
            } catch (UnauthorizedAccessException) {}
        }
        return false;
    }
    void Load() {
        try {
            if (!File.Exists(file)) {
                LoadBinding("summon", DefaultSummon);
                return;
            }
            if (new FileInfo(file).Length > 32768)
                throw new InvalidDataException();
            var root = json.DeserializeObject(File.ReadAllText(file)) as Dictionary<string, object>;
            object version, content;
            if (root == null || !root.TryGetValue("version", out version) || !(version is int) ||
                ((int)version != 1 && (int)version != 2) || !root.TryGetValue("bindings", out content))
                throw new InvalidDataException();
            var map = content as Dictionary<string, object>;
            if (map == null)
                throw new InvalidDataException();
            foreach (string action in Actions) {
                object value, mods, key;
                if (!map.TryGetValue(action, out value))
                    continue;
                var entry = value as Dictionary<string, object>;
                if (entry == null || !entry.TryGetValue("modifiers", out mods) || !(mods is int) ||
                    !entry.TryGetValue("key", out key) || !(key is int))
                    continue;
                var chord = new Chord((int)mods, (int)key);
                if (!chord.Valid())
                    continue;
                LoadBinding(action, chord);
            }
            // Version 2 records an explicit clear by omitting the binding from the saved map.
            if ((int)version == 1 && !bindings.ContainsKey("summon") && !HasBinding(DefaultSummon))
                LoadBinding("summon", DefaultSummon);
        } catch (IOException) {
            Message("无法读取快捷键配置。");
        } catch (UnauthorizedAccessException) {
            Message("没有读取快捷键设置的权限。");
        } catch (ArgumentException) {
            Message("快捷键配置格式无效。");
        } catch (InvalidOperationException) {
            Message("快捷键配置格式无效。");
        } catch (InvalidDataException) {
            Message("快捷键配置格式无效。");
        }
    }
    bool HasBinding(Chord chord) {
        foreach (var assigned in bindings.Values)
            if (assigned.Same(chord))
                return true;
        return false;
    }
    void LoadBinding(string action, Chord chord) {
        bool duplicate = HasBinding(chord);
        bindings[action] = chord;
        int id = NextId(action);
        if (!duplicate && Register(id, chord))
            ids[action] = id;
        else {
            startupConflict = true;
            Message("部分 Mini 快捷键已被占用，请重新录制。");
        }
    }
    IntPtr OnHotkey(IntPtr hwnd, int msg, IntPtr wp, IntPtr lp, ref bool handled) {
        if (msg != WmHotkey)
            return IntPtr.Zero;
        handled = true;
        long bits = lp.ToInt64();
        var eventChord = new Chord((int)(bits & 15), (int)((bits >> 16) & 0xffff));
        foreach (string action in Actions) {
            int id;
            Chord chord;
            if (!ids.TryGetValue(action, out id) || id != wp.ToInt32() ||
                !bindings.TryGetValue(action, out chord) || !eventChord.Same(chord))
                continue;
            // A recorded chord can produce both a foreground keyboard message and a WM_HOTKEY.
            // While settings owns the foreground, consume either order without dispatching a Mini action.
            if (settingsHandle != IntPtr.Zero && GetForegroundWindow() == settingsHandle) {
                if (recording != null)
                    RecordKey(chord.Key, chord.Mods);
                break;
            }
            if (action == "chat" || action == "shot" || action == "summon") {
                grantUntil = DateTime.UtcNow.AddSeconds(5);
                if (orbPid > 0)
                    AllowSetForegroundWindow(orbPid);
            }
            Emit("action:" + action);
            break;
        }
        return IntPtr.Zero;
    }
    void Command(string line) {
        if (line == null || line == "quit") {
            quitting = true;
            StopRecording();
            Application.Current.Shutdown();
            return;
        }
        const string prefix = "orb-pid:";
        const string readyPrefix = "orb-ready:";
        if (line.StartsWith(prefix, StringComparison.Ordinal)) {
            int pid;
            if (Int32.TryParse(line.Substring(prefix.Length), NumberStyles.None, CultureInfo.InvariantCulture,
                               out pid)) {
                orbPid = pid;
                if (pid > 0 && DateTime.UtcNow <= grantUntil)
                    AllowSetForegroundWindow(pid);
            }
        } else if (line.StartsWith(readyPrefix, StringComparison.Ordinal)) {
            int pid;
            if (Int32.TryParse(line.Substring(readyPrefix.Length), NumberStyles.None, CultureInfo.InvariantCulture,
                               out pid) && pid > 0 && pid == orbPid) {
                if (DateTime.UtcNow <= grantUntil)
                    AllowSetForegroundWindow(pid);
                Emit(readyPrefix + pid.ToString(CultureInfo.InvariantCulture));
            }
        } else if (line == "settings") {
            if (!settings.IsVisible)
                settings.Show();
            if (settings.WindowState == WindowState.Minimized)
                settings.WindowState = WindowState.Normal;
            settings.Activate();
        }
    }
    public void Dispose() {
        StopRecording();
        foreach (string action in Actions)
            Release(action);
        listener.Dispose();
    }
    public static void Run() {
        string configured = Environment.GetEnvironmentVariable("CMSPARK_MINI_HOTKEYS_FILE");
        if (String.IsNullOrWhiteSpace(configured) || !Path.IsPathRooted(configured))
            throw new ArgumentException("An absolute hotkey settings path is required.");
        string path = Path.GetFullPath(configured), name;
        using (var hash = SHA256.Create()) {
            name = @"Local\CMspark.Mini.Hotkeys." +
                   BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(path.ToUpperInvariant())));
        }
        bool owner;
        using (var mutex = new Mutex(true, name, out owner)) {
            if (!owner) {
                Emit("unavailable");
                return;
            }
            try {
                try {
                    SetThreadDpiAwarenessContext(new IntPtr(-4));
                } catch (EntryPointNotFoundException) {}
                var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
                using (var host = new GlobalHotkeys(path)) {
                    var reader = new Thread(delegate() {
                        try {
                            while (true) {
                                string line = Console.ReadLine();
                                app.Dispatcher.BeginInvoke(new Action(delegate { host.Command(line); }));
                                if (line == null || line == "quit")
                                    break;
                            }
                        } catch (IOException) {
                            app.Dispatcher.BeginInvoke(new Action(delegate { host.Command(null); }));
                        }
                    });
                    reader.IsBackground = true;
                    reader.Start();
                    Emit("ready");
                    if (host.startupConflict)
                        Emit("conflict");
                    app.Run();
                }
            } finally {
                mutex.ReleaseMutex();
            }
        }
    }
}
}
'@
[CMspark.Mini.GlobalHotkeys]::Run()
