# GitHub #723 unshipped fixed-content window. No user-window enumeration or input.
param([Parameter(Mandatory=$true)][ValidateSet('printwindow','minimized','nonforeground','partial','occluded')][string]$Mode,
 [Parameter(Mandatory=$true)][string]$Ready, [Parameter(Mandatory=$true)][string]$VerifyRequest,
 [Parameter(Mandatory=$true)][string]$Verified)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { throw 'D1_723_DESKTOP51_REQUIRED' }
Microsoft.PowerShell.Utility\Add-Type -AssemblyName PresentationFramework
Microsoft.PowerShell.Utility\Add-Type -AssemblyName PresentationCore
Microsoft.PowerShell.Utility\Add-Type -AssemblyName WindowsBase
Microsoft.PowerShell.Utility\Add-Type -AssemblyName System.Xaml
$refs = @([System.Windows.Window].Assembly.Location, [System.Windows.Media.Brushes].Assembly.Location, [System.Windows.Threading.Dispatcher].Assembly.Location, [System.Xaml.XamlReader].Assembly.Location, [System.IO.FileSystemWatcher].Assembly.Location)
Microsoft.PowerShell.Utility\Add-Type -ReferencedAssemblies $refs -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using System.Windows.Interop;
public static class CaptureFixture723 {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll", EntryPoint="SetWindowLongW")] static extern int SetWindowLong(IntPtr hwnd, int index, int value);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  static Window Pattern(bool overlay) {
    var w = new Window { Title="CMspark fixed capture acceptance 723", Left=80, Top=80, Width=420, Height=240,
      WindowStartupLocation=WindowStartupLocation.Manual, ResizeMode=ResizeMode.NoResize, Topmost=true };
    var grid = new Grid { Background=Brushes.White };
    grid.Children.Add(new System.Windows.Shapes.Rectangle { Width=150, Height=100, Fill=Brushes.Black, HorizontalAlignment=HorizontalAlignment.Left, VerticalAlignment=VerticalAlignment.Top });
    w.Content=grid;
    if (overlay) { w.Left=140; w.Top=140; w.Width=120; w.Height=90; w.ShowActivated=false;
      w.SourceInitialized += delegate { var h=new WindowInteropHelper(w).Handle; SetWindowLong(h,-20,GetWindowLong(h,-20)|0x08000000); if((GetWindowLong(h,-20)&0x08000000)==0) throw new InvalidOperationException("D1_723_NOACTIVATE_REQUIRED"); };
    }
    return w;
  }
  static void Publish(string file, Window target, Window other) {
    var h=new WindowInteropHelper(target).Handle;
    var o=other==null ? IntPtr.Zero : new WindowInteropHelper(other).Handle;
    uint pid; uint self=(uint)System.Diagnostics.Process.GetCurrentProcess().Id;
    if(!IsWindow(h) || GetWindowThreadProcessId(h,out pid)==0 || pid!=self ||
      (o!=IntPtr.Zero && (!IsWindow(o) || !IsWindowVisible(o) || GetWindowThreadProcessId(o,out pid)==0 || pid!=self))) throw new InvalidOperationException("D1_723_OWNED_WINDOW_REQUIRED");
    string json="{\"hwnd\":"+h.ToInt64()+",\"other\":"+o.ToInt64()+",\"foreground\":"+GetForegroundWindow().ToInt64()+",\"minimized\":"+(IsIconic(h)?"true":"false")+",\"desktop51\":true}";
    using(var s=new FileStream(file+".pending",FileMode.CreateNew,FileAccess.Write,FileShare.None))
    using(var writer=new StreamWriter(s,new System.Text.UTF8Encoding(false))) writer.Write(json);
    File.Move(file+".pending",file);
  }
  public static void Run(string mode,string ready,string request,string verified) {
    Window target=Pattern(false), other=null;
    var dispatcher=target.Dispatcher;
    bool rendered=false, verifiedOnce=false;
    var watcher=new FileSystemWatcher(Path.GetDirectoryName(request),Path.GetFileName(request));
    watcher.NotifyFilter=NotifyFilters.FileName;
    Action verify=delegate {
      if (!rendered || verifiedOnce || !File.Exists(request)) return;
      verifiedOnce=true; Publish(verified,target,other);
    };
    watcher.Created += delegate { dispatcher.BeginInvoke(verify); };
    watcher.EnableRaisingEvents=true;
    target.ContentRendered += delegate {
      if(rendered) return; rendered=true;
      if(mode=="minimized" || mode=="nonforeground") {
        other=Pattern(false); other.Left=600; other.Show(); other.Activate();
        if(mode=="minimized") target.WindowState=WindowState.Minimized;
      } else {
        target.Activate();
        if(mode=="occluded") { other=Pattern(true); other.Show(); }
      }
      Publish(ready,target,other); verify();
    };
    var timer=new DispatcherTimer { Interval=TimeSpan.FromSeconds(45) };
    timer.Tick += delegate { timer.Stop(); target.Close(); };
    target.Closed += delegate { if(other!=null) other.Close(); };
    timer.Start();
    try { target.ShowDialog(); } finally { timer.Stop(); watcher.Dispose(); if(other!=null) other.Close(); }
  }
}
'@
[CaptureFixture723]::Run($Mode,$Ready,$VerifyRequest,$Verified)
