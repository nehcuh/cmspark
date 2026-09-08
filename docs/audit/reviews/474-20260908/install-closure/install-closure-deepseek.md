## Independent Review — #474 Final (T2 visual + Windows icon artifacts)

**Scope:** visual/icon code gate only — Tray.swift geometry/colors/menu, JS exporters, ICO encoder, NSIS wiring, staging gates, SHA pin. No startup/shutdown/permission policy changes present. Installation itself is user-authorized and outside this gate.

**P0:** None.

**P1:** None.

- Geometry parity verified `[inspected]`: JS `insideMark` vs Swift vector paths share endpoint (5,5)/(5,19)/(20,12), r2.3, line 2.3, diamond (12,7.5)→(16.5,12)→(12,16.5)→(7.5,12); red hollow r1.9 matches Swift evenOdd clip (10.1–13.9); alpha/rgba edge supersampling consistent. `test-brand-rendering.py` IoU ≥0.894 over 18 combos plus corner-transparency/center-hollow/node-color asserts closes the risk.
- `brand-icon.mjs:encodeICO` 256-byte header degenerate case (size→0,0) is correct; sizes 16/24/32/48/64/128 byte-safe. CRC32/PNG chunking standard.
- `Tray.swift`: ws param removed from both callers (`setupStatusItem`, `updateAppearance`) and renderer harness (`test-brand-rendering.py`) — no stale references. Handler transform/restore balanced; `button.title=""` + AX label + tooltip retained; menu header removal preserves items[0..2] action mapping and seqMap alignment in both Swift and `systray2-bridge.ts`.
- Integrity pin: hash updated to actual compiled binary; fail-closed throw-before-spawn unchanged; no check disabled. Reported checkIntegrity=true `[executed, implementer]`. Cannot independently recompute hash without a build — residual verification risk only.
- NSIS: MUI_ICON/MUI_UNICON/DisplayIcon/shortcuts all reference `assets/cmspark.ico`; `File /r` copies the staged tree; `build-windows-installer.sh` gate now enforces all five ICOs; `test-package-gates.sh` exercises the fail-closed path (missing app icon → non-zero + grep). Template ICO addition consistent across generator/stage/test.

**MAJOR:** None.

**NITs**
1. `scripts/installer.nsi` DisplayIcon uses `'"$INSTDIR\assets\cmspark.ico",0'` — space after comma. Shell's `PathParseIconLocation` tolerates it, but canonical is `"path",0`; confirm rendering in the eventual native-package visual check.
2. `tray-status-474.test.ts` constructs `SysTray2Adapter` via `as any`; verify no spawn side effects in constructor (package tests pass, so evidently none).
3. `build-windows-installer.sh` gate requires `assets/tray-icon-template.ico` but the generator's stdout summary doesn't advertise the app ICO — trivial.

**Not code gate:** Windows native package build not yet claimed; that run remains the operational proof for DisplayIcon/shortcut rendering.

**VERDICT: APPROVE_WITH_NITS** — P0/P1 absent; fail-closed staging and verified parity hold.