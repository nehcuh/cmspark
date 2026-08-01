# Dual review: macOS TCC CU unblock PR (`fix/macos-tcc-product-identity` → main)

**Batch:** macos-tcc-cu-unblock-pr  
**Repo:** `/Users/huchen/Projects/cmspark`  
**Base:** `origin/main`  
**Head:** `fix/macos-tcc-product-identity`  
**Reviewers:** Claude + Pi

## Scope (what this PR ships)

1. **Host resolve + estop spawn harden** (`host-bin.ts`, estop spawn paths)
2. **Tray/Aqua-owned estop** — `host.swift` starts estop before Node tray; companion connect-first
3. **Soft-fail CGEventTap** — tap fail → hotkey DEGRADED, socket stays live (no code-4 hard kill of helper)
4. **Spatial `describe` OCR** — `ocr-describe.ts`; prompts discourage shell Vision bypass
5. **Fleet UI** — paused-only zombie workers must not show「舰队运行中」or steal FocusBand
6. Docs/workflows/reviews/ship notes (memory/PROJECT_CONTEXT ok)

## Out of scope / do not demand in this PR

- Developer ID signing
- Full Side Panel DoD on every Mac
- Re-enabling LS hotkey when TCC denies tap
- Deleting zombie worker threads automatically

## Must verify (use Read/Grep/Bash on the real tree)

1. `runEstop` does **not** exit on tapCreate nil; socket + CFRunLoopRun continue
2. Companion `ensureEstopHelper` is connect-first; daemon spawn is fallback
3. `describe` uses spatial layout + untrusted marker; credential scan still before seal
4. `classifyFleetActivity` / `fleetProcessingLabel` / FocusBand: paused_only ≠ 运行中
5. No user-facing「enable node」regression
6. Tests exist for owner/estop soft path, ocr-describe, focus-band fleet

## Rejection gates

| # | Gate |
|---|------|
| R1 | Estop still hard-exits on tap fail (code 4) |
| R2 | Soft-fail weakens fail-closed (dead helper looks live) |
| R3 | Claims full CU fixed without evidence |
| R4 | Fleet paused zombies still labeled 运行中 as only behavior |
| R5 | Security: untrusted OCR removed or shell OCR encouraged |

## Output

Summary, Blocking, Nits, then exactly one final line:

```
VERDICT: APPROVE
```
or
```
VERDICT: APPROVE_WITH_NITS
```
or
```
VERDICT: REJECT
```
