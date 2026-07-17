# Windows Phase 0 Spike — RUNBOOK

> **Addendum (computer-use-w8-windows, 2026-07-17)**: the spike evidence below
> stands for **UI-driving** paths (UIAutomation / SetForegroundWindow /
> SendInput still require UIAccess + EV cert — that NON-goal is unchanged).
> However, the Phase 1 `HostAdapter` **data contract** is satisfiable without
> UI-driving, via COM automation (classic Outlook read, OneNote create),
> Node `fs` (allowlisted file metadata/move), and WinRT `UserConsentVerifier`
> (Windows Hello — verified callable unsigned on this machine). Those COM/fs
> data paths are implemented on this branch; see
> `docs/decisions/windows-host-use-plan.md` (amended) for the design and
> `companion/src/host-use/win/` for the implementation.

> **Platform scope**: Windows 11 (24H2+). **Goal is NOT to make it work** —
> Phase 0 Windows spike exists to **collect blocking evidence** that
> unsigned/ad-hoc-signed binaries cannot:
>   1. See the full UIAutomation tree of UIAccess-protected processes
>      (Outlook, Mail, Edge protected mode)
>   2. Use `SetForegroundWindow` reliably (UIPI silently swallows it on 24H2+)
>   3. Invoke `SendInput` (needs UIAccess manifest)
>
> This evidence locks the Phase 1.5 precondition: EV cert ($499/yr) + legal
> entity + Authenticode + UIAccess manifest. See
> `docs/decisions/computer-use-round2-synthesis.md` §1.5 + §4.3.

## Preconditions

1. **Windows 11 24H2 or later**. Verify:
   ```powershell
   winver
   # Look for "Version 24H2" or later
   ```
2. **Outlook** installed (classic Outlook for Windows — the COM one; not
   "New Outlook" which is web-wrapped and has no UIAutomation tree).
3. **At least 1 unread message in Outlook inbox**.
4. Test machine is **NOT** running as Administrator for the spike (UIPI
   restrictions differ for elevated processes — we want the user-mode
   experience).

## Spike steps

### Step 1 — Build an unsigned test binary

Write a minimal PowerShell or C# console app that uses `UIAutomation`. Don't
sign it. Save as `outlook-probe.exe`.

```powershell
# outlook-probe.ps1
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$automation = [System.Windows.Automation.AutomationElement]
$outlook = $automation::FindFirst(
  $automation::RootElement,
  [System.Windows.Automation.TreeScope]::Children,
  [System.Windows.Automation.Condition]::new(
    [System.Windows.Automation.PropertyCondition]::new(
      $automation::NameProperty, "Inbox - Outlook"
    )
  )
)
if (-not $outlook) {
  Write-Host "FAIL: Outlook window not found in UIAutomation tree"
  exit 1
}
Write-Host "OK: Found $($outlook.Current.Name)"
# Walk children — looking for message list
$children = $automation::FindAll($outlook, [System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
Write-Host "Descendant count: $($children.Count)"
$children | Select-Object -First 5 | ForEach-Object {
  Write-Host "  - $($_.Current.ControlType.LocalizedControlType): $($_.Current.Name)"
}
```

### Step 2 — Run unsigned

```powershell
powershell -ExecutionPolicy Bypass -File .\outlook-probe.ps1
```

Observe:
- SmartScreen prompt?
- ExecutionPolicy override needed?
- Any "Windows protected your PC" dialog?

Record exact prompts with screenshots.

### Step 3 — Verify UIAccess blocking

The expected failure: `FindFirst` returns null for Outlook's Inbox window
even though Outlook is running. This is **UIAccess protected process blocking**
— Outlook runs with UIAccess, unsigned binaries can't see its tree.

Confirm with a control: do the same `FindFirst` against Notepad (not
UIAccess-protected). It should succeed. This rules out the binary being
broken — it's specifically UIAccess that blocks.

### Step 4 — `SetForegroundWindow` test

```powershell
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string n);
}
"@
$h = [W]::FindWindow($null, "Inbox - Outlook")
if ($h -eq [IntPtr]::Zero) { Write-Host "Window not found"; exit 1 }
$ok = [W]::SetForegroundWindow($h)
Write-Host "SetForegroundWindow returned: $ok"
Start-Sleep -Seconds 1
# Check if Outlook actually came to foreground
$fg = [W]::FindWindow($null, (Get-Process -Name outlook -ErrorAction SilentlyContinue).MainWindowTitle)
Write-Host "Foreground check: $fg vs Outlook: $h"
```

On Windows 11 24H2+, `SetForegroundWindow` returns true but Outlook does NOT
actually come to foreground — this is the UIPI silent-swallow behavior.

### Step 5 — `SendInput` test

```powershell
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class I {
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] p, int s);
  // ... struct definitions omitted
}
"@
# Attempt to send a keystroke to Outlook
$result = [I]::SendInput(1, ...)
Write-Host "SendInput returned: $result"
```

Expected: `SendInput` returns 0 (events not injected) without UIAccess
manifest. With UIAccess manifest + signed binary, it would return the number
of events successfully injected.

## Pass criteria (Phase 0 Windows — negative result IS pass)

Phase 0 Windows passes by **confirming the blocking**. All of:

- [ ] Step 1 builds and runs (no compile-time blocker)
- [ ] Step 3 shows FindFirst returns null for Outlook (UIAccess blocks unsigned)
- [ ] Step 4 shows SetForegroundWindow no-ops on 24H2+
- [ ] Step 5 shows SendInput returns 0 (or 0 events actually injected)

If ALL these blocking behaviors are confirmed → Phase 0 Windows PASSES
(negative result). If any of them surprisingly works for unsigned binaries →
**re-evaluate Phase 1.5 necessity** (would mean Windows could be in Phase 1
after all).

## Evidence package

Capture to `docs/decisions/phase0-windows-gate-evidence.md`:
- SmartScreen prompt screenshot from Step 2
- FindFirst null output from Step 3 + Notepad control output
- SetForegroundWindow return value + foreground-check mismatch from Step 4
- SendInput return value from Step 5
- Winver screenshot
- Outlook version + Windows build numbers

## Phase 1.5 preconditions (locked by this RUNBOOK)

Before Windows Phase 1.5 can start, all of:

- [ ] EV cert purchased ($499/yr from DigiCert / Sectigo)
- [ ] Legal entity registered (LLC or equivalent)
- [ ] Authenticode signing workflow tested on staging binary
- [ ] UIAccess manifest designed + reviewed (`mt.exe -inputresource` /
      `manifest` block in MSBuild)
- [ ] Phase 0 Windows evidence package archived

## Handoff to Phase 1.5 (not Phase 1)

If Phase 0 Windows confirms blocking, the `companion/src/host-use/win/` stub
stays as `throw NotImplementedOnPlatform`. Phase 1 README + docs must say:

> "Windows not supported in Phase 1, requires EV cert + legal entity. See
> `docs/decisions/computer-use-round2-synthesis.md` §6.2 (Option X)."

Phase 1.5 implementation will write the actual C# / PowerShell code that
requires UIAccess + Authenticode to function.
