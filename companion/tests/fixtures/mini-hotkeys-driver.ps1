param([Parameter(Mandatory)][string]$HostScript, [Parameter(Mandatory)][string]$BindingsFile, [switch]$OwnershipOnly)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ShortcutKeys {
    [StructLayout(LayoutKind.Sequential)] struct Mouse { public int X,Y; public uint Data,Flags,Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] struct Keyboard { public ushort Key,Scan; public uint Flags,Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Explicit)] struct InputData {
        [FieldOffset(0)] public Mouse Mouse;
        [FieldOffset(0)] public Keyboard Keyboard;
    }
    [StructLayout(LayoutKind.Sequential)] struct Input { public uint Type; public InputData Data; }
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left,Top,Right,Bottom; }
    [DllImport("user32.dll")] static extern uint SendInput(uint count,Input[] input,int size);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hwnd,int id,uint mods,uint key);
    [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hwnd,int id);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after,int x,int y,int w,int h,uint flags);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd,uint flag);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    static void Send(Input[] inputs) {
        if(SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(Input)))!=inputs.Length)
            throw new Exception("SendInput failed");
    }
    public static void Focus(IntPtr hwnd) {
        SetForegroundWindow(hwnd);
        if(GetForegroundWindow()==hwnd)return;
        Point old;if(!GetCursorPos(out old))throw new Exception("Input desktop is unavailable");
        bool raised=false;var p=new Point();
        var until=System.Diagnostics.Stopwatch.StartNew();
        try {
            for(;;){
                if(GetForegroundWindow()==hwnd)return;
                Rect r;if(!GetWindowRect(hwnd,out r))throw new Exception("Invalid test window");
                // The title bar handles activation without editing any settings.
                p=new Point{X=(r.Left+r.Right)/2,Y=r.Top+16};
                if(GetAncestor(WindowFromPoint(p),2)==hwnd){
                    SetCursorPos(p.X,p.Y);
                    if(GetAncestor(WindowFromPoint(p),2)==hwnd)break;
                }
                if(!raised){
                    if(!SetWindowPos(hwnd,new IntPtr(-1),0,0,0,0,0x13))throw new Exception("Cannot raise test window");
                    raised=true;
                }
                if(until.ElapsedMilliseconds>1500)throw new Exception("Test window is not available for input");
                System.Windows.Forms.Application.DoEvents();
                System.Threading.Thread.Sleep(15);
            }
            var down=new Input();down.Data.Mouse.Flags=2;
            var up=new Input();up.Data.Mouse.Flags=4;
            Send(new[]{down,up});
        } finally { SetCursorPos(old.X,old.Y);if(raised)SetWindowPos(hwnd,new IntPtr(-2),0,0,0,0,0x13); }
    }
    public static void Press(IntPtr foreground,int key,bool shift=true) {
        if(GetForegroundWindow()!=foreground)throw new Exception("Refusing to type outside the test window");
        int[] sequence=shift?new[]{0x11,0x12,0x10,key,key,0x10,0x12,0x11}:new[]{0x11,0x12,key,key,0x12,0x11};
        foreach(int vk in sequence)if(GetAsyncKeyState(vk)<0)throw new Exception("Key is already held");
        var inputs=new Input[sequence.Length];
        for(int i=0;i<inputs.Length;i++){
            inputs[i].Type=1; inputs[i].Data.Keyboard.Key=(ushort)sequence[i];
            inputs[i].Data.Keyboard.Flags=i>=sequence.Length/2?2u:0u;
        }
        Send(inputs);
    }
}
'@ -ReferencedAssemblies System.Windows.Forms

$null=[ShortcutKeys]::SetThreadDpiAwarenessContext([IntPtr](-4))
$desktop=[Threading.Mutex]::new($false,'Local\CMsparkMiniOrbNativeFixture')
try{$locked=$desktop.WaitOne(0)}catch [Threading.AbandonedMutexException]{$locked=$true}
if(!$locked){throw 'Another Mini native fixture is using the desktop'}
$env:CMSPARK_MINI_HOTKEYS_FILE=$BindingsFile
$form=[Windows.Forms.Form]::new()
$form.Text='CMspark shortcut test - foreground application'
$form.StartPosition='Manual'
$workArea=[Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.SetDesktopLocation($workArea.Left+8,$workArea.Bottom-145)
$form.ClientSize=[Drawing.Size]::new(230,75)
$form.ShowInTaskbar=$false
$child=$null
$settings=[IntPtr]::Zero
$mods=7 # Alt, Ctrl and Shift
$f17=128; $f18=129; $f19=130; $f20=131
$stage='start'
function Check([bool]$ok,[string]$why){if(!$ok){throw "$stage - $why"}}
function Poll([scriptblock]$probe){
    $timer=[Diagnostics.Stopwatch]::StartNew()
    do{
        [Windows.Forms.Application]::DoEvents()
        $result=& $probe
        if($result){return $result}
        Start-Sleep -Milliseconds 30
    }while($timer.ElapsedMilliseconds -lt 5000)
    $status=''
    if($settings -ne [IntPtr]::Zero){
        try{$status=(Element MiniHotkeyStatus).Current.Name}catch [Windows.Automation.ElementNotAvailableException]{}
    }
    throw "Timeout at $stage ($status)"
}
function Expect([string]$line){
    $read=$child.StandardOutput.ReadLineAsync()
    Check ($read.Wait(6000)) "expected $line"
    Check ($read.Result -ceq $line) "expected $line, received $($read.Result)"
}
function Launch {
    $info=[Diagnostics.ProcessStartInfo]::new()
    $info.FileName=(Get-Process -Id $PID).Path
    $info.Arguments='-NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -File "'+$HostScript+'"'
    $info.UseShellExecute=$false
    $info.CreateNoWindow=$true
    $info.RedirectStandardInput=$info.RedirectStandardOutput=$true
    $script:child=[Diagnostics.Process]::Start($info)
    $child.StandardInput.AutoFlush=$true
    Expect 'ready'
}
function Quit {
    $child.StandardInput.WriteLine('quit')
    Check ($child.WaitForExit(5000)) 'helper did not quit'
    Check ($child.ExitCode -eq 0) 'helper exited with an error'
    $child.Dispose();$script:child=$null
}
function Focus([IntPtr]$hwnd){
    try{[ShortcutKeys]::Focus($hwnd)}catch{throw "$stage - activate $(if($hwnd -eq $form.Handle){'other app'}else{'settings'}): $($_.Exception.Message)"}
    $null=Poll {[ShortcutKeys]::GetForegroundWindow() -eq $hwnd}
}
function Open-Settings {
    $child.StandardInput.WriteLine('settings')
    $condition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty,$child.Id)
    $win=Poll {
        [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,$condition) |
            Where-Object {$_.Current.AutomationId -eq 'MiniHotkeySettings'} | Select-Object -First 1
    }
    $script:settings=[IntPtr]$win.Current.NativeWindowHandle
    Focus $settings
}
function Element([string]$id){
    $root=[Windows.Automation.AutomationElement]::FromHandle($settings)
    $condition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,$id)
    $root.FindFirst([Windows.Automation.TreeScope]::Descendants,$condition)
}
function Click([string]$id){(Poll {Element $id}).GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()}
function Binding([string]$action){
    if(Test-Path -LiteralPath $BindingsFile){(Get-Content -LiteralPath $BindingsFile -Encoding UTF8 -Raw|ConvertFrom-Json).bindings.$action}
}
function Record([string]$action,[int]$key){
    Click "MiniHotkeyRecord$action"
    $null=Poll {(Element MiniHotkeyStatus).Current.Name -match '按下组合键'}
    [ShortcutKeys]::Press($settings,$key)
    $null=Poll {(Element MiniHotkeyStatus).Current.Name -notmatch '按下组合键'}
}
function Expect-Binding([string]$action,[int]$key){
    $null=Poll {$binding=Binding $action; $binding.key -eq $key -and $binding.modifiers -eq $mods}
}
function Expect-Action([int]$key,[string]$action){
    Focus $form.Handle
    [ShortcutKeys]::Press($form.Handle,$key)
    Expect "action:$action"
}
function Expect-Free([int]$key){
    Check ([ShortcutKeys]::RegisterHotKey($form.Handle,72,$mods,$key)) "key $key was occupied"
    Check ([ShortcutKeys]::UnregisterHotKey($form.Handle,72)) "could not release $key"
}
try {
    if($OwnershipOnly){
        $stage='system ownership on startup, conflict and release'
        Expect-Free $f17; Expect-Free $f19
        $seed='{"version":1,"bindings":{"chat":{"modifiers":7,"key":128},"ocr":{"modifiers":7,"key":130}}}'
        [IO.File]::WriteAllText($BindingsFile,$seed,[Text.UTF8Encoding]::new($false))
        Check ([ShortcutKeys]::RegisterHotKey($form.Handle,71,$mods,$f19)) 'fixture failed to reserve key'
        Launch; Expect 'conflict'
        $child.StandardInput.WriteLine("orb-pid:$PID")
        $child.StandardInput.WriteLine("orb-ready:$PID")
        Expect "orb-ready:$PID"
        Check (![ShortcutKeys]::RegisterHotKey($form.Handle,72,$mods,$f17)) 'loaded chat key was unclaimed'
        Check (![ShortcutKeys]::RegisterHotKey($form.Handle,72,3,32)) 'legacy profile did not get the default summon shortcut'
        Check ([IO.File]::ReadAllText($BindingsFile) -ceq $seed) 'startup conflict discarded bindings'
        Quit
        Expect-Free $f17
        Check ([ShortcutKeys]::UnregisterHotKey($form.Handle,71)) 'could not release simulated conflict'
        Launch
        Check (![ShortcutKeys]::RegisterHotKey($form.Handle,72,$mods,$f19)) 'saved key was not recovered on restart'
        Quit
        Expect-Free $f17; Expect-Free $f19
        [Console]::WriteLine('PASS')
        return
    }
    $form.Show()
    Focus $form.Handle
    foreach($key in @($f17,$f18,$f19,$f20)){Expect-Free $key}
    Launch
    $stage='default summon from another application'
    Focus $form.Handle
    [ShortcutKeys]::Press($form.Handle,32,$false)
    Expect 'action:summon'
    Quit
    $stage='an existing shortcut keeps priority over the new default'
    $seed='{"version":1,"bindings":{"chat":{"modifiers":3,"key":32}}}'
    [IO.File]::WriteAllText($BindingsFile,$seed,[Text.UTF8Encoding]::new($false))
    Launch
    Focus $form.Handle
    [ShortcutKeys]::Press($form.Handle,32,$false)
    Expect 'action:chat'
    Open-Settings
    Check ((Element MiniHotkeyRecordSummon).Current.HelpText -eq '未设置') 'the legacy chord was also allocated to summon'
    Quit
    [IO.File]::Delete($BindingsFile)
    Launch
    $stage='record and trigger chat from another process'
    Open-Settings
    Record Chat $f17
    Expect-Binding chat $f17
    Click MiniHotkeyClose
    Expect-Action $f17 'chat'

    $stage='duplicate assignments retain the first action'
    Open-Settings
    Record Shot $f18
    Expect-Binding shot $f18
    Record Shot $f17
    $null=Poll {(Element MiniHotkeyStatus).Current.Name -match '占用|冲突|其他|其它|已分配|已用于'}
    Expect-Binding shot $f18
    Click MiniHotkeyClose
    Expect-Action $f17 'chat'; Expect-Action $f18 'shot'

    $stage='OS conflict retains the previous binding'
    Check ([ShortcutKeys]::RegisterHotKey($form.Handle,71,$mods,$f19)) 'could not reserve conflict'
    Open-Settings
    Record Chat $f19
    $null=Poll {(Element MiniHotkeyStatus).Current.Name -match '占用'}
    Expect-Binding chat $f17
    Click MiniHotkeyClose
    Expect-Action $f17 'chat'
    Check ([ShortcutKeys]::UnregisterHotKey($form.Handle,71)) 'could not release conflict'

    $stage='rebind, clear and restart'
    Open-Settings
    Record Chat $f20
    Expect-Binding chat $f20
    Click MiniHotkeyClearShot
    $null=Poll {$null -eq (Binding shot)}
    Click MiniHotkeyClearSummon
    $null=Poll {(Element MiniHotkeyStatus).Current.Name -match '已清除' -and (Element MiniHotkeyRecordSummon).Current.HelpText -eq '未设置'}
    Record Meeting $f18
    Expect-Binding meeting $f18
    Click MiniHotkeyClose
    Expect-Free $f17
    Expect-Action $f18 'meeting'
    Expect-Action $f20 'chat'
    Quit
    Expect-Free $f20
    Launch
    Expect-Free $f17
    Check ([ShortcutKeys]::RegisterHotKey($form.Handle,72,3,32)) 'cleared summon returned on restart'
    Check ([ShortcutKeys]::UnregisterHotKey($form.Handle,72)) 'could not release summon shortcut'
    Expect-Action $f18 'meeting'
    Expect-Action $f20 'chat'
    Quit
    Expect-Free $f20
    [Console]::WriteLine('PASS')
} finally {
    if($child){
        $child.StandardInput.Close()
        if(!$child.WaitForExit(3000)){$child.Kill();$child.WaitForExit()}
        $child.Dispose()
    }
    $form.Dispose()
    $desktop.ReleaseMutex();$desktop.Dispose()
}
