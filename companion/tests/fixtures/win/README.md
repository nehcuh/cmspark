# Windows UIA acceptance fixtures (#572)

Two deliberately different targets, because the **UIA exposure depends on the toolkit** —
which is exactly why cua-driver builds source-built native harness apps instead of
relying on ad-hoc windows. Both were measured on this machine (2026-09-30).

## `uia-wpf-fixture.ps1` — the **positive** target

One WPF window, one Button. Measured UIA tree:

```
Window  "SubmitTest"
  Button  "SubmitTest"          ← real ControlType, exposes InvokePattern
    Text  "SubmitTest"
```

Backing off `computer-uia-invoke.ps1` on it:

```json
{"ok":true,"mode":"invoke","controlType":"Button",
 "automationId":"cmspark_fixture_button","tried":["invoke:ok"],"foreground":false,"ms":2107}
```

…and the target-owned state change (a marker file written by the click handler) appears ⇒
**Delivered** without stealing the foreground. That is the whole point of #572.

## `uia-winforms-fixture.ps1` — the **negative** target

One WinForms window, one Button. Measured UIA tree:

```
Window  "CMspark UIA invoke fixture"
  Pane  "SubmitTest"  aid="722554"     ← surface as a bare Pane, NO action patterns
```

The invoke script correctly finds it and then refuses with a **precise** code:

```
UIA_PATTERN_UNAVAILABLE:no usable UIA action pattern for 'SubmitTest' (Pane) tried=[invoke:unsupported]
```

That is the honest ledger entry for this target — **Refused**, not a generic failure, and
**not** silently downgraded to a blind coordinate click.

## Running them

```bash
# positive
powershell -NoProfile -Command "Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-STA','-File','<abs>/uia-wpf-fixture.ps1','-Marker','<abs>/mk.txt','-Ready','<abs>/rd.txt','-Seconds','60'"
# wait for rd.txt, then:
powershell -NoProfile -ExecutionPolicy Bypass -File <abs>/computer-uia-invoke.ps1 -Hwnd <hwnd> -Name SubmitTest -Mode invoke
# the evidence is mk.txt appearing (a target-owned state change), NOT exit code 0.
```

Notes learned while measuring:
- Readiness must be reported to a **file** — `Write-Output` from a UI event handler never
  reaches the console.
- Run the fixture via `Start-Process`; a shell `&` (Git Bash) does not give it a desktop.
- Pass paths in Windows form (`C:/...`); POSIX paths do not resolve inside PowerShell.
- **`powershell -Command` mangles non-ASCII anchors — but that is a TEST-HARNESS trap, not a
  product bug.** Observed `提交测试` → mojibake → `UIA_ELEMENT_GONE` when driving the script
  through Git Bash (`bash -c "powershell -Command \"& script -Name '…'\""`): the layered shell
  quoting garbles the argument before PowerShell ever sees it.
  **Verified 2026-09-30** through the production-style invocation (`execFile` + absolute
  `System32\WindowsPowerShell\v1.0\powershell.exe` + an argv array, exactly as
  `host-use/win/powershell.ts` does): the same string arrives intact —
  `{"received":"提交测试","len":4,"codes":"25552,20132,27979,35797"}` (all four code points
  match). That module already forbids `-Command` and string interpolation for precisely this
  class of reason. So no product change is needed — just do not test through `-Command`.
