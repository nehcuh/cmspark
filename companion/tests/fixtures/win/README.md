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

## Current #572 host pipeline compatibility

The historical standalone action command above is retained as history. The current
computer-uia-invoke.ps1 entry refuses with exit6 / UIA_TERMINAL:UIA_PATTERN_UNAVAILABLE
(host_pipeline_required) before any action. Use production PsInputInjector.invokeUia:
Companion owns computer-uia-select.ps1 then computer-uia-act.ps1 as two direct
PowerShell children under one original15000ms remaining budget. It is not nested PS.
The fixed DLL and original desktop assertions remain mandatory hosted Windows gates.

computer-uia-invoke-mixed-before572.ps1 is a byte-exact6f52 legacy snapshot used only
by the retained matched A/B counterfactual generator/CPU controls. The real failed B
observation remains history; its native registration is no longer a production gate.
No B failure was relabelled a successful production action. Current normal, separate
pipeline diagnostic, four other modes, loader and ABI negatives exercise the actual
new production route. The pipeline diagnostic emits schema2 / explicit SELECT_* and
ACTION_* phases, not the old single-process four-phase meaning.
