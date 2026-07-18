# S-5 spike target: self-drawn WinForms test window (STA). Own process, medium IL.
# Exposes: ready.json (hwnd/rects), state.json (clicks/text/keys/injected), consumes cmd-*.txt files.
param([string]$OutDir = $PSScriptRoot)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'

Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr v);' -Name DPI -Namespace S5
[S5.DPI]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null  # PerMonitorV2

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

# Low-level keyboard hook: count key events + injected-flag (LLKHF_INJECTED=0x10)
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class LLK {
  public static int Keys; public static int Injected;
  private static IntPtr hook = IntPtr.Zero;
  private delegate IntPtr Proc(int n, IntPtr w, IntPtr l);
  private static Proc proc = HookProc;
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Proc cb, IntPtr mod, uint tid);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int n, IntPtr w, IntPtr l);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string n);
  public static void Start(){ Keys=0; Injected=0; if(hook==IntPtr.Zero) hook = SetWindowsHookEx(13, proc, GetModuleHandle(null), 0); }
  public static void Stop(){ if(hook!=IntPtr.Zero){ UnhookWindowsHookEx(hook); hook=IntPtr.Zero; } }
  static IntPtr HookProc(int n, IntPtr w, IntPtr l){
    if(n>=0){ Keys++; int flags = Marshal.ReadInt32(l, 8); if((flags & 0x10)!=0) Injected++; }
    return CallNextHookEx(hook, n, w, l);
  }
}
'@

$script:clicks = 0
$form = New-Object Windows.Forms.Form -Property @{ Text = 'S5-TEST-WINDOW'; Width = 560; Height = 400; StartPosition = 'Manual'; Location = (New-Object Drawing.Point(260, 180)) }
$tb   = New-Object Windows.Forms.TextBox -Property @{ Left = 20; Top = 20; Width = 500; Height = 90; Multiline = $true }
$btn  = New-Object Windows.Forms.Button -Property @{ Left = 20; Top = 130; Width = 220; Height = 44; Text = 'S5-BUTTON' }
$btn.Add_Click({ $script:clicks++; $btn.Text = "clicked:$($script:clicks)" })
$thief = New-Object Windows.Forms.Form -Property @{ Text = 'S5-THIEF'; Width = 300; Height = 160; StartPosition = 'Manual'; Location = (New-Object Drawing.Point(900, 500)) }
$form.Controls.Add($tb); $form.Controls.Add($btn)
$form.Show()

[LLK]::Start()

# ready.json
$rect = [ordered]@{ x = $form.Location.X; y = $form.Location.Y; w = $form.Width; h = $form.Height }
[ordered]@{
  hwnd = $form.Handle.ToInt64(); pid = $PID
  rect = $rect
  btnScreen = $null  # filled on first tick
} | ConvertTo-Json | Set-Content (Join-Path $OutDir 'ready.json') -Encoding UTF8

$timer = New-Object Windows.Forms.Timer -Property @{ Interval = 250 }
$timer.Add_Tick({
  try {
    $btnPt = $btn.PointToScreen((New-Object Drawing.Point([int]($btn.Width/2), [int]($btn.Height/2))))
    $state = [ordered]@{
      clicks = $script:clicks; text = $tb.Text
      keys = [LLK]::Keys; injected = [LLK]::Injected
      btnCenter = @{ x = $btnPt.X; y = $btnPt.Y }
      tbFocused = $tb.Focused
    }
    $state | ConvertTo-Json -Compress | Set-Content (Join-Path $OutDir 'state.json') -Encoding UTF8
    # command channel
    $cmd = Get-ChildItem (Join-Path $OutDir 'cmd-*.txt') -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) {
      $c = (Get-Content $cmd.FullName -Raw).Trim()
      Remove-Item $cmd.FullName -Force
      switch -Regex ($c) {
        '^focus-thief$' { $thief.Show(); $thief.Activate() }
        '^hide-thief$'  { $thief.Hide() }
        '^focus-tb$'    { $form.Activate(); $tb.Focus() }
        '^clear$'       { $tb.Clear(); $script:clicks = 0; [LLK]::Keys = 0; [LLK]::Injected = 0 }
        '^ime-on:(.+)$' {
          $want = $Matches[1]
          $il = [Windows.Forms.InputLanguage]::InstalledInputLanguages | Where-Object { $_.Culture.Name -eq $want } | Select-Object -First 1
          if ($il) { $tb.Focus(); [Windows.Forms.InputLanguage]::CurrentInputLanguage = $il }
          Set-Content (Join-Path $OutDir 'ime-ack.txt') -Value $(if ($il) { "OK:$($il.LayoutName)" } else { 'NONE' }) -Encoding UTF8
        }
      }
    }
  } catch {}
})
$timer.Start()
[Windows.Forms.Application]::Run($form)
[LLK]::Stop()
