# Linux Phase 0 Spike — RUNBOOK

> **Platform scope**: Ubuntu 24.04 LTS, Wayland default session (not X11).
> **Goal**: verify AT-SPI can read Evolution top-1 inbox on a fresh install
> without Electron-app D-Bus deadlock. If AT-SPI is sandboxed off under
> Wayland default, Linux fails Phase 0 and Phase 1 reverts to darwin-only
> per `docs/decisions/computer-use-round2-synthesis.md` §5.1.
>
> This RUNBOOK is for execution on a real Linux test machine. The code stub at
> `companion/src/host-use/linux/index.ts` throws `NotImplementedOnPlatform`
> until Phase 1 implementation. Phase 0 collects evidence; no companion
> integration needed on the Linux side yet.

## Preconditions

1. **Ubuntu 24.04 LTS** installed, **Wayland** session (default). Verify:
   ```bash
   echo $XDG_SESSION_TYPE   # should print "wayland"
   echo $WAYLAND_DISPLAY    # should be set, e.g. "wayland-0"
   ```
2. **Evolution** mail client installed and configured with at least 1 IMAP
   account that has ≥1 unread message in inbox:
   ```bash
   sudo apt install evolution
   # Launch Evolution, set up an account manually, fetch mail
   ```
3. **AT-SPI2 core** packages (usually pre-installed on Ubuntu desktop):
   ```bash
   sudo apt install python3-atspi at-spi2-core
   ```
4. **Accessibility enabled** at system level (Ubuntu Settings → Accessibility →
   "Screen Reader" toggle ON, OR run time setting via gsettings):
   ```bash
   gsettings set org.gnome.desktop.interface toolkit-accessibility true
   ```
5. Test machine is **not** running with `sudo`/root — AT-SPI must run in the
   user session.

## Spike steps

### Step 1 — Verify AT-SPI bus is reachable

```bash
gdbus call --session --dest org.a11y.atspi.Registry \
  --object-path /org/a11y/atspi/accessible/root \
  --method org.a11y.atspi.Accessible.GetChildCount
```

Expected: an integer ≥ 1 (number of top-level accessible apps). If 0 or
"ServiceUnknown", AT-SPI bus isn't initialized — re-check Step 4 of
preconditions.

### Step 2 — List running apps with accessibility trees

```bash
gdbus call --session --dest org.a11y.atspi.Registry \
  --object-path /org/a11y/atspi/accessible/root \
  --method org.a11y.atspi.Accessible.GetChildren
```

Should return `(ao, [list of object paths])`. Look for one containing
"evolution".

### Step 3 — Walk Evolution's tree to find inbox

Use `python3 -c` with `pyatspi`:

```python
import pyatspi
for app in pyatspi.Registry.getDesktop(0):
    if "evolution" in (app.name or "").lower():
        print(f"Found: {app.name} role={app.getRoleName()}")
        for child in app:
            print(f"  child: {child.name} role={child.getRoleName()}")
            # Continue walking toward the message list...
            break
```

If `pyatspi.Registry.getDesktop(0)` returns an empty list, **STOP — record this
as `atspi-bus-not-accessible` failure**.

### Step 4 — Read top-1 message subject + sender

Once the message-list node is found (role = "table"), query the first row's
text cells:

```python
# Pseudocode — actual implementation will be in companion/src/host-use/linux/atspi.ts
table = find_message_list_node()  # role=table, parent of "Message List"
first_row = table[0]  # accessible child 0
sender_cell = first_row[1].queryText().getText(0, -1)
subject_cell = first_row[2].queryText().getText(0, -1)
date_cell = first_row[0].queryText().getText(0, -1)
```

Expected: same 4-tuple shape as macOS spike: `{sender, subject, date_received,
body_preview}`.

### Step 5 — Body preview (open the message)

To get body_preview, click the row to open the message, then walk to the
"document web" role node and read its text:

```python
first_row.doAction("click")  # or action name "jump"
# Wait 200ms for UI to settle
import time; time.sleep(0.2)
body_node = find_doc_web_node()
body_text = body_node.queryText().getText(0, 500)
```

### Step 6 — Deadlock test with Electron app open

While the Evolution spike is running, **open VS Code or Slack** (both are
Electron apps with large accessibility trees).

Re-run Step 4. Measure:
- Does the call still return within 2s?
- Or does it hang / time out / consume 100% CPU?

Record timing: `time python3 step4.py`. If hang or >5s, this is the
`electron-dbus-deadlock` failure mode.

### Step 7 — AppImage distributability check (informational)

Test whether a Node.js process can be packaged as AppImage and still access
AT-SPI:

```bash
# Build a minimal Node script into an AppImage
# (use appimage-builder or similar). Run it. Does pyatspi-equivalent
# (gdbus calls) work from inside AppImage?
```

This is informational for Phase 1 packaging — not a Phase 0 pass/fail gate.

## Pass criteria (Phase 0 Linux)

All of the following must hold:

- [ ] Step 1 returns ≥1
- [ ] Step 3 finds Evolution in the desktop tree
- [ ] Step 4 returns a 4-tuple with non-empty sender + subject
- [ ] Step 6 completes in <2s with Electron app open

## Failure modes & next steps

| Failure | Implication |
|---|---|
| `atspi-bus-not-accessible` | Ubuntu 24.04 Wayland default sandbox blocks AT-SPI for non-GNOME apps. Linux fails Phase 0; revert to darwin-only Phase 1. |
| `evolution-not-found` | Evolution's accessibility tree not exposed. Try alternative: `geary` mail client, or skip Evolution and target `thunderbird`. |
| `electron-dbus-deadlock` | AT-SPI walk hangs >5s with Electron app open. Affects Code/Slack users on Linux. Document as known Phase 1 limitation. |
| `body-open-fails` | Clicking message doesn't expose body via AT-SPI. Phase 1 falls back to "subject + sender only" (drop body_preview). |

## Evidence package

Capture to `docs/decisions/phase0-linux-gate-evidence.md`:
- Output of each Step command
- Screenshot of Evolution with accessibility inspector (Accerciser) open
- `time` measurements for Step 6 with/without Electron app open
- Decision: PASS / FAIL / PARTIAL

## Handoff to Phase 1

If Linux PASS, the W4 HostAdapter interface definition
(`docs/decisions/host-adapter-interface.md`) should reflect:

- `listReadTargets("mail")` returns `[{id: "atspi://evolution/inbox"}]`
- `readOne("atspi://evolution/inbox")` returns the 4-tuple
- `TargetId` is opaque string encoding the AT-SPI object path
