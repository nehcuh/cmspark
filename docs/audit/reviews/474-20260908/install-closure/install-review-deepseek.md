`encodeICO`/CRC checks out (signed-mixing classic poly, `>>>0` normalizes; independently validated — makensis + Chrome consumed the output). Residual: none worth P1.

**Findings**

- **P0:** none.
- **P1 (should-fix):** `makeStatusIcon(_:ws:size:)` — `ws` is now dead (`companion/src/tray/Tray.swift`): no body reference after the dot-in-circle removal; renderer harness passes `ws:false`, production callers still pass `wsConnected`. Failure mode: misleading API suggests WS state affects icon; future caller could restore depend-zero behavior. Drop the param or rewire; trivial.
- **P1 (should-fix):** staging gate enumerates `assets/cmspark.ico` + three tray ICOs (`scripts/build-windows-installer.sh`), but `assets/tray-icon-template.ico` is also generated and shipped yet ungated. Failure mode: template ICO silently missing in package while generator emits it; either remove from output set or add to gate list.
- **MAJOR:** none.
- **NIT:** `renderMark` throws on unknown scheme — good — but `generate-tray-icons.mjs` has no try/catch; a typo'd scheme aborts mid-loop leaving partial assets (`tray-icon-template` already written). Cosmetic; deterministic script.
- **NIT:** `menu.title === ""` assert proves removal, but systray2 `buildMenu` still computes `statusLabel` was deleted fully — yes, gone. Test title assertion only covers `""`; fine.
- **NIT:** `test-brand-rendering.py` IoU division `sum(x or y …)` — geometry guarantees nonzero union; OK.
- **NIT:** plan doc "installation verification supplement" commits to building DMG and replacing running install — execution is user-authorized; code gate not blocked by this.

**Passes:** geometry contract cross-check Swift↔JS exact; red hollow evenOdd clip; `isTemplate=false` with explicit sRGB state colors; title-blank + AX label on both Swift paths; `SWIFT_TRAY_SHA256` pin updated to actual compiled binary, fail-closed logic unchanged; installer MUI_ICON/UNICON + DisplayIcon + shortcut icons all point at staged `cmspark.ico`; package gates fail-closed on missing app ICO; no injection/secrets/policy drift — pure visual.

**Verdict: APPROVE_WITH_NITS** — P1s are API-hygiene/gate-completeness, not correctness blockers; evidence `[executed]` by machines covers extension production build, companion 499 pass, native arm64 build + integrity true, 18-case IoU ≥0.894, NSIS real-ICO compile. Recommend fixing the two P1s before Windows native package runs, not before merge.