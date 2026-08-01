# Dual external re-review: macOS TCC product identity **IMPLEMENTATION**

**Stage:** Post-implementation review + **B1 re-review** (Tasks 0–6 + host-integrity fix; Task 7 human DoD not claimed)  
**Date:** 2026-08-01  
**Repo:** `/Users/huchen/Projects/cmspark`  
**Branch:** `fix/macos-tcc-product-identity`  
**Base:** `main` / merge-base (use git diff vs main)  
**Batch id:** `macos-tcc-product-identity-impl-r2`

### Round-1 outcome (do not ignore)

- Claude: APPROVE_WITH_NITS  
- Pi: **REJECT** on **B1**: packaged `MacOS/CMspark` SHA256 ≠ `CMSPARK_HOST_SHA256` after `codesign --deep`, so `spawnHostBin` / inject / host_read fail in DMG.

### B1 fix to verify (commit `d15a788` and later)

- `companion/src/host-use/darwin/host-integrity.ts`: for paths under `*.app/Contents/`, accept `codesign --verify` + `Identifier=com.cmspark.agent` when SHA pin mismatches; keep SHA pin for `dist/cmspark-host`.
- Tests: packaged integrity + `spawnHostBin security-check` in `host-use-darwin-integrity.test.ts`.

**If B1 still fails on the live staged app → REJECT again.**

## Required reading

1. **Design SoT** — `docs/superpowers/specs/2026-08-01-macos-tcc-product-identity-design.md`  
   Locks D1–D10, DoD §6, adversary A1–A20.

2. **Impl plan + DR amendments** — `docs/superpowers/plans/2026-08-01-macos-tcc-product-identity-impl.md`  
   Especially dual-review amendments DR-N1…DR-N7.

3. **Prior design dual review** (context only):  
   Claude/Pi APPROVE_WITH_NITS on design — do **not** re-rubber-stamp; judge **code**.

4. **Git**: inspect full diff `main...HEAD` (or attached patch). Focus files:
   - `companion/src/host-use/darwin/host-Info.plist`
   - `companion/src/host-use/darwin/build-host.sh`
   - `companion/src/host-use/darwin/host.swift` (+ host-skylight.swift)
   - `companion/src/host-use/darwin/host-bin.ts`
   - `companion/tests/host-bin-resolve.test.ts`
   - `scripts/create-dmg.sh`
   - `scripts/tests/test-package-gates.sh`
   - `scripts/macos/Info.plist`
   - `companion/src/computer/darwin-estop.ts`, `darwin-adapters.ts`
   - `docs/computer-use-user-guide.md`

5. **Optional live checks** (if tools allow on this machine):
   ```bash
   file dist-package/dmg-staging/CMspark.app/Contents/MacOS/CMspark
   codesign -dv dist-package/dmg-staging/CMspark.app/Contents/MacOS/CMspark 2>&1 | head -15
   ls -la dist-package/dmg-staging/CMspark.app/Contents/Resources/cmspark-host
   strings dist-package/dmg-staging/CMspark.app/Contents/MacOS/CMspark | grep -E 'and/or node|cmspark-host if listed' || echo clean
   cd companion && npx tsx --test tests/host-bin-resolve.test.ts
   ```

## Product premise (must not be weakened)

```text
User path: ONLY enable «CMspark». FORBIDDEN: guide node/cmspark-host.
P0: MacOS/CMspark = native host Mach-O @ com.cmspark.agent;
    resolve prefers main; packaging single CDHash; copy scrub.
Task 7 manual TCC/non-Chrome capture is OUT of scope for "code OK" —
    but reviewers MUST state whether code is ready for human DoD.
```

## Rejection gates (any fail → VERDICT: REJECT)

| # | Gate |
|---|------|
| R1 | User-facing strings still tell users to enable node or cmspark-host |
| R2 | Capture still resolved to a **second distinct signed blob** without A6 control (different CDHash path intentionally) |
| R3 | create-dmg still installs bash/script as MacOS/CMspark |
| R4 | Embedded/host identity not `com.cmspark.agent` (or build gate missing) |
| R5 | `CMSPARK_HOST_BIN` override weakened (D10 dual opt-in broken) |
| R6 | Default double-click path broken (no tray / infinite usage dump only) without replacement |
| R7 | Claims Task 7 human DoD already done when it is not |

## Approve criteria

- D1–D10 reflected in code/packaging as implementable P0
- DR-N1…N7 either implemented or explicitly deferred with reason
- Tests exist for resolve order; package gates assert no bash launcher
- Honest that human TCC verification remains

## Output format (strict)

```markdown
## Summary
## Spec compliance (D1–D10)
## Packaging / identity (create-dmg, CDHash, symlink vs hardlink)
## User copy scan
## Security (D10, integrity)
## Tests
## Ready for human Task 7 DoD?
## Blocking
## Nits
## Verdict confidence
(0-100%)

VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT
```

Be adversarial. Tag `[inspected]` / `[executed]`. End with exactly one VERDICT line.
