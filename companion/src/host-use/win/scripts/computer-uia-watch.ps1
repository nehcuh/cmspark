# computer-uia-watch.ps1 — WP3 WindowOpened watcher for the <5% small-popup
# blind spot (task-induced dialogs in UIA-capable apps).
#
# READ-ONLY event subscription: System.Windows.Automation WindowOpenedEvent,
# desktop-root subtree, filtered to the TARGET PROCESS (a task-induced dialog
# belongs to the same pid). One JSON line per event on stdout; a single
# {"ready":true} line after subscribing. NO Invoke/SetValue/SetFocus/SendInput
# — this script only LISTENS.
#
# Why this exists: the executor's pixel channels (whole-window diff / zones /
# blobs) plus foreground + top-level-hwnd channels miss SMALL popups — e.g.
# an owned child dialog under the diff thresholds that never takes foreground
# (child windows can't be "foreground"). WindowOpenedEvent fires for any new
# window element in the process, including non-top-level and transient ones.
# For UIA-BLIND apps this channel does not exist and the residual stays
# pixel-only (documented in the executor).
#
# Implementation note: the event handler is a C# delegate (Add-Type), NOT a
# PowerShell scriptblock — a scriptblock handler marshals back onto the
# runspace thread, which the keep-alive loop occupies, so events would never
# be delivered. The C# handler formats the JSON line itself on the UIA
# callback thread.
#
# Lifecycle: the companion kills the process to stop watching; -MaxSeconds is
# the backstop self-termination so a leaked watcher never outlives a task by
# more than the cap.
param(
  [Parameter(Mandatory=$true)][long]$TargetPid,
  [int]$MaxSeconds = 600
)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
if ($MaxSeconds -lt 1 -or $MaxSeconds -gt 3600) {
  [Console]::Error.WriteLine("BADARGS:MaxSeconds $MaxSeconds out of range 1..3600")
  exit 2
}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Windows.Automation;
public static class UiaWindowWatch {
  public static int TargetPid;
  private static string Esc(string s) {
    if (s == null) return "";
    var b = new StringBuilder(s.Length + 8);
    foreach (var c in s) {
      if (c == '"' || c == '\\') { b.Append('\\'); b.Append(c); }
      else if (c < 0x20) { b.Append(' '); }
      else b.Append(c);
    }
    return b.ToString();
  }
  public static void OnWindowOpened(object sender, AutomationEventArgs e) {
    try {
      var el = sender as AutomationElement;
      if (el == null) return;
      if (el.Current.ProcessId != TargetPid) return;
      string ct = "", cls = "";
      try { ct = el.Current.ControlType.ProgrammaticName.Replace("ControlType.", ""); } catch {}
      try { cls = el.Current.ClassName; } catch {}
      // NOTE: the element NAME is deliberately NOT emitted (dialog titles are
      // user content; the probe script follows the same privacy rule).
      Console.WriteLine("{\"event\":\"window-opened\",\"controlType\":\"" + Esc(ct) +
        "\",\"className\":\"" + Esc(cls) + "\",\"pid\":" + TargetPid +
        ",\"at\":\"" + DateTimeOffset.Now.ToString("o") + "\"}");
    } catch { /* a vanished sender is fine — keep listening */ }
  }
}
'@ -ReferencedAssemblies UIAutomationClient, UIAutomationTypes

[UiaWindowWatch]::TargetPid = [int]$TargetPid
$handler = [System.Delegate]::CreateDelegate([System.Windows.Automation.AutomationEventHandler], [UiaWindowWatch].GetMethod('OnWindowOpened'))

$root = [System.Windows.Automation.AutomationElement]::RootElement
try {
  [System.Windows.Automation.Automation]::AddAutomationEventHandler(
    [System.Windows.Automation.WindowPattern]::WindowOpenedEvent,
    $root,
    [System.Windows.Automation.TreeScope]::Subtree,
    $handler)
} catch {
  [Console]::Error.WriteLine("WATCHFAILED:subscribe: $($_.Exception.Message)")
  exit 5
}

[Console]::WriteLine('{"ready":true}')

$sw = [Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt $MaxSeconds) {
  Start-Sleep -Milliseconds 200
}
# Backstop reached — unsubscribe best-effort and exit (the companion normally
# kills us first).
try { [System.Windows.Automation.Automation]::RemoveAutomationEventHandler([System.Windows.Automation.WindowPattern]::WindowOpenedEvent, $root, $handler) } catch {}
exit 0
