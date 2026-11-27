$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase,System.Xaml,UIAutomationProvider,UIAutomationTypes
$refs = @(
    [System.Windows.Window].Assembly.Location
    [System.Windows.Media.Brush].Assembly.Location
    [System.Windows.Point].Assembly.Location
    [System.Xaml.XamlReader].Assembly.Location
    [System.ComponentModel.Component].Assembly.Location
    [System.Windows.Automation.Provider.IExpandCollapseProvider].Assembly.Location
    [System.Windows.Automation.ExpandCollapseState].Assembly.Location
)
Add-Type -ReferencedAssemblies $refs -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Automation.Peers;
using System.Windows.Automation.Provider;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;
using PathShape = System.Windows.Shapes.Path;

namespace CMspark.Mini {
class OrbButton : Button {
    public Action<bool> Open;
    public Func<bool> Expanded;
    protected override AutomationPeer OnCreateAutomationPeer() {
        return new OrbPeer(this);
    }
}
class OrbPeer : ButtonAutomationPeer, IExpandCollapseProvider {
    readonly OrbButton orb;
    public OrbPeer(OrbButton button) : base(button) {
        orb = button;
    }
    public override object GetPattern(PatternInterface p) {
        return p == PatternInterface.ExpandCollapse ? this : base.GetPattern(p);
    }
    public ExpandCollapseState ExpandCollapseState {
        get { return orb.Expanded() ? ExpandCollapseState.Expanded : ExpandCollapseState.Collapsed; }
    }
    public void Expand() {
        orb.Open(true);
    }
    public void Collapse() {
        orb.Open(false);
    }
}
public class OrbWindow : Window {
    [StructLayout(LayoutKind.Sequential)]
    struct Pixel {
        public int X, Y;
        public Pixel(int x, int y) {
            X = x;
            Y = y;
        }
    }
    [StructLayout(LayoutKind.Sequential)]
    struct RectPx {
        public int Left, Top, Right, Bottom;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct MonitorInfo {
        public int Size;
        public RectPx Bounds, Work;
        public int Flags;
    }
    [DllImport("user32.dll")]
    static extern IntPtr MonitorFromPoint(Pixel p, uint flags);
    [DllImport("user32.dll")]
    static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")]
    static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll")]
    static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("shcore.dll")]
    static extern int GetDpiForMonitor(IntPtr monitor, int kind, out uint x, out uint y);
    const double OrbSize = 54, Radius = OrbSize / 2 + 3;
    static readonly string[] Roots = { "chat", "shot", "search", "meeting" }, Leaves = { "todo", "ask", "ocr", "capture", "delay" };
    static readonly string[] Names = { "快速对话", "截图",     "资料搜索", "会议记录", "截图抽取待办",
                                       "截图询问", "截图 OCR", "仅截图", "延时截图" };
    static readonly string[] Labels = { "快速对话", "截图",  "资料搜索", "会议记录", "抽取待办",
                                        "询问图片", "OCR 识别", "仅截图", "延时截图" };
    static readonly string[] Glyphs = { "\uE8BD", "\uE722", "\uE721", "\uE787", "\uE8FD", "\uE9CE", "\uE8D2", "\uE7C5", "\uE823" };
    static readonly string[] Keys = { "chat", "shot", "search", "meeting", "todo", "ask", "ocr", "capture", "delay" };
    readonly Dictionary<string, Button> buttons = new Dictionary<string, Button>();
    readonly Dictionary<string, PathShape> slices = new Dictionary<string, PathShape>();
    readonly Dictionary<string, Point> centers = new Dictionary<string, Point>();
    readonly Canvas scene = new Canvas();
    readonly ContextMenu delayMenu = new ContextMenu();
    readonly TextBlock branchLabel = new TextBlock();
    readonly OrbButton orb = new OrbButton();
    readonly DispatcherTimer hold = new DispatcherTimer();
    readonly Border chatCard = new Border();
    readonly TextBox draft = new TextBox(), history = new TextBox();
    readonly Button send = new Button();
    readonly TextBlock chatStatus = new TextBlock();
    readonly List<string> turns = new List<string>();
    readonly Popup notice = new Popup();
    readonly DispatcherTimer noticeTimer = new DispatcherTimer();
    readonly TextBlock noticeText = new TextBlock();
    string pending;
    bool chatting;
    bool temporary = Environment.GetEnvironmentVariable("CMSPARK_MINI_TEMPORARY") == "1";
    readonly string positionFile = Environment.GetEnvironmentVariable("CMSPARK_MINI_POSITION_FILE");
    IntPtr handle;
    Pixel anchor, press, pressAnchor;
    Point orbCenter;
    bool menu, sub, down, moving, layingOut;
    string hot;
    double scale = 1;
    static readonly Dictionary<string, SolidColorBrush> palette = new Dictionary<string, SolidColorBrush>();
    static readonly Brush graphite = Wash("#3C495A", "#202A38"),
        pearl = Wash("#FEFFFF", "#D8E4F2"),
        ice = Wash("#DDFFFC", "#87E4EE"),
        rim = Wash("#FFFFFF", "#A7C5F3");
    static LinearGradientBrush Wash(string top, string bottom) {
        var brush = new LinearGradientBrush(ColorOf(top), ColorOf(bottom), new Point(.25, 0), new Point(.75, 1));
        brush.Freeze();
        return brush;
    }
    static SolidColorBrush Ink(string value) {
        SolidColorBrush brush;
        if (!palette.TryGetValue(value, out brush)) {
            brush = new SolidColorBrush(ColorOf(value));
            brush.Freeze();
            palette.Add(value, brush);
        }
        return brush;
    }
    static Color ColorOf(string value) {
        return (Color)ColorConverter.ConvertFromString(value);
    }
    static double Limit(double v, double lo, double hi) {
        return Math.Max(lo, Math.Min(v, hi));
    }
    static double Dist(Point a, Point b) {
        return (a - b).Length;
    }
    static int Px(double n) {
        return (int)Math.Round(n);
    }
    static string Id(string key) {
        return "Mini" + Char.ToUpperInvariant(key[0]) + key.Substring(1);
    }
    static ControlTemplate Pill(double radius) {
        var edge = new FrameworkElementFactory(typeof(Border));
        edge.SetValue(Border.CornerRadiusProperty, new CornerRadius(radius));
        edge.SetValue(Border.BackgroundProperty, new TemplateBindingExtension(Control.BackgroundProperty));
        edge.SetValue(Border.BorderBrushProperty, new TemplateBindingExtension(Control.BorderBrushProperty));
        edge.SetValue(Border.BorderThicknessProperty,
                      new TemplateBindingExtension(Control.BorderThicknessProperty));
        var child = new FrameworkElementFactory(typeof(ContentPresenter));
        child.SetValue(FrameworkElement.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        child.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);
        edge.AppendChild(child);
        return new ControlTemplate(typeof(Button)) { VisualTree = edge };
    }
    static Ellipse Oval(double w, double h, Brush fill) {
        return new Ellipse { Width = w, Height = h, Fill = fill };
    }
    static void Put(Canvas c, UIElement el, double x, double y) {
        c.Children.Add(el);
        Canvas.SetLeft(el, x);
        Canvas.SetTop(el, y);
    }
    void MakeOrb() {
        var pearl = new RadialGradientBrush { GradientOrigin = new Point(.25, .16),
                                              Center = new Point(.44, .35), RadiusX = .73, RadiusY = .74 };
        pearl.GradientStops.Add(new GradientStop(ColorOf("#FFFFFF"), 0));
        pearl.GradientStops.Add(new GradientStop(ColorOf("#E3FAFF"), .38));
        pearl.GradientStops.Add(new GradientStop(ColorOf("#B8C9FD"), .72));
        pearl.GradientStops.Add(new GradientStop(ColorOf("#A69ACD"), 1));
        orb.Width = orb.Height = OrbSize;
        orb.Template = Pill(OrbSize / 2);
        orb.Background = pearl;
        orb.BorderBrush = rim;
        orb.BorderThickness = new Thickness(1.5);
        var face = new Canvas { Width = 34, Height = 30, IsHitTestVisible = false };
        var mask = new Border { Width = 30, Height = 18, CornerRadius = new CornerRadius(9),
                                Background = Ink("#293849") };
        Put(face, mask, 2, 8);
        Put(face, Oval(4, 6, Ink("#DDFDFA")), 9, 13);
        Put(face, Oval(4, 6, Ink("#DDFDFA")), 21, 13);
        orb.Content = face;
        orb.Cursor = Cursors.Hand;
        orb.Open = delegate(bool open) {
            if (open)
                OpenMenu(true);
            else
                CloseMenu();
        };
        orb.Expanded = delegate {
            return menu;
        };
        orb.ToolTip = "单击或右键打开操作 · 长按快速对话 · 拖动移动";
        AutomationProperties.SetAutomationId(orb, "MiniOrb");
        AutomationProperties.SetName(orb, "CMspark Mini");
        AutomationProperties.SetHelpText(orb, "Enter、空格或菜单键打开操作，方向键选择，Esc 返回。");
        orb.Click += delegate {
            if (chatting)
                CloseChat();
            else if (!menu)
                OpenMenu(true);
            else
                CloseMenu();
        };
        orb.PreviewMouseLeftButtonDown += BeginGesture;
        orb.MouseRightButtonUp += delegate(object s, MouseButtonEventArgs e) {
            e.Handled = true;
            OpenMenu(true);
        };
        Panel.SetZIndex(orb, 5);
        scene.Children.Add(orb);
    }
    void MakeAction(int i) {
        string key = Keys[i];
        var plate =
            new PathShape { Visibility = Visibility.Collapsed, StrokeThickness = 1, IsHitTestVisible = true };
        plate.MouseLeftButtonUp += delegate(object s, MouseButtonEventArgs e) {
            e.Handled = true;
            Choose(key);
        };
        slices[key] = plate;
        scene.Children.Add(plate);
        var b = new Button { Width = 86,
                             Height = 33,
                             Template = Pill(16),
                             BorderThickness = new Thickness(1),
                             Visibility = Visibility.Collapsed,
                             Cursor = Cursors.Hand,
                             Foreground = Ink("#E9F4FC") };
        AutomationProperties.SetAutomationId(b, Id(key));
        AutomationProperties.SetName(b, Names[i]);
        var label = new StackPanel { Orientation = Orientation.Horizontal };
        label.Children.Add(new TextBlock { Text = Glyphs[i], FontFamily = new FontFamily("Segoe MDL2 Assets"),
                                           FontSize = 13, VerticalAlignment = VerticalAlignment.Center,
                                           Margin = new Thickness(0, 0, 4, 0) });
        var caption = key == "shot" ? branchLabel : new TextBlock();
        caption.Text = Labels[i];
        caption.FontFamily = new FontFamily("Microsoft YaHei UI");
        caption.FontSize = 11;
        caption.VerticalAlignment = VerticalAlignment.Center;
        label.Children.Add(caption);
        b.Content = label;
        b.Click += delegate {
            Choose(key);
        };
        b.GotKeyboardFocus += delegate {
            Highlight(key);
        };
        b.MouseEnter += delegate {
            if (!down) {
                if (key == "shot" && !sub) { sub = true; LayoutHost(); }
                Highlight(key);
            }
        };
        Panel.SetZIndex(b, 3);
        buttons[key] = b;
        scene.Children.Add(b);
    }
    static void Accessible(FrameworkElement el, string id, string label) {
        AutomationProperties.SetAutomationId(el, id);
        AutomationProperties.SetName(el, label);
    }
    static void ChatButton(Button b, string label, string id) {
        b.Content = label;
        b.Template = Pill(12);
        b.Height = 30;
        b.MinWidth = 46;
        b.Padding = new Thickness(8, 0, 8, 0);
        b.Background = Ink("#D5E4F5");
        b.Foreground = Ink("#20354A");
        b.BorderBrush = Ink("#8FA6BE");
        b.BorderThickness = new Thickness(1);
        Accessible(b, id, label);
    }
    void MakeChat() {
        chatCard.Padding = new Thickness(13);
        chatCard.CornerRadius = new CornerRadius(17);
        chatCard.Background = Ink("#F6F9FD");
        chatCard.BorderThickness = new Thickness(1);
        chatCard.BorderBrush = Ink("#9BBDC9");
        chatCard.Visibility = Visibility.Collapsed;
        var grid = new Grid();
        chatCard.Child = grid;
        foreach (var h in new[] { GridLength.Auto, new GridLength(1, GridUnitType.Star), GridLength.Auto,
                                  GridLength.Auto })
            grid.RowDefinitions.Add(new RowDefinition { Height = h });
        var header = new DockPanel();
        grid.Children.Add(header);
        var close = new Button();
        ChatButton(close, "收起", "MiniChatClose");
        DockPanel.SetDock(close, Dock.Right);
        header.Children.Add(close);
        close.Click += delegate {
            CloseChat();
        };
        header.Children.Add(new TextBlock { Text = "快速对话", FontSize = 15, FontWeight = FontWeights.SemiBold,
                                            Foreground = Ink("#1F354B"),
                                            VerticalAlignment = VerticalAlignment.Center });
        history.IsReadOnly = true;
        history.TextWrapping = TextWrapping.Wrap;
        history.AcceptsReturn = true;
        history.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        history.Background = Brushes.Transparent;
        history.BorderThickness = new Thickness(0);
        history.Margin = new Thickness(0, 8, 0, 4);
        history.Foreground = Ink("#273849");
        history.FontSize = 13;
        Accessible(history, "MiniChatHistory", "对话记录");
        Grid.SetRow(history, 1);
        grid.Children.Add(history);
        chatStatus.Foreground = Ink("#405F73");
        chatStatus.TextWrapping = TextWrapping.Wrap;
        chatStatus.FontSize = 12;
        chatStatus.Margin = new Thickness(0, 1, 0, 5);
        AutomationProperties.SetLiveSetting(chatStatus, AutomationLiveSetting.Polite);
        Accessible(chatStatus, "MiniChatStatus", "发送状态");
        Grid.SetRow(chatStatus, 2);
        grid.Children.Add(chatStatus);
        var footer = new DockPanel();
        Grid.SetRow(footer, 3);
        grid.Children.Add(footer);
        ChatButton(send, "发送", "MiniChatSend");
        send.Background = ice;
        send.Foreground = Ink("#11313D");
        send.BorderBrush = Ink("#69AFBC");
        send.Margin = new Thickness(6, 0, 0, 0);
        DockPanel.SetDock(send, Dock.Right);
        footer.Children.Add(send);
        draft.TextWrapping = TextWrapping.Wrap;
        draft.VerticalContentAlignment = VerticalAlignment.Center;
        draft.AcceptsReturn = true;
        draft.MinHeight = 32;
        draft.MaxHeight = 70;
        draft.MaxLength = 4000;
        draft.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        draft.Padding = new Thickness(5, 2, 5, 2);
        Accessible(draft, "MiniChatInput", "消息");
        footer.Children.Add(draft);
        send.Click += delegate {
            Submit();
        };
        draft.TextChanged += delegate {
            SendState();
        };
        draft.PreviewKeyDown += delegate(object o, KeyEventArgs e) {
            if (e.Key == Key.Enter && Keyboard.Modifiers == ModifierKeys.None) {
                e.Handled = true;
                Submit();
            }
        };
        Panel.SetZIndex(chatCard, 6);
        scene.Children.Add(chatCard);
        SendState();
    }
    void MakeNotice() {
        notice.PlacementTarget = orb;
        notice.Placement = PlacementMode.Bottom;
        notice.VerticalOffset = 4;
        notice.AllowsTransparency = true;
        var border = new Border { CornerRadius = new CornerRadius(10), Background = Ink("#F6F9FD"),
                                  Padding = new Thickness(10), BorderThickness = new Thickness(1),
                                  BorderBrush = Ink("#96A9C3") };
        var row = new DockPanel();
        border.Child = row;
        notice.Child = border;
        var close = new Button();
        ChatButton(close, "关闭", "MiniNoticeClose");
        close.Margin = new Thickness(8, 0, 0, 0);
        DockPanel.SetDock(close, Dock.Right);
        row.Children.Add(close);
        close.Click += delegate {
            ClearNotice();
        };
        noticeText.TextWrapping = TextWrapping.Wrap;
        noticeText.MaxWidth = 235;
        noticeText.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetLiveSetting(noticeText, AutomationLiveSetting.Polite);
        row.Children.Add(noticeText);
        noticeTimer.Interval = TimeSpan.FromSeconds(10);
        noticeTimer.Tick += delegate {
            ClearNotice();
        };
    }
    void ClearNotice() {
        noticeTimer.Stop();
        notice.IsOpen = false;
    }
    static string Decode(string value) {
        try {
            return new UTF8Encoding(false, true).GetString(Convert.FromBase64String(value));
        } catch (FormatException) {
            return null;
        } catch (DecoderFallbackException) {
            return null;
        }
    }
    void SendState() {
        send.IsEnabled = pending == null && !String.IsNullOrWhiteSpace(draft.Text);
        send.Opacity = send.IsEnabled ? 1 : .56;
    }
    void ShowHistory() {
        history.Text = String.Join("\r\n\r\n", turns.ToArray()) +
                       (pending == null ? "" : (turns.Count > 0 ? "\r\n\r\n" : "") + "我\r\n" + pending);
        history.ScrollToEnd();
    }
    void Submit() {
        if (!chatting || pending != null || String.IsNullOrWhiteSpace(draft.Text) || draft.Text.Length > 4000)
            return;
        pending = draft.Text;
        draft.IsReadOnly = true;
        chatStatus.Text = "正在回复…";
        SendState();
        ShowHistory();
        Emit("say:" + Convert.ToBase64String(Encoding.UTF8.GetBytes(pending)));
    }
    void Reply(string value, bool error) {
        if (pending == null || value.Length > 1048576)
            return;
        string content = Decode(value);
        if (content == null)
            return;
        if (error) {
            chatStatus.Text = content.Length == 0 ? "发送失败，请重试。" : content;
        } else {
            turns.Add("我\r\n" + pending);
            turns.Add("CMspark\r\n" + content);
            while (turns.Count > 24)
                turns.RemoveRange(0, 2);
            chatStatus.Text = "";
            draft.Clear();
        }
        pending = null;
        draft.IsReadOnly = false;
        SendState();
        ShowHistory();
        if (chatting)
            draft.Focus();
    }
    void OpenChat() {
        ClearNotice();
        menu = sub = false;
        hot = null;
        chatting = true;
        LayoutHost();
        Activate();
        draft.Focus();
        Emit("action:chat");
    }
    void CloseChat() {
        if (!chatting)
            return;
        chatting = false;
        if (pending != null) {
            pending = null;
            draft.IsReadOnly = false;
            chatStatus.Text = "";
            ShowHistory();
            SendState();
            Emit("chat-close");
        }
        LayoutHost();
        orb.Focus();
        HideWhenIdle();
    }
    OrbWindow() {
        Title = "CMspark Mini";
        Width = Height = Radius * 2;
        WindowStyle = WindowStyle.None;
        AllowsTransparency = true;
        Background = null;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        ShowActivated = false;
        Topmost = true;
        WindowStartupLocation = WindowStartupLocation.Manual;
        SizeToContent = SizeToContent.Manual;
        Content = scene;
        MakeOrb();
        MakeChat();
        MakeNotice();
        for (int i = 0; i < Keys.Length; i++)
            MakeAction(i);
        foreach (int seconds in new int[] { 3, 5, 10 }) {
            var time = new MenuItem { Header = "框选后 " + seconds + " 秒" };
            delayMenu.Items.Add(time);
            foreach (string leaf in Leaves) {
                if (leaf == "delay") continue;
                string action = leaf;
                int delay = seconds;
                var item = new MenuItem { Header = Labels[Array.IndexOf(Keys, action)] };
                item.Click += delegate { RunAction(action, delay); };
                time.Items.Add(item);
            }
        }
        hold.Interval = TimeSpan.FromMilliseconds(450);
        hold.Tick += delegate {
            hold.Stop();
            if (down && !moving) {
                ResetGesture();
                OpenChat();
            }
        };
        PreviewMouseMove += OnMove;
        PreviewMouseLeftButtonUp += OnRelease;
        PreviewKeyDown += OnKey;
        LostMouseCapture += delegate {
            if (down) {
                ResetGesture();
                CloseMenu();
            }
        };
        Deactivated += delegate {
            if (menu && !down && !delayMenu.IsOpen)
                CloseMenu();
        };
        SourceInitialized += delegate {
            handle = new WindowInteropHelper(this).Handle;
            ((HwndSource)PresentationSource.FromVisual(this)).AddHook(WinEvent);
            var w = Work(new Pixel(0, 0));
            anchor = new Pixel(w.Right - Px(64 * scale), (w.Top + w.Bottom) / 2);
            ReadPosition();
            LayoutHost();
        };
    }
    IntPtr WinEvent(IntPtr hwnd, int msg, IntPtr wp, IntPtr lp, ref bool handled) {
        if ((msg == 0x007e || msg == 0x02e0 || msg == 0x001a) && !layingOut) {
            Dispatcher.BeginInvoke(DispatcherPriority.Background, new Action(delegate {
                                       if (IsVisible)
                                           LayoutHost();
                                   }));
        }
        return IntPtr.Zero;
    }
    RectPx Work(Pixel center) {
        var m = MonitorFromPoint(center, 2);
        var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
        if (!GetMonitorInfo(m, ref info))
            throw new InvalidOperationException("Cannot determine display work area");
        uint dx, dy;
        try {
            scale = GetDpiForMonitor(m, 0, out dx, out dy) == 0 ? dx / 96.0 : 1;
        } catch (EntryPointNotFoundException) {
            scale = 1;
        } catch (DllNotFoundException) {
            scale = 1;
        }
        return info.Work;
    }
    void ReadPosition() {
        try {
            if (String.IsNullOrEmpty(positionFile) || !System.IO.Path.IsPathRooted(positionFile))
                return;
            var f = new FileInfo(positionFile);
            if (!f.Exists || f.Length > 100)
                return;
            string[] xy = File.ReadAllText(positionFile).Trim().Split(',');
            int x, y;
            if (xy.Length == 2 &&
                Int32.TryParse(xy[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out x) &&
                Int32.TryParse(xy[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out y))
                anchor = new Pixel(x, y);
        } catch (IOException) {
        } catch (UnauthorizedAccessException) {
        } catch (ArgumentException) {
        } catch (NotSupportedException) {}
    }
    void SavePosition() {
        if (String.IsNullOrEmpty(positionFile) || !System.IO.Path.IsPathRooted(positionFile))
            return;
        string tmp = null;
        try {
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(positionFile));
            tmp = positionFile + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllText(tmp, String.Format(CultureInfo.InvariantCulture, "{0},{1}", anchor.X, anchor.Y));
            if (File.Exists(positionFile))
                File.Replace(tmp, positionFile, null);
            else
                File.Move(tmp, positionFile);
        } catch (IOException) {
        } catch (UnauthorizedAccessException) {
        } catch (ArgumentException) {
        } catch (NotSupportedException) {
        } finally {
            if (tmp != null) {
                try {
                    File.Delete(tmp);
                } catch (IOException) {
                } catch (UnauthorizedAccessException) {}
            }
        }
    }
    void LayoutHost() {
        if (handle == IntPtr.Zero || layingOut)
            return;
        layingOut = true;
        try {
            var work = Work(anchor);
            int border = Px(Radius * scale);
            anchor.X = Px(Limit(anchor.X, work.Left + border, work.Right - border));
            anchor.Y = Px(Limit(anchor.Y, work.Top + border, work.Bottom - border));
            // The saved anchor is a physical desktop pixel, including negative monitor coordinates.
            // Only the visible content takes up an HWND. WPF draws the menu in monitor-local DIPs.
            double availableW = (work.Right - work.Left) / scale, availableH = (work.Bottom - work.Top) / scale;
            int sx = anchor.X - work.Left < work.Right - anchor.X ? 1 : -1,
                sy = anchor.Y - work.Top < work.Bottom - anchor.Y ? 1 : -1;
            double w = chatting ? Math.Min(366, availableW)
                       : menu   ? Math.Min(325, availableW)
                                : 2 * Radius,
                   h = chatting ? Math.Min(363, availableH)
                       : menu   ? Math.Min(239, availableH)
                                : 2 * Radius;
            int left =
                Px(Limit(anchor.X - (sx > 0 ? Radius : w - Radius) * scale, work.Left, work.Right - w * scale));
            int top =
                Px(Limit(anchor.Y - (sy > 0 ? Radius : h - Radius) * scale, work.Top, work.Bottom - h * scale));
            Width = w;
            Height = h;
            SetWindowPos(handle, IntPtr.Zero, left, top, Px(w * scale), Px(h * scale), 0x0014);
            orbCenter = new Point((anchor.X - left) / scale, (anchor.Y - top) / scale);
            Canvas.SetLeft(orb, orbCenter.X - OrbSize / 2);
            Canvas.SetTop(orb, orbCenter.Y - OrbSize / 2);
            chatCard.Visibility = chatting ? Visibility.Visible : Visibility.Collapsed;
            if (chatting) {
                chatCard.Width = w - 4;
                double y = sy > 0 ? orbCenter.Y + Radius + 2 : 2;
                chatCard.Height = Math.Max(1, sy > 0 ? h - y - 2 : orbCenter.Y - Radius - 4);
                Canvas.SetLeft(chatCard, 2);
                Canvas.SetTop(chatCard, y);
            }
            if (menu) {
                branchLabel.Text = sx > 0 ? "截图  ›" : "‹  截图";
                double fx = Math.Min(1, ((sx > 0 ? w - orbCenter.X : orbCenter.X) - 45) / 234.0);
                double fy = Math.Min(1, ((sy > 0 ? h - orbCenter.Y : orbCenter.Y) - 18) / 180.0);
                SetCenter("chat", 102, 1, sx, sy, fx, fy);
                SetCenter("shot", 96, 63, sx, sy, fx, fy);
                SetCenter("search", 64, 119, sx, sy, fx, fy);
                SetCenter("meeting", 27, 178, sx, sy, fx, fy);
                SetCenter("todo", 210, 12, sx, sy, fx, fy);
                SetCenter("ask", 234, 65, sx, sy, fx, fy);
                SetCenter("ocr", 216, 122, sx, sy, fx, fy);
                SetCenter("capture", 160, 180, sx, sy, fx, fy);
                SetCenter("delay", 252, 180, sx, sy, fx, fy);
            }
            foreach (string k in Keys) {
                bool root = Array.IndexOf(Roots, k) >= 0, shown = menu && (root || sub);
                buttons[k].Visibility = slices[k].Visibility =
                    shown ? Visibility.Visible : Visibility.Collapsed;
                if (!shown)
                    continue;
                var c = centers[k];
                Canvas.SetLeft(buttons[k], c.X - buttons[k].Width / 2);
                Canvas.SetTop(buttons[k], c.Y - buttons[k].Height / 2);
                slices[k].Data = Slice(root ? orbCenter : centers["shot"], c, root ? 32 : 44, root ? .24 : .20);
            }
            if (menu)
                Highlight(hot);
        } finally {
            layingOut = false;
        }
    }
    void SetCenter(string k, double x, double y, int sx, int sy, double fx, double fy) {
        centers[k] = new Point(orbCenter.X + x * sx * fx, orbCenter.Y + y * sy * fy);
    }
    static Point Polar(Point origin, double r, double a) {
        return new Point(origin.X + r * Math.Cos(a), origin.Y + r * Math.Sin(a));
    }
    static StreamGeometry Slice(Point origin, Point center, double inner, double spread) {
        double angle = Math.Atan2(center.Y - origin.Y, center.X - origin.X), outer = Dist(origin, center) + 20;
        var g = new StreamGeometry();
        using (var c = g.Open()) {
            c.BeginFigure(Polar(origin, inner, angle - spread), true, true);
            c.LineTo(Polar(origin, outer, angle - spread), true, false);
            c.ArcTo(Polar(origin, outer, angle + spread), new Size(outer, outer), 0, false,
                    SweepDirection.Clockwise, true, false);
            c.LineTo(Polar(origin, inner, angle + spread), true, false);
            c.ArcTo(Polar(origin, inner, angle - spread), new Size(inner, inner), 0, false,
                    SweepDirection.Counterclockwise, true, false);
        }
        g.Freeze();
        return g;
    }
    void Highlight(string k) {
        hot = k;
        foreach (string item in Keys) {
            bool on = item == k || (item == "shot" && sub);
            bool leaf = Array.IndexOf(Leaves, item) >= 0;
            buttons[item].Background = on ? ice : leaf ? pearl : graphite;
            buttons[item].Foreground = on ? Ink("#11313D") : leaf ? Ink("#223144") : Ink("#F3F7FF");
            buttons[item].BorderBrush = on ? Ink("#CEFFFF") : leaf ? Ink("#F1F9FF") : Ink("#A291A9BA");
            slices[item].Fill = on ? Ink("#A478D5DC") : leaf ? Ink("#61D5E2EF") : Ink("#25394656");
            slices[item].Stroke = on ? Ink("#D6BAFCFF") : leaf ? Ink("#9BC4D4E2") : Ink("#7490A2B2");
        }
    }
    void OpenMenu(bool focus) {
        ClearNotice();
        if (chatting)
            CloseChat();
        menu = true;
        LayoutHost();
        if (focus) {
            Activate();
            buttons["chat"].Focus();
        }
    }
    void CloseMenu() {
        menu = sub = false;
        hot = null;
        LayoutHost();
        HideWhenIdle();
    }
    void HideWhenIdle() {
        if (temporary)
            Dispatcher.BeginInvoke(DispatcherPriority.Background, new Action(delegate {
                if (temporary && !menu && !chatting && !down)
                    Hide();
            }));
    }
    void Choose(string key) {
        if (key == "shot") {
            sub = true;
            LayoutHost();
            if (!down)
                buttons["todo"].Focus();
        } else if (key == "delay") {
            delayMenu.PlacementTarget = buttons["delay"];
            delayMenu.IsOpen = true;
        } else
            RunAction(key);
    }
    void RunAction(string key, int seconds = 0) {
        if (key == "chat") {
            OpenChat();
            return;
        }
        CloseMenu();
        if (Array.IndexOf(Leaves, key) >= 0)
            Hide();
        Emit("action:" + key + (seconds == 0 ? "" : ":" + seconds));
    }
    static void Emit(string line) {
        Console.WriteLine(line);
        Console.Out.Flush();
    }
    Point AtScreen(MouseEventArgs e) {
        return scene.PointToScreen(e.GetPosition(scene));
    }
    void BeginGesture(object sender, MouseButtonEventArgs e) {
        e.Handled = true;
        if (chatting) {
            CloseChat();
            return;
        }
        if (menu) {
            CloseMenu();
            return;
        }
        Point p = AtScreen(e);
        press = new Pixel(Px(p.X), Px(p.Y));
        pressAnchor = anchor;
        down = true;
        moving = false;
        orb.Focus();
        orb.BorderBrush = Ink("#91EDF2");
        orb.CaptureMouse();
        hold.Start();
    }
    void ResetGesture() {
        hold.Stop();
        down = moving = false;
        orb.BorderBrush = rim;
        if (orb.IsMouseCaptured)
            orb.ReleaseMouseCapture();
    }
    void OnMove(object sender, MouseEventArgs e) {
        if (!down)
            return;
        Point p = AtScreen(e);
        int dx = Px(p.X) - press.X, dy = Px(p.Y) - press.Y;
        if (!moving && Math.Max(Math.Abs(dx), Math.Abs(dy)) < 6 * scale)
            return;
        hold.Stop();
        moving = true;
        anchor = new Pixel(pressAnchor.X + dx, pressAnchor.Y + dy);
        LayoutHost();
    }
    void OnRelease(object sender, MouseButtonEventArgs e) {
        if (!down)
            return;
        e.Handled = true;
        bool drag = moving;
        ResetGesture();
        if (drag) SavePosition();
        else OpenMenu(true);
    }
    void OnKey(object s, KeyEventArgs e) {
        if (chatting) {
            if (e.Key == Key.Escape) {
                e.Handled = true;
                CloseChat();
            }
            return;
        }
        if (e.Key == Key.Escape) {
            e.Handled = true;
            if (down) {
                ResetGesture();
                CloseMenu();
            } else if (sub) {
                sub = false;
                LayoutHost();
                buttons["shot"].Focus();
            } else {
                CloseMenu();
                orb.Focus();
            }
            return;
        }
        if (!menu) {
            if (e.Key == Key.Space || e.Key == Key.Apps ||
                (e.Key == Key.F10 && Keyboard.Modifiers == ModifierKeys.Shift) || e.Key == Key.Down) {
                e.Handled = true;
                OpenMenu(true);
            }
            return;
        }
        var b = Keyboard.FocusedElement as Button;
        string current = null;
        foreach (var pair in buttons)
            if (pair.Value == b)
                current = pair.Key;
        if (e.Key == Key.Enter && current != null) {
            e.Handled = true;
            Choose(current);
            return;
        }
        if (e.Key == Key.Left && sub) {
            e.Handled = true;
            sub = false;
            LayoutHost();
            buttons["shot"].Focus();
            return;
        }
        if (e.Key == Key.Right && current == "shot") {
            e.Handled = true;
            Choose("shot");
            return;
        }
        if (e.Key == Key.Down || e.Key == Key.Up || e.Key == Key.Left || e.Key == Key.Right ||
            e.Key == Key.Tab) {
            e.Handled = true;
            var group = sub ? Leaves : Roots;
            int i = Array.IndexOf(group, current),
                d = (e.Key == Key.Up || e.Key == Key.Left ||
                     (e.Key == Key.Tab && Keyboard.Modifiers == ModifierKeys.Shift))
                        ? -1
                        : 1;
            buttons[group[(i + d + group.Length) % group.Length]].Focus();
        }
    }
    void Command(string command) {
        if (command != null && command.StartsWith("invoke:", StringComparison.Ordinal)) {
            string key = command.Substring(7);
            if (key != "summon" && Array.IndexOf(Keys, key) < 0)
                return;
            ResetGesture();
            ClearNotice();
            if (key == "chat" || key == "shot" || key == "summon") {
                if (!IsVisible)
                    Show();
                if (key == "chat")
                    OpenChat();
                else {
                    sub = false;
                    hot = null;
                    OpenMenu(true);
                    if (key == "shot")
                        Choose("shot");
                }
            } else {
                CloseChat();
                RunAction(key);
            }
            return;
        }
        if (command != null && command.StartsWith("notice:", StringComparison.Ordinal)) {
            if (command.Length > 8192)
                return;
            string message = Decode(command.Substring(7));
            if (String.IsNullOrWhiteSpace(message))
                return;
            ClearNotice();
            if (!IsVisible)
                Show();
            noticeText.Text = message;
            notice.IsOpen = true;
            noticeTimer.Start();
            return;
        }
        if (command != null && (command.StartsWith("reply:", StringComparison.Ordinal) ||
                                command.StartsWith("error:", StringComparison.Ordinal))) {
            Reply(command.Substring(6), command[0] == 'e');
            return;
        }
        if (command == "hide") {
            ClearNotice();
            ResetGesture();
            CloseChat();
            CloseMenu();
            Hide();
        } else if (command == "show") {
            temporary = false;
            LayoutHost();
            if (!IsVisible)
                Show();
        } else if (command == "quit" || command == null) {
            ResetGesture();
            Application.Current.Shutdown();
        }
    }
    public static void Run() {
        string file = Environment.GetEnvironmentVariable("CMSPARK_MINI_POSITION_FILE");
        if (String.IsNullOrEmpty(file)) { RunOwned(); return; }
        string name;
        using (var hash = System.Security.Cryptography.SHA256.Create()) {
            byte[] key = Encoding.UTF8.GetBytes(System.IO.Path.GetFullPath(file).ToUpperInvariant());
            name = @"Local\CMspark.Mini." + BitConverter.ToString(hash.ComputeHash(key));
        }
        bool owner;
        using (var mutex = new Mutex(true, name, out owner)) {
            if (!owner) return;
            try { RunOwned(); } finally { mutex.ReleaseMutex(); }
        }
    }
    static void RunOwned() {
        try {
            SetThreadDpiAwarenessContext(new IntPtr(-4));
        } catch (EntryPointNotFoundException) {}
        var app = new Application();
        var window = new OrbWindow();
        window.ContentRendered += delegate {
            if (window.Tag != null)
                return;
            window.Tag = "ready";
            Emit("ready");
            var reader = new Thread(delegate() {
                try {
                    while (true) {
                        string line = Console.ReadLine();
                        window.Dispatcher.BeginInvoke(new Action(delegate { window.Command(line); }));
                        if (line == null || line == "quit")
                            break;
                    }
                } catch (IOException) {
                    window.Dispatcher.BeginInvoke(new Action(delegate { window.Command(null); }));
                }
            });
            reader.IsBackground = true;
            reader.Start();
        };
        app.Run(window);
    }
}
}
'@
[CMspark.Mini.OrbWindow]::Run()
