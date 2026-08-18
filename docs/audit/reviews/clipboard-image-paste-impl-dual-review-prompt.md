# Dual-review prompt — clipboard image paste IMPLEMENTATION

**Batch**: `clipboard-image-paste-impl`  
**Nature**: implementation review (T2). Confirm or reject the **adversary synthesis**, not a first-principles redesign.

## Read in order

1. `docs/audit/reviews/clipboard-image-paste-impl-adversary-synthesis-20260818.md` — **must read full file**
2. `docs/superpowers/specs/2026-08-17-clipboard-image-paste-design.md`
3. Diff vs `main` (attached patch / `git diff main`)

## MACHINE (this session)

```
companion targeted: 105 pass / 0 fail
extension targeted: 42 pass / 0 fail
chrome-extension tsc --noEmit: PASS
```

## Capability

```text
Surface:      L0
L2-classes:   (none)
Compose:      none
Autonomy:     single
Trust:        user-initiated images → effective LLM or vision; no new confirm
Channel:      community
```

## Your job

1. Independently inspect the **real code** (hydrate, file.upload, App.tsx send, thumbs, WS refuse, sidecar).
2. Confirm or reject the adversary table: Product REJECT + Security/Arch APPROVE_WITH_NITS.
3. If Product blockers (empty thumbs, ghost user, dest override, token ≈3, edit strips §5.1a) are **wrong**, say so with file:line.
4. If they are **right**, VERDICT must not be APPROVE. APPROVE_WITH_NITS only if you believe those are non-blocking (you must argue against Product).
5. ADR-020: no new runtime / L2 / clipboardRead.

Do not reward long prose. Do not rubber-stamp the implementer.

End with exactly one of:

VERDICT: APPROVE  
VERDICT: APPROVE_WITH_NITS  
VERDICT: REJECT  
