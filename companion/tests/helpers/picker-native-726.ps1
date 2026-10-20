# Test-only hosted owned-dialog controller. No product import, sleep, global input or title targeting.
param([Parameter(Mandatory=$true)][int]$OwnerPid)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Microsoft.PowerShell.Utility\Add-Type -AssemblyName UIAutomationClient
Microsoft.PowerShell.Utility\Add-Type -AssemblyName UIAutomationTypes
Microsoft.PowerShell.Utility\Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Automation;
public sealed class PickerNative726 : IDisposable {
 readonly Process child;
 readonly int pid;
 readonly AutomationEventHandler handler;
 readonly AutomationElement desktop;
 IntPtr captured;

 public PickerNative726(int target) {
  pid=target; child=Process.GetProcessById(pid); var held=child.Handle;
  desktop=AutomationElement.RootElement;
  handler=(sender,args)=>{try {var e=sender as AutomationElement;
   if(e==null||e.Current.ProcessId!=pid)return;
   lock(typeof(PickerNative726)){Console.Out.WriteLine("{\"event\":\"opened\"}");Console.Out.Flush();}
  }catch{}};
  Automation.AddAutomationEventHandler(WindowPattern.WindowOpenedEvent,desktop,TreeScope.Subtree,handler);
 }
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h,uint command);
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h,uint flags);
 [DllImport("user32.dll")] static extern IntPtr GetDlgItem(IntPtr h,int id);
 [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,System.Text.StringBuilder name,int size);
 bool Owned(IntPtr h){uint p;return h!=IntPtr.Zero&&IsWindow(h)&&GetWindowThreadProcessId(h,out p)!=0&&p==pid;}
 static bool Class(IntPtr h,string wanted){var b=new System.Text.StringBuilder(256);return GetClassName(h,b,b.Capacity)>0&&b.ToString()==wanted;}
 IntPtr Dialog() {
  if(child.HasExited)throw new InvalidOperationException(); child.Refresh();
  var main=child.MainWindowHandle;if(main==IntPtr.Zero)return IntPtr.Zero;
  if(!Owned(main))throw new InvalidOperationException();
  var dialog=Class(main,"#32770")?main:GetWindow(main,6); // GW_ENABLEDPOPUP, never enumerate desktop windows
  if(dialog==IntPtr.Zero||dialog==main&&!Class(main,"#32770"))return IntPtr.Zero;
  var owner=GetAncestor(dialog,3); // GA_ROOTOWNER
  if(!Owned(dialog)||!Owned(owner)||!IsWindowVisible(dialog)||!Class(dialog,"#32770"))throw new InvalidOperationException();
  var root=AutomationElement.FromHandle(dialog);
  if(root==null||root.Current.ProcessId!=pid||root.Current.NativeWindowHandle!=dialog.ToInt64())throw new InvalidOperationException();
  return dialog;
 }
 public string Snapshot() {
  var dialog=Dialog(); if(dialog==IntPtr.Zero)return "WAIT";
  captured=dialog;return "EXACT";
 }
 public bool Invoke(string mode) {
  if(mode!="ok"&&mode!="cancel")return false;
  var dialog=Dialog();if(dialog==IntPtr.Zero||dialog!=captured)return false;
  int id=mode=="ok"?1:2; // Win32 IDOK/IDCANCEL; unknown provider layout refuses.
  var button=GetDlgItem(dialog,id);
  if(!Owned(button)||!IsWindowVisible(button)||GetAncestor(button,2)!=dialog||GetDlgCtrlID(button)!=id)return false;
  var e=AutomationElement.FromHandle(button);object pattern;
  if(e==null||e.Current.ProcessId!=pid||e.Current.NativeWindowHandle!=button.ToInt64()||e.Current.IsOffscreen||e.Current.ControlType!=ControlType.Button||!e.Current.IsEnabled||!e.TryGetCurrentPattern(InvokePattern.Pattern,out pattern))return false;
  ((InvokePattern)pattern).Invoke();return true;
 }
 public void Dispose(){Automation.RemoveAutomationEventHandler(WindowPattern.WindowOpenedEvent,desktop,handler);child.Dispose();}
}
'@ -ReferencedAssemblies UIAutomationClient,UIAutomationTypes
$controller=$null
try {
 $controller=New-Object PickerNative726 $OwnerPid
 [Console]::Out.WriteLine('{"event":"ready"}');[Console]::Out.Flush()
 while($null -ne ($line=[Console]::In.ReadLine())) {
  $request=Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject $line
  $result='UNKNOWN'
  if($request.op -ceq 'snapshot'){$result=$controller.Snapshot()}
  elseif($request.op -ceq 'invoke'){$result=if($controller.Invoke([string]$request.mode)){'INVOKED'}else{'REFUSED'}}
  elseif($request.op -ceq 'stop'){$result='STOPPED'}
  $response=@{id=$request.id;result=$result}|Microsoft.PowerShell.Utility\ConvertTo-Json -Compress
  [Console]::Out.WriteLine($response);[Console]::Out.Flush()
  if($request.op -ceq 'stop'){break}
 }
} catch { [Console]::Out.WriteLine('{"event":"failed"}');[Console]::Out.Flush();exit 2 }
finally {if($null -ne $controller){$controller.Dispose()}}
