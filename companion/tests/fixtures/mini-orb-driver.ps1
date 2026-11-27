param([Parameter(Mandatory)][string]$HostScript, [Parameter(Mandatory)][string]$PositionFile)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MiniCheck {
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
    [StructLayout(LayoutKind.Sequential)] struct R {public int L,T,Ri,B;}
    [StructLayout(LayoutKind.Sequential)] struct Gui { public int Size,Flags;public IntPtr Active,Focus,Capture,Menu,Move,Caret;public R Rect; }
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint flags);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,IntPtr pid);
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint id,ref Gui g);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
    [DllImport("user32.dll")] static extern void mouse_event(uint f,int dx,int dy,uint data,UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint msg,IntPtr w,IntPtr l);
    public static Point Cursor(){Point p;GetCursorPos(out p);return p;}
    public static bool HitAt(IntPtr owner,int x,int y){
        return GetAncestor(WindowFromPoint(new Point{X=x,Y=y}),2)==owner;
    }
    public static void Press(IntPtr owner){
        if(GetAncestor(WindowFromPoint(Cursor()),2)!=owner)throw new Exception("test orb is obscured");
        mouse_event(2,0,0,0,UIntPtr.Zero);
    }
    public static void Release(IntPtr owner){
        var gui=new Gui{Size=Marshal.SizeOf(typeof(Gui))};
        bool owned=GetGUIThreadInfo(GetWindowThreadProcessId(owner,IntPtr.Zero),ref gui)&&gui.Capture==owner;
        if(!owned&&GetAncestor(WindowFromPoint(Cursor()),2)!=owner)throw new Exception("test gesture lost HWND owner");
        mouse_event(4,0,0,0,UIntPtr.Zero);
    }
}
'@

$null=[MiniCheck]::SetThreadDpiAwarenessContext([IntPtr](-4))
$lease=[Threading.Mutex]::new($false,'Local\CMsparkMiniOrbNativeFixture')
try{$acquired=$lease.WaitOne(0)}catch [Threading.AbandonedMutexException]{$acquired=$true}
if(-not $acquired){throw 'Another Mini orb fixture is using the desktop.'}
$env:CMSPARK_MINI_POSITION_FILE=$PositionFile
$start=[Diagnostics.ProcessStartInfo]::new()
$start.FileName=(Get-Process -Id $PID).Path
$start.Arguments='-NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -File "'+$HostScript+'"'
$start.CreateNoWindow=$true
$start.UseShellExecute=$false
$start.RedirectStandardInput=$start.RedirectStandardOutput=$start.RedirectStandardError=$true
$child=[Diagnostics.Process]::Start($start)
$child.StandardInput.AutoFlush=$true
$hwnd=[IntPtr]::Zero
$stage='startup'
function Check([bool]$ok,[string]$message){if(-not $ok){throw $message}}
function Expect([string]$expected){
    $read=$child.StandardOutput.ReadLineAsync()
    Check ($read.Wait(7000)) "no receipt at $stage"
    Check ($read.Result -ceq $expected) "unexpected receipt at $stage"
}
function Poll([scriptblock]$probe){
    $stop=[Diagnostics.Stopwatch]::StartNew()
    do{$result=& $probe;if($result){return $result};Start-Sleep -Milliseconds 40}while($stop.ElapsedMilliseconds -lt 5000)
    throw "UI did not reach $stage"
}
function Element([string]$id){
    $w=[Windows.Automation.AutomationElement]::FromHandle($hwnd)
    $condition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,$id)
    $w.FindFirst([Windows.Automation.TreeScope]::Descendants,$condition)
}
function Invoke-Control([string]$id){(Poll {Element $id}).GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()}
function Value([string]$id){(Poll {Element $id}).GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)}
function B64([string]$v){[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($v))}
function Show-Orb {$child.StandardInput.WriteLine('show');$null=Poll {[MiniCheck]::IsWindowVisible($hwnd)}}
function Expand {
    (Poll {Element 'MiniOrb'}).GetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern).Expand()
}
function HostWindow {
    $owned=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty,$child.Id)
    Poll {[Windows.Automation.AutomationElement]::RootElement.FindFirst([Windows.Automation.TreeScope]::Children,$owned)}
}
function Center([string]$id){
    $r=Poll {
        $el=Element $id
        if($el){
            $bounds=$el.Current.BoundingRectangle
            if(-not $bounds.IsEmpty -and $bounds.Width -gt 0 -and $bounds.Height -gt 0){$bounds}
        }
    }
    [Windows.Point]::new([Math]::Round($r.Left+$r.Width/2),[Math]::Round($r.Top+$r.Height/2))
}
function Glide($from,$to){
    for($i=1;$i -le 12;$i++){
        $x=[int][Math]::Round($from.X+($to.X-$from.X)*$i/12)
        $y=[int][Math]::Round($from.Y+($to.Y-$from.Y)*$i/12)
        Check ([MiniCheck]::SetCursorPos($x,$y)) 'test could not position cursor'
        Start-Sleep -Milliseconds 14
    }
}
function Key([int]$v){
    Check ([MiniCheck]::PostMessage($hwnd,0x100,[IntPtr]$v,[IntPtr]1)) 'keydown failed'
    Check ([MiniCheck]::PostMessage($hwnd,0x101,[IntPtr]$v,[IntPtr]0)) 'keyup failed'
}
$before=[MiniCheck]::Cursor()
$pressed=$false
try{
    Expect 'ready'
    # A second tray for the same profile must leave the existing desktop orb as the sole owner.
    $duplicate=[Diagnostics.Process]::Start($start)
    try {
        Check ($duplicate.WaitForExit(7000)) 'a duplicate orb stayed alive for this profile'
        Check ($duplicate.ExitCode -eq 0 -and -not $duplicate.StandardOutput.ReadToEnd().Trim()) 'duplicate orb opened a window'
    } finally {
        if(-not $duplicate.HasExited){$duplicate.Kill();$duplicate.WaitForExit()}
        $duplicate.Dispose()
    }
    $stage='find native window'
    $window=HostWindow
    $hwnd=[IntPtr]$window.Current.NativeWindowHandle
    Check ($window.Current.Name -ceq 'CMspark Mini') 'wrong native window'
    $orb=Poll {Element 'MiniOrb'}
    $startBounds=$orb.Current.BoundingRectangle
    Check ($window.Current.BoundingRectangle.Width -le ($startBounds.Width*1.2)) 'idle overlay covers surrounding desktop'
    $stage='quick chat'
    Invoke-Control MiniOrb
    Expect 'action:chat'
    $draft=Value MiniChatInput
    $message='请看 <资料> & "PNG"'
    $answer="第一行`n第二行 <Button/>"
    $draft.SetValue($message);Invoke-Control MiniChatSend
    Expect ('say:'+(B64 $message))
    Check (-not (Element MiniChatSend).Current.IsEnabled) 'sent twice while awaiting reply'
    $child.StandardInput.WriteLine('error:'+(B64 '模型暂时不可用'))
    $null=Poll {(Element MiniChatSend).Current.IsEnabled}
    Check ((Value MiniChatInput).Current.Value -ceq $message) 'draft lost on error'
    Invoke-Control MiniChatSend;Expect ('say:'+(B64 $message))
    $child.StandardInput.WriteLine('reply:'+(B64 $answer))
    $history=Value MiniChatHistory
    $null=Poll {$history.Current.Value.Contains('<Button/>')}
    Check ($history.Current.Value.Contains($message)) 'history dropped user text'
    $draft.SetValue('取消');Invoke-Control MiniChatSend;Expect ('say:'+(B64 '取消'))
    Invoke-Control MiniChatClose;Expect 'chat-close'
    $child.StandardInput.WriteLine('reply:'+(B64 'STALE'))
    Invoke-Control MiniOrb;Expect 'action:chat'
    Check (-not (Value MiniChatHistory).Current.Value.Contains('STALE')) 'cancelled turn displayed'
    Check ((Value MiniChatHistory).Current.Value.Contains($answer.Replace("`n","`r`n")) -or (Value MiniChatHistory).Current.Value.Contains($answer)) 'conversation lost on reopen'
    Invoke-Control MiniChatClose
    $stage='search'
    Expand
    $null=Center MiniSearch
    $expanded=$window.Current.BoundingRectangle
    $through=0
    foreach($x in @(([int]$expanded.Left+2),([int]$expanded.Right-3))){
        foreach($y in @(([int]$expanded.Top+2),([int]$expanded.Bottom-3))){
            if(-not [MiniCheck]::HitAt($hwnd,$x,$y)){$through++}
        }
    }
    Check ($through -eq 4) 'transparent menu corners intercept the desktop'
    Invoke-Control MiniSearch;Expect 'action:search'
    $stage='meetings from summoned menu'
    $child.StandardInput.WriteLine('invoke:summon')
    $null=Center MiniMeeting
    Invoke-Control MiniMeeting;Expect 'action:meeting'
    foreach($action in @('todo','ask','ocr','capture')){
        $stage="capture $action"
        Expand;Invoke-Control MiniShot
        $id='Mini'+[char]::ToUpperInvariant($action[0])+$action.Substring(1)
        Invoke-Control $id;Expect ('action:'+$action)
        Check (-not [MiniCheck]::IsWindowVisible($hwnd)) 'orb visible when capture was dispatched'
        Show-Orb
    }
    $stage='keyboard menu and Escape'
    (Element MiniOrb).SetFocus()
    Key 0x20
    $null=Poll {(Element MiniChat).Current.HasKeyboardFocus}
    Key 0x28
    $null=Poll {(Element MiniShot).Current.HasKeyboardFocus}
    Key 0x27
    $null=Poll {(Element MiniTodo).Current.HasKeyboardFocus}
    Key 0x1b
    $null=Poll {(Element MiniShot).Current.HasKeyboardFocus}
    Key 0x1b
    $null=Poll {(Element MiniOrb).Current.HasKeyboardFocus}
    $stage='continuous native gesture'
    $ball=Center MiniOrb
    Check ([MiniCheck]::SetCursorPos($ball.X,$ball.Y)) 'test cursor failed'
    [MiniCheck]::Press($hwnd);$pressed=$true
    $shot=Center MiniShot
    Glide $ball $shot
    $ocr=Center MiniOcr
    Glide $shot $ocr
    [MiniCheck]::Release($hwnd);$pressed=$false
    Expect 'action:ocr'
    Check (-not [MiniCheck]::IsWindowVisible($hwnd)) 'gesture starts capture before orb hides'
    Show-Orb
    $stage='native reversal before release'
    $ball=Center MiniOrb
    Check ([MiniCheck]::SetCursorPos($ball.X,$ball.Y)) 'test cursor failed'
    [MiniCheck]::Press($hwnd);$pressed=$true
    $shot=Center MiniShot
    Glide $ball $shot
    $null=Center MiniTodo
    foreach($rootAction in @('MiniChat','MiniSearch')){
        $other=Center $rootAction
        Glide $shot $other
        $null=Poll {
            $leaf=Element MiniTodo
            (-not $leaf) -or $leaf.Current.BoundingRectangle.IsEmpty
        }
        Glide $other $shot
        $null=Center MiniTodo
    }
    Glide $shot $ball
    [MiniCheck]::Release($hwnd);$pressed=$false
    # The compact HWND bounds can be visible to UIA before Win32 hit-tests its new layered surface.
    # Keep the pointer at the reversal point and wait for that pixel to belong to the orb.
    $null=Poll {
        ($window.Current.BoundingRectangle.Width -le $startBounds.Width*1.2) -and
        [MiniCheck]::HitAt($hwnd,$ball.X,$ball.Y)
    }
    $stage='physical click opens quick chat'
    [MiniCheck]::Press($hwnd);$pressed=$true
    [MiniCheck]::Release($hwnd);$pressed=$false
    Expect 'action:chat'
    $null=Poll {(Element MiniChatInput).Current.HasKeyboardFocus}
    Key 0x1b
    $null=Poll {$window.Current.BoundingRectangle.Width -le ($startBounds.Width*1.2)}
    $stage='native drag and persistence'
    $ball=Center MiniOrb
    $target=[Windows.Point]::new($ball.X-73,$ball.Y+27)
    Check ([MiniCheck]::SetCursorPos($ball.X,$ball.Y)) 'test cursor failed'
    [MiniCheck]::Press($hwnd);$pressed=$true
    Glide $ball $target
    [MiniCheck]::Release($hwnd);$pressed=$false
    $null=Poll {Test-Path -LiteralPath $PositionFile}
    $moved=Center MiniOrb
    Check (([Math]::Abs($target.X-$moved.X) -le 3) -and ([Math]::Abs($target.Y-$moved.Y) -le 3)) 'drag did not follow pointer'
    $persisted=([IO.File]::ReadAllText($PositionFile)).Split(',')
    Check (([Math]::Abs([int]$persisted[0]-$moved.X) -le 2) -and ([Math]::Abs([int]$persisted[1]-$moved.Y) -le 2)) 'drag stored a different monitor position'
    $stage='commands and parent EOF'
    $child.StandardInput.WriteLine('hide')
    $null=Poll {-not [MiniCheck]::IsWindowVisible($hwnd)}
    Show-Orb
    $child.StandardInput.Close()
    Check ($child.WaitForExit(4000)) 'orphan survived closed parent pipe'
    Check ($child.ExitCode -eq 0) 'host failed on EOF'
    $stage='restart at saved position'
    $child.Dispose()
    $child=[Diagnostics.Process]::Start($start)
    $child.StandardInput.AutoFlush=$true
    Expect 'ready'
    $hwnd=[IntPtr](HostWindow).Current.NativeWindowHandle
    $restored=Center MiniOrb
    Check (([Math]::Abs($restored.X-$moved.X) -le 2) -and ([Math]::Abs($restored.Y-$moved.Y) -le 2)) 'different position after restart'
    $child.StandardInput.WriteLine('quit')
    Check ($child.WaitForExit(4000)) 'explicit quit did not close host'
    Check ($child.ExitCode -eq 0) 'host failed on quit'
    'PASS'
} catch {
    throw ("{0} at {1}: {2}" -f $stage,$_.InvocationInfo.ScriptLineNumber,$_.Exception.Message)
} finally {
    try{
        if($pressed){
            try{[MiniCheck]::Release($hwnd)}catch{
                $safe=Center MiniOrb
                $null=[MiniCheck]::SetCursorPos($safe.X,$safe.Y)
                [MiniCheck]::Release($hwnd)
            }
        }
    } finally {
        $null=[MiniCheck]::SetCursorPos($before.X,$before.Y)
        if(-not $child.HasExited){$child.Kill();$child.WaitForExit()}
        $child.Dispose()
        $lease.ReleaseMutex()
        $lease.Dispose()
    }
}
