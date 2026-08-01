I have enough evidence. All plan claims verified against real code. Let me write the review.

## Summary

Independent product + macOS TCC/platform + packaging + security review of the **design + implementation plan** for `macos-tcc-product-identity` (Scheme D). Implementation has NOT started; I verified the plan against current source. The plan correctly identifies the root cause (product-identity vs capture-process-identity split) and applies the technically correct fix. All seven rejection gates (R1–R7) are satisfied. Three real-code spot-checks confirm the gaps the plan claims to close (`host.swift:1066` user-facing "(and/or node / cmspark-host)" string, `host-Info.plist:5-6` `com.cmspark.host`, `create-dmg.sh:75-85` bash launcher as `MacOS/CMspark`). Recommending APPROVE_WITH_NITS — residual risks (hardlink/codesign interaction, `node` responsible_for attribution on Tahoe 26) are acknowledged in the spec and have explicit DoD gates (Task 7) plus a documented fallback (Task 7.6).

## Design locks (D1–D10) `[inspected]`

D1–D10 are internally consistent and sufficient for the user premise ("only enable CMspark"):

- **D1–D3** (user-visible subject = CMspark; copy scrub): cover both error strings and docs. Verified `host.swift:1066` literally contains `"enable «CMspark» (and/or node / cmspark-host if listed)"` — exactly the D3 violation; Task 2.4 rewrites it.
- **D4** (Mach-O main entry): Plan Task 4.1 asserts `file MacOS/CMspark` is non-script. Verified `create-dmg.sh:75-85` still emits `#!/usr/bin/env arch -arm64 /bin/bash` heredoc — exactly what D4 forbids; plan replaces it.
- **D5** (embedded plist = `com.cmspark.agent`): Verified `host-Info.plist:5-6` is `com.cmspark.host` / `cmspark-host` — Task 1.1 replacement is correct.
- **D6** (resolve prefers main binary): Verified `host-bin.ts:42-48` candidate list has no `MacOS/CMspark` entry — Task 3.1 adds it as first candidate while preserving override semantics.
- **D7** (dev filename kept): `dist/cmspark-host` retained as dev fallback (last candidate) — engineering compat preserved.
- **D8** (migration copy): Task 5 user-guide text + error string both honest about ad-hoc reinstall.
- **D9** (ad-hoc honesty): Explicit in §3 D9 and §8 risk register — **not hidden**.
- **D10** (`CMSPARK_HOST_BIN` dual opt-in): Task 3 explicitly preserves existing logic verbatim. Verified `host-bin.ts:22-30` keeps both env gates.

No internal contradiction. D2 ("SCK must not run in node") is enforced structurally by D4+D6 together (capture path = `MacOS/CMspark` Mach-O via `resolveHostBinary`).

## Scheme D technical soundness (TCC) `[inspected + assumed]`

Scheme D is **not cargo-cult**. On macOS 15/26, ScreenCaptureKit TCC attribution follows:

1. **CDHash of the calling executable** (primary). Today: capture runs in `Resources/cmspark-host` (`com.cmspark.host`, ad-hoc) → its CDHash is the attribution anchor, mismatching the app shell. Plan: capture runs in `MacOS/CMspark` (same bytes, hardlinked, `com.cmspark.agent`) → CDHash aligns with the app bundle identity.
2. **Bundle-level signature on Tahoe 26** (verified by existing comment at `create-dmg.sh:88-93`: "TCC evaluates bundle-level signature"). Plan Task 4.2 preserves `codesign --force --deep` over the whole `.app`. ✓
3. **`responsible_for` walk** when `node` spawns the host: macOS walks parent chain (`MacOS/CMspark` ← `node` ← `.app` bundle) and attributes TCC to the `.app`. Since `MacOS/CMspark` and the bundle now share `com.cmspark.agent`, the user sees one entry. This is the deepest technical risk and Plan Task 7.3 (manual TCC path) + 7.6 (XPC fallback) address it explicitly.

**Honest caveats:** ad-hoc CDHash still changes on every rebuild (D9 acknowledged); without TeamID/Developer ID, "reinstall may clear grant" remains a real user pain. Plan does not pretend otherwise.

## Plan ↔ adversary coverage (A1–A20 / Tasks)

Every A-item maps to a Task without silent gaps:

| Adversary | Task | Status |
|---|---|---|
| A1 tray default | 2.2/2.3 | ✓ |
| A2 scripts path | 2.1 | ✓ (verified `findScript` at `host.swift:110-119` only checks sibling dir) |
| A3 resolve | 3 | ✓ |
| A4 plist identifier | 1 | ✓ |
| A5 short-CLI name | 1+7 | ✓ |
| A6 single CDHash | 4 (hardlink) | ✓ (see nit) |
| A7 node ghost | 5 | ✓ |
| A8 NSAppleEventsUsageDescription | 1.1 | ✓ |
| A9 estop copy | 5 | ✓ (verified `darwin-estop.ts:108` "cmspark-host" string) |
| A10 self-ui | 6 | ✓ (verified `self-ui.ts:31-32` lists both ids) |
| A11 CMSPARK_HOST_BIN | 3 (D10 preserved) | ✓ |
| A12 ad-hoc CDHash clears | 5 docs + 7 | ✓ |
| A13 install-daemon.sh | **P1 only** | nit (gate explicitly allows) |
| A14 dev naming | accepted | ✓ |
| A15 hardened runtime | preserved | ✓ |
| A16 test hardcodes | 6 | ✓ |
| A17 dual spawn | 3+4 | ✓ |
| A18 single blob | 4 | ✓ |
| A19 copy sweep | 5 | ✓ |
| A20 real-device DoD | 7 | ✓ (non-Chrome capture mandatory) |

## Packaging / resolve / tray risks `[inspected]`

- **Tray launch from host binary (A1, R5):** Plan 2.2 dispatches on `args.isEmpty || args[0] == "tray"`. Verified `host.swift:467-484` currently dumps usage to stderr and `exit(2)` on no args — Task 2.2 replaces this branch cleanly. Subcommand dispatch (screenshot/inject/estop) is unchanged, so `node` spawning `MacOS/CMspark screenshot ...` continues to work. **No double-start risk.**
- **`resolveHostBinary` vs `__dirname`:** When bundled, `__dirname` = `Contents/Resources/` (where `cmspark-agent.js` lives). Candidate `../MacOS/CMspark` correctly resolves to `Contents/MacOS/CMspark`. ✓
- **Hardlink dual path (A6, R2):** Plan 4.1 does `cp` then `ln -f MacOS/CMspark Resources/cmspark-host`. Even if `codesign --force --deep` writes seals per-path and breaks the hardlink, identical input bytes ⇒ identical ad-hoc CDHash (no timestamp authority). Same-CDHash invariant holds. **Minor nit:** Plan doesn't add a post-codesign CDHash equality assertion — would harden A6 enforcement cheaply.
- **`findScript` paths (A2):** Plan 2.1 adds `../Resources/host-scripts` candidate. Verified current `findScript` at `host.swift:110-119` only checks sibling `host-scripts/`. ✓
- **Ad-hoc CDHash flakiness (D9):** Honestly disclosed in spec §8 and Plan Task 5 user-guide text.

## Security `[inspected]`

- **D10 preserved verbatim:** Task 3.1 keeps `CMSPARK_HOST_BIN` + `CMSPARK_ALLOW_HOST_BIN_OVERRIDE=1` dual opt-in (verified `host-bin.ts:22-30`). No regression.
- **Identity merge (`com.cmspark.host` → `com.cmspark.agent`)** does **not** expand attack surface: the binary is still ad-hoc signed, the integrity hash regime (`build-host.sh:115-134` `CMSPARK_HOST_SHA256` auto-rewrite) is untouched, and the override gate is unchanged. Merging bundle ids reduces TCC entry count (a product/UX property), not a security control.
- **Capability declaration (ADR-020):** Provided. Surface=L2 CU host path (correct axis — not Pack/Skill/MCP dressed as agent); Composition=none; Autonomy=unchanged; Trust=TCC is OS gate (orthogonal to god-mode/auto_approve); Channel=local packaged .app only for DoD. Trust monotonicity preserved (deeper Surface does not inherit looser L0). No new runtime, no new confirmation family. All 7 checklist items pass. ✓

## Residual holes

1. **Hardlink robustness through `codesign --deep`:** low risk, but Plan Task 4 could add `codesign -dv` CDHash comparison between `MacOS/CMspark` and `Resources/cmspark-host` post-sign to make A6 enforcement testable rather than rely on input-bytes-equivalence reasoning.
2. **`responsible_for` attribution on Tahoe 26:** unverified until Task 7.3 manual DoD. Plan Task 7.6 fallback (drop second blob / P1 XPC) is appropriate.
3. **`install-daemon.sh` (A13):** explicitly P1 (P1-4 backlog). Spec acknowledges divergence. Non-blocking.
4. **skylight experimental binary drift (spec §8):** experiment bin excluded from user package or sync plist — fine as risk note.
5. **`arch -arm64` wrapper for tray spawn:** Plan Task 2.3 leaves this as a one-line note. Existing bash launcher (`create-dmg.sh:76`) uses `arch -arm64`; the Swift `Process` directly invokes `node`. On Apple Silicon `node` (universal) runs arm64 by default, so likely a no-op, but the plan should be explicit.

## Blocking

None. R1–R7 all untriggered:
- R1: Task 2.4 + Task 5 rg-sweep remove node/cmspark-host from user copy.
- R2: Task 4 hardlinks single-inode blob; A6/A18 enforced via Mach-O assertion.
- R3: Task 4.1 asserts `file` is non-script.
- R4: Task 7.4 mandates non-Chrome capture DoD.
- R5: Task 2.2 default-tray branch with subcommand dispatch preserved.
- R6: D9 + §8 risk register + Task 5 user-guide text honestly disclose ad-hoc reinstall behavior.
- R7: Task 3.1 keeps override logic "exactly as today".

## Nits

- N1 (Task 4): add post-codesign CDHash equality assertion between `MacOS/CMspark` and `Resources/cmspark-host` to make A6 enforcement testable.
- N2 (Task 2.3): explicitly resolve the `arch -arm64` wrapper question — either embed in `Process.arguments` via `/usr/bin/arch` or document that `node` universal binary runs arm64 by default on Apple Silicon.
- N3 (A13 / P1-4): `install-daemon.sh` divergence stays P1 — confirm the TCC identity story for the daemon install path before P0 ships, or explicitly scope P0 to DMG-only.
- N4 (Task 2.6 smoke): `./dist/cmspark-host` no-arg smoke only verifies dev-mode failure path; real tray-launch verification is deferred to Task 7 packaged DoD. Acceptable but worth a one-line acknowledgment.
- N5 (Task 1.2 build-host.sh assertion): the `strings` fallback (`grep -q 'com.cmspark.host'`) may false-positive on `__TEXT,__const` containing the legacy id in a comment/string fragment the plan didn't scrub — ensure Task 2.5 comment rewrite runs before relying on this gate.

## Verdict confidence

82%

VERDICT: APPROVE_WITH_NITS
