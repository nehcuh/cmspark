# An interactive drag produces one PNG on stdout. Escape, right-click and focus loss produce no bytes.
param([Parameter(Mandatory=$true)][int]$OwnerPid, [ValidateSet(0,3,5,10)][int]$DelaySeconds = 0)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public sealed class MiniRegionPicker : Form {
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll", SetLastError=true)] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("dwmapi.dll")] static extern int DwmFlush();
  readonly Rectangle desktop;
  readonly Timer ownerWatch = new Timer();
  Point? anchor;
  Point tip;
  Rectangle selection;

  MiniRegionPicker(Process owner) {
    desktop = VirtualDesktop();
    if (desktop.Width <= 0 || desktop.Height <= 0) throw new InvalidOperationException();
    Text = "CMspark Mini - Select region";
    FormBorderStyle = FormBorderStyle.None;
    StartPosition = FormStartPosition.Manual;
    AutoScaleMode = AutoScaleMode.None;
    Bounds = desktop;
    TopMost = true;
    ShowInTaskbar = false;
    KeyPreview = true;
    DoubleBuffered = true;
    Opacity = 0.34;
    BackColor = Color.Black;
    Cursor = Cursors.Cross;
    ownerWatch.Interval = 400;
    ownerWatch.Tick += delegate { if (owner.HasExited || VirtualDesktop() != desktop) Cancel(); };
  }

  static Rectangle VirtualDesktop() {
    // SM_XVIRTUALSCREEN / SM_YVIRTUALSCREEN can both be negative.
    return new Rectangle(GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79));
  }

  protected override void OnShown(EventArgs e) {
    base.OnShown(e);
    // WinForms initially applies primary-screen sizing rules. Place and validate the actual client bounds.
    if (!SetWindowPos(Handle, new IntPtr(-1), desktop.X, desktop.Y, desktop.Width, desktop.Height, 0x40)
      || RectangleToScreen(ClientRectangle) != desktop) throw new InvalidOperationException("DESKTOP_BOUNDS");
    Activate();
    ownerWatch.Start();
  }

  void Cancel() { anchor = null; DialogResult = DialogResult.Cancel; }

  protected override bool ProcessCmdKey(ref Message message, Keys key) {
    if (key == Keys.Escape) { Cancel(); return true; }
    return base.ProcessCmdKey(ref message, key);
  }
  protected override void OnDeactivate(EventArgs e) {
    base.OnDeactivate(e);
    if (Visible && DialogResult == DialogResult.None) Cancel();
  }
  protected override void OnMouseDown(MouseEventArgs e) {
    base.OnMouseDown(e);
    if (e.Button == MouseButtons.Right) { Cancel(); return; }
    if (e.Button != MouseButtons.Left) return;
    anchor = tip = e.Location;
    Capture = true;
    Invalidate();
  }
  protected override void OnMouseMove(MouseEventArgs e) {
    base.OnMouseMove(e);
    if (anchor.HasValue) { tip = e.Location; Invalidate(); }
  }
  protected override void OnMouseCaptureChanged(EventArgs e) {
    base.OnMouseCaptureChanged(e);
    if (anchor.HasValue && !Capture) Cancel();
  }
  Rectangle DragRect(Point a, Point b) {
    return Rectangle.Intersect(ClientRectangle, Rectangle.FromLTRB(Math.Min(a.X,b.X), Math.Min(a.Y,b.Y), Math.Max(a.X,b.X), Math.Max(a.Y,b.Y)));
  }
  protected override void OnMouseUp(MouseEventArgs e) {
    base.OnMouseUp(e);
    if (e.Button != MouseButtons.Left || !anchor.HasValue) return;
    Rectangle crop = DragRect(anchor.Value, e.Location);
    anchor = null;
    Capture = false;
    if (crop.Width < 2 || crop.Height < 2) { Cancel(); return; }
    selection = RectangleToScreen(crop);
    DialogResult = DialogResult.OK;
  }
  protected override void OnPaint(PaintEventArgs e) {
    base.OnPaint(e);
    if (!anchor.HasValue) return;
    Rectangle rect = DragRect(anchor.Value, tip);
    if (rect.Width == 0 || rect.Height == 0) return;
    using (var pen = new Pen(Color.White, 3)) {
      pen.DashStyle = DashStyle.Dash;
      e.Graphics.DrawRectangle(pen, rect);
    }
  }
  protected override void Dispose(bool disposing) {
    if (disposing) ownerWatch.Dispose();
    base.Dispose(disposing);
  }

  public static void Run(int ownerPid, int delaySeconds) {
    var previous = SetThreadDpiAwarenessContext(new IntPtr(-4)); // PER_MONITOR_AWARE_V2
    if (previous == IntPtr.Zero) throw new InvalidOperationException("DPI_CONTEXT");
    try {
      Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
      using (Process owner = Process.GetProcessById(ownerPid))
      using (var form = new MiniRegionPicker(owner)) {
        if (form.ShowDialog() != DialogResult.OK || owner.HasExited) return;
        Rectangle r = form.selection;
        if (r.Width > 8192 || r.Height > 8192 || (long)r.Width * r.Height > 16777216) throw new InvalidOperationException("MINI_REGION_TOO_LARGE");
        form.Hide();
        // Let the target application receive clicks and hover events before sampling the selected pixels.
        if (delaySeconds > 0 && owner.WaitForExit(delaySeconds * 1000)) return;
        if (DwmFlush() != 0 || VirtualDesktop() != form.desktop) throw new InvalidOperationException("DESKTOP_CHANGED");
        using (var bitmap = new Bitmap(r.Width, r.Height, PixelFormat.Format24bppRgb))
        using (var encoded = new MemoryStream()) {
          using (var g = Graphics.FromImage(bitmap)) g.CopyFromScreen(r.Location, Point.Empty, r.Size);
          bitmap.Save(encoded, ImageFormat.Png);
          if (encoded.Length > 6 * 1024 * 1024) throw new InvalidOperationException("MINI_REGION_TOO_LARGE");
          if (owner.HasExited) return;
          encoded.Position = 0;
          encoded.CopyTo(Console.OpenStandardOutput());
        }
      }
    } finally { SetThreadDpiAwarenessContext(previous); }
  }
}
'@
  [MiniRegionPicker]::Run($OwnerPid, $DelaySeconds)
} catch {
  $message = $_.Exception.GetBaseException().Message
  if ($message -eq 'MINI_REGION_TOO_LARGE') { [Console]::Error.WriteLine('MINI_REGION_TOO_LARGE') }
  else { [Console]::Error.WriteLine('MINI_REGION_CAPTURE_FAILED') }
  exit 1
}
