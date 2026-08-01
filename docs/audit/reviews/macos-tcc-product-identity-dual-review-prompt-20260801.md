# Dual external re-review: macOS TCC product identity (design + impl plan)

**Stage:** Product design SoT + implementation plan, after internal adversarial matrix  
**Date:** 2026-08-01  
**Repo:** `/Users/huchen/Projects/cmspark`  
**Batch id:** `macos-tcc-product-identity`

## Required reading (in order)

1. **Design SoT (primary)**  
   `docs/superpowers/specs/2026-08-01-macos-tcc-product-identity-design.md`  
   Focus: §0–§3 locks D1–D10, §4 scheme D, §5 adversary matrix A1–A20, §6 DoD.

2. **Implementation plan**  
   `docs/superpowers/plans/2026-08-01-macos-tcc-product-identity-impl.md`  
   Focus: Tasks 0–8 file map, Task 2 tray launch, Task 3 resolveHostBinary, Task 4 create-dmg, Task 7 acceptance.

3. **Internal adversary synthesis (context — do not rubber-stamp)**  
   `docs/audit/reviews/macos-tcc-product-identity-adversary-synthesis-20260801.md`

4. **Code spot-check (mandatory — verify plan matches reality)**  
   - `companion/src/host-use/darwin/host.swift` (SCK error strings ~1060+, main/usage, findScript)  
   - `companion/src/host-use/darwin/host-Info.plist`  
   - `companion/src/host-use/darwin/host-bin.ts`  
   - `companion/src/host-use/darwin/build-host.sh`  
   - `scripts/create-dmg.sh` (bash launcher ~74–85, codesign)  
   - `companion/src/computer/self-ui.ts` (bundle ids)  
   - `companion/src/computer/darwin-estop.ts` (user-facing Accessibility copy if any)

5. **Optional:** `docs/computer-use-user-guide.md` (current Screen Recording guidance honesty)

## Product premise (must not be weakened)

```text
User path: ONLY enable «CMspark» in Screen Recording / Accessibility.
FORBIDDEN: instruct users to enable node or cmspark-host.
Root cause: product identity vs capture process identity split
  (bash MacOS/CMspark → node → Resources/cmspark-host @ com.cmspark.host).
P0 solution (Scheme D): MacOS/CMspark = native host Mach-O;
  embed com.cmspark.agent; resolveHostBinary prefers main binary;
  node is agent-only; copy scrub; packaged DoD with real non-Chrome capture.
```

## Capability declaration (ADR-020)

```text
Surface: L2 Computer Use capture/inject (macOS host path) — packaging/TCC identity, not new tools
Composition: no Pack change
Autonomy: unchanged
Trust: TCC is OS gate; product must not mislead; god-mode/auto_approve orthogonal
Channel: local packaged .app only for DoD
```

## Your job

Independent **product + macOS TCC/platform + packaging + security** review of the **design + plan** (implementation has NOT started). Spot-check real code to judge whether the plan is implementable and whether it has holes.

### Must answer

1. Are D1–D10 **internally consistent** and **sufficient** for the user premise?  
2. Does Scheme D actually fix TCC attribution on modern macOS (15/26), or is it cargo-cult? Cite technical risk.  
3. Are A1–A20 / DoD gates **mapped into Tasks** without silent gaps?  
4. Plan risks: default tray launch from host binary; hardlink dual path; `findScript` paths; `resolveHostBinary` vs `__dirname`; ad-hoc CDHash still flaky (D9 honesty).  
5. Security: does merging identity with agent bundle id create new attack surface? Is D10 preserved?  
6. What would make you **REJECT** starting Subagent-Driven execution?

### Rejection gates (any fail → VERDICT: REJECT)

| # | Gate |
|---|------|
| R1 | Plan still allows user-facing copy that tells users to enable node/cmspark-host |
| R2 | Plan leaves capture on a **second** signed blob distinct from MacOS/CMspark without hard A6/A18 enforcement |
| R3 | Main executable remains bash/script after Task 4 (D4 not enforceable) |
| R4 | No real-device / packaged DoD for non-Chrome capture (A20 missing or optional) |
| R5 | Tray default launch (A1) underspecified such that double-click breaks tray or double-starts daemon |
| R6 | Spec claims “shipped / fixed for users” while Developer ID still required for P0 (contradicts D9) **OR** pretends ad-hoc never clears grants without doc honesty |
| R7 | Security regression: `CMSPARK_HOST_BIN` override weakened without dual opt-in |

### Non-blocking nits (→ APPROVE_WITH_NITS)

- Missing install-daemon.sh alignment (P1 already noted)  
- skylight experimental binary drift  
- Exact `arch -arm64` wrapper details  
- Wording polish  

### Output format (strict)

```markdown
## Summary
## Design locks (D1–D10)
## Scheme D technical soundness (TCC)
## Plan ↔ adversary coverage (A1–A20 / Tasks)
## Packaging / resolve / tray risks
## Security
## Residual holes
## Blocking
## Nits
## Verdict confidence
(0-100%)

VERDICT: APPROVE
```
or `VERDICT: APPROVE_WITH_NITS` or `VERDICT: REJECT`

Tag claims `[inspected]` when you read files. Be adversarial. Do **not** implement code.

Write only the review markdown to stdout. End with exactly one VERDICT line.
