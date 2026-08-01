## Summary

This is a **design-stage** review: the SoT spec + implementation plan for unifying macOS TCC product identity (Scheme D: `Contents/MacOS/CMspark` becomes the native host Mach-O embedding `com.cmspark.agent`). Implementation has NOT started — the attached patch (`macos-tcc-product-identity-diff-20260801-152315.patch`) is the current working-tree diff, which contains only qwen3-vl work; the TCC design/plan/synthesis docs are untracked new files. I verified patch-vs-`git status` consistency (not stale) and spot-checked every code file the plan claims to modify.

## Design locks (D1–D10)

Consistent and sufficient for the premise. The load-bearing chain D4→D5→D6 plus the A6/A18 single-blob enforcement is coherent: [inspected] `host-Info.plist` is `com.cmspark.host`/`cmspark-host` today (Task 1 fixes); `host-bin.ts` candidates lack `../MacOS/CMspark` (Task 3 fixes); `create-dmg.sh` currently installs a bash `#!/usr/bin/env arch -arm64 /bin/bash` launcher heredoc (~lines 74–85) as main executable (Task 4 fixes). D10 is real: `host-bin.ts` [inspected] still requires `CMSPARK_ALLOW_HOST_BIN_OVERRIDE=1` for `CMSPARK_HOST_BIN`. The one soft spot: D1 says "only CMspark", but `scripts/macos/Info.plist` has `CFBundleDisplayName = "CMspark Agent"` while the plan's new embedded plist says "CMspark" — no node/host leak, but two canonical display names (nit).

## Scheme D technical soundness (TCC)

Not cargo-cult — it is the correct identity-unification move, and the plan is honest about the residual risk:

- **Mechanism**: TCC records the Screen Recording grant against the responsible process's designated requirement. Ad-hoc DR = CDHash. Today the SCK caller (`Resources/cmspark-host`, `com.cmspark.host`) has a distinct CDHash from the bundle main, so the "CMspark" grant never covers it → `-3801` even when enabled (matches the observed symptom). Scheme D makes the SCK caller the bundle main executable AND forces `MacOS/CMspark` and `Resources/cmspark-host` to the **same inode** (Task 4 `cp` + `ln -f`, deep-signed once) so the spawned child's DR == the app's main-executable DR → the same grant covers it. `[inspected]` SCK callers are only `host.swift`/`host-skylight.swift` (no SCK in tray or node), so D2 holds.
- **Honest hedging**: the spawn-chain attribution on macOS 15/26 is exactly the kind of thing that must be verified, and the plan makes A5/A20 real-device DoD gates with explicit Blocker rollback (Task 7.6). D9 correctly refuses to claim Developer-ID-grade stability and documents ad-hoc reinstall clearing grants. R6 is not violated — nothing claims "shipped/fixed for users" while requiring Developer ID.
- One technical detail worth knowing: hardlink failure (`|| true`) still leaves two byte-identical copies signed identically by the same deep-sign → same CDHash, so A6 survives the fallback.

## Plan ↔ adversary coverage (A1–A20 / Tasks)

All 20 attacks are mapped without silent gaps: A1→T2, A2→T2, A3→T3, A4→T1, A5→T7, A6→T4, A7→T5, A8→T1, A9→T2/T5, A10→T6, A11→T3, A12→T5/T7, A13→P1-4 (acknowledged), A14→T4/T7, A15→T1/T2, A16→T3/T6, A17→T3/T5, A18→T3+T4, A19→T2/T5, A20→T7. DoD 1–8 all have gates. Two gate *enforcement* imperfections (nits, not gaps): the Task 5.1 rg patterns miss `darwin-estop.ts:63` "check Accessibility permission for cmspark-host" (regex requires "grant … permission to") and `host.swift:1595`'s split-wording warning; both are caught only by the manual second-pass DoD.

## Packaging / resolve / tray risks

- **Default tray launch (R5)**: fully specified at code level (`args.isEmpty || args[0] == "tray"` → spawn `Resources/node …cmspark-agent.js tray` → `waitUntilExit`). `[inspected]` `index.ts` `tray` → `startMenuBarAgent`; single-instance guard is in-process only, so double-click twice still spawns two node processes — but that is exactly today's bash-launcher behavior (no regression, no daemon double-start from the host binary itself). Nit: no cross-process singleton added.
- **Hardlink dual path**: ordering is safe as analyzed above. **findScript** candidates correctly cover `Resources/host-scripts` (staged by `package.sh` [inspected]) and flat dev layout. **resolveHostBinary vs `__dirname`**: packaged `__dirname` = Resources → `../MacOS/CMspark` first candidate is right; `host-integrity.ts` SHA/inode pin holds because the packaged file is byte-identical.
- **Ad-hoc CDHash (D9)**: honestly documented, guide includes re-enable step.

## Security

No new attack surface found. D10 override logic preserved verbatim (`[inspected]`); `spawnHostBin` integrity gate still applies to the resolved binary; `launchAgentTrayAndExit` spawns node from a fixed relative path with no user input (no injection); entitlement set is unchanged (whole-bundle deep-sign with `host.entitlements` already applies automation entitlement to node today, so no broadening). ADR-020 declaration present and fits: Surface L2 packaging/TCC identity, no tools/confirms added, no Pack/Compose change, Trust unchanged (TCC is the OS gate; god-mode/auto_approve untouched), channel = local packaged .app DoD. originWs not applicable (no new `securityConfirmations.request`).

## Residual holes

- Task 1.2's primary identity gate `codesign -d --info-plist=-` is **rejected on this machine (macOS 26.5.2)** — I verified `codesign: unrecognized option` for both `--info-plist=-` and `--info-plist`. The plan's `strings` fallback carries the gate, and it is effective here because neither `host.swift` nor `host-skylight.swift` contains `com.cmspark.*` literals (`[inspected]`), so strings is not fooled by incidental text. Non-blocking, but the "primary" path is dead code on the build OS.
- The second-pass DoD catches the two rg-missed strings, so R1's substance is preserved.

## Blocking

None. R1–R7 all pass: no residual "enable node/cmspark-host" copy survives the plan; single signed blob enforced via hardlink + resolve priority; Task 4 makes main executable Mach-O with file+static gates; real-device non-Chrome capture is a hard DoD (Task 7.4–7.6); tray launch is concretely specified with no regression; D9 is honest about ad-hoc; override dual opt-in preserved.

## Nits

1. Task 1.2: `codesign -d --info-plist=-` fails on macOS 26.5.2 (verified) — replace with `otool -s __TEXT __info_plist` + `plutil` extraction, or make the `strings` fallback the primary and document why.
2. Task 5.1 rg gate regex misses `darwin-estop.ts:63` ("check Accessibility permission for cmspark-host") and `host.swift:1595` ("cmspark-host is not Accessibility-trusted; Grant … Accessibility."); add `permission for cmspark-host|not Accessibility-trusted` patterns (and decide whether `scripts/` launchers need exemption documentation).
3. `scripts/macos/Info.plist` `CFBundleDisplayName = "CMspark Agent"` vs embedded "CMspark" — pick one canonical display name for D1.
4. Task 2.3 `waitUntilExit()` keeps the host alive as node's parent; consider exit-after-spawn (or a re-parent) so a crash or quit doesn't leave a zombie-ish parent, and to enable a future single-instance check.
5. No cross-process single-instance guard for rapid double-launch (pre-existing with the bash launcher; unchanged — document as known rather than silent).
6. `install-daemon.sh`/`menu-bar-launcher.sh` remain bash entry paths — P1-4 acknowledged; ensure P0 docs never present the daemon install as equivalent to the .app path.
7. Task 7.3 `tccutil reset ScreenCapture com.cmspark.agent` may not fully clear ad-hoc keyed entries on 26 — keep the caution, and verify the reset actually cleared before trusting DoD #5.
8. Minor: usage text still says `usage: cmspark-host <subcommand>` after Task 2 (D7 permits; consider "CMspark" for consistency).
9. The patch file contains no TCC code (qwen3-vl working tree) — expected for a design-stage review; flagged for process, not staleness.

## Verdict confidence

90%. All plan claims cross-checked against real code (`[inspected]`: host.swift SCK/usage/estop strings, both Info.plists, build-host.sh, host-bin.ts, create-dmg.sh, package.sh, executor.ts, self-ui.ts, darwin-estop.ts, host-integrity.ts, index.ts/menu-bar-agent.ts tray entry, Tray.swift SCK absence, gate helper functions); empirical verification of the `codesign --info-plist` failure on macOS 26.5.2; git status matches the patch. No blocking gates; the plan is implementable as written with a working strings fallback for the one broken build gate.

VERDICT: APPROVE_WITH_NITS
