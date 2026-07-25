# Pi Final Review: Integrated P2–P5 Diff (v4.1)

> **Source**: Claude (coding), per autonomous workflow
> **Reviewer**: Pi (claude CLI subagent)
> **Date**: 2026-07-24
> **Predecessor**: `pi-reconfirm-p2-p4-integrated.md` + your PROCEED decision
> **Decision sought**: FINAL APPROVE to ship P2–P5 + start G2 manual lab, OR BLOCK with specifics.

## 1. Status since your PROCEED

You cleared P2-P4 with one caveat (credential latch dead code on OCR-throw path). I shipped the fix and you re-confirmed PROCEED. Then I coded **P5** (the server.ts G1 skip gate + corpus/latch wiring per Grok v4.1 §3.2/§3.4). This brief covers the **full P2–P5 integrated diff**.

## 2. P5 implementation

### 2.1 session-trust.ts (GrantRecord extended)

New fields on `GrantRecord`:
- `corpus: Set<string>` — accumulated type.text literals the user has approved for (sessionId, appToken).

New methods on `ComputerSessionTrust`:
- `clearCredentialLatch(sessionId, appToken)` — clears the latch (called on interactive approve).
- `extendCorpus(sessionId, appToken, texts: string[])` — idempotent; ignores empty/whitespace.
- `corpusContains(sessionId, appToken, texts: string[]): boolean` — true if every text is in the stored corpus. Empty `texts` returns true. Does NOT consult idle/latch (pair with isTrusted).

`grant()` preserves corpus across re-grants (existing corpus wins).

### 2.2 server.ts — G1 skip gate (line 548–628)

Inserted AFTER the cheap fail-fast checks (COMPUTER_TASK_BUSY, rate limit) and BEFORE the L2 preview is built (so skip path avoids the ~5s preview image work):

```typescript
if (sessionId && finalParams.app) {
  const { getComputerSessionTrust } = await import("./computer/session-trust")
  const trust = getComputerSessionTrust()
  const appToken = String(finalParams.app)
  const actionsArr = Array.isArray(finalParams.actions) ? finalParams.actions : []
  const typeCorpus: string[] = []
  for (const a of actionsArr) {
    if (a && typeof a === "object" && (a as any).action === "type" && typeof (a as any).text === "string") {
      typeCorpus.push(String((a as any).text))
    }
  }
  if (
    trust.isTrusted(sessionId, appToken) &&
    trust.corpusContains(sessionId, appToken, typeCorpus)
  ) {
    hostComputerTrustSkip = true
    logger.info("computer.session_trust.task_auto_approved", { ... })
  } else {
    logger.info("computer.session_trust.skip_missed", { ... })
  }
}
```

### 2.3 server.ts — dialog gate (line 711)

Changed from:
```typescript
if (!skipConfirmation || forceConfirm) {
```
to:
```typescript
if ((!skipConfirmation || forceConfirm) && !hostComputerTrustSkip) {
```

When `hostComputerTrustSkip === true`, the entire dialog block is bypassed. The token is still minted at line 1005 (post-gate unconditional mint), so execution proceeds normally.

### 2.4 server.ts — G1b grant/latch/corpus (line 972–999)

Augmented the existing post-approve grant block:
```typescript
if (hostComputerGated && finalParams.app) {
  const trust = getComputerSessionTrust()
  const appToken = String(finalParams.app)
  trust.grant(sessionId, appToken)
  trust.clearCredentialLatch(sessionId, appToken)        // ← NEW (P5 §3.2)
  // extract type.text literals from finalParams.actions
  if (typeTexts.length > 0) {
    trust.extendCorpus(sessionId, appToken, typeTexts)   // ← NEW (P5 §3.2)
  }
  logger.info("computer.session_trust.granted", { ... corpus_extended_by: typeTexts.length })
}
```

## 3. Test evidence

### New tests added

- `session-trust-v4.test.ts`: +12 tests (total 30)
  - corpusContains: empty/non-empty grant × empty/non-empty texts (4 tests)
  - corpusContains: subset / new-literal / cross-app / cross-session (4 tests)
  - extendCorpus: no-grant defensive / idempotent / empty-string filtering (3 tests)
  - clearCredentialLatch: clears + no-grant defensive (2 tests)
  - corpus survives idle re-grant (1 test)

### Full suite results

- **1793 tests total** (was 1781 before P5)
- **1772 pass**
- **3 fail (all pre-existing, unrelated)**:
  - `isUserWritablePath` — NTFS case-insensitivity test, fails on macOS FS
  - `apps.add lolbin → lolbin_denied` — pre-existing path-validation order
  - `deletes companion date logs older than retention` — env-dependent

### Type-check

`npx tsc -p tsconfig.test.json` — clean exit 0, no errors.

## 4. Caveats I'd like you to verify

### 4.1 Trust-skip on first-ever task (correctness of corpus empty-set)

For the FIRST task in a session, `corpusContains(sessionId, app, [])` returns true (empty grant + empty texts edge case). But `isTrusted(sessionId, app)` returns false (no grant yet), so the skip gate fails → dialog fires normally. ✓

For the SECOND task with no type actions (e.g., click-only), `corpusContains(sessionId, app, [])` returns true AND `isTrusted` returns true → skip fires. **Is this the intended behavior?** I believe yes — the user already approved this app+session, and click-only tasks have no new type-text surface. But please confirm.

### 4.2 Cross-session corpus isolation

`corpusContains` checks the per-(sessionId, appToken) corpus. Different session = different corpus, even for same app. Implemented and tested (corpusContains does NOT transfer across sessions).

### 4.3 Cross-app corpus isolation

Same as above for different apps in the same session. Implemented and tested.

### 4.4 Latch clear on interactive approve (correctness)

When the latch is set (credential surface detected mid-task) and the next task forces a dialog, the user approves → `clearCredentialLatch` clears the latch. The corpus is also extended. **Question**: should clearing the latch also reset idle expiry (set `lastTouchedAt = now`)? Currently `grant()` already sets `lastTouchedAt = now` (idempotent re-grant), so this is implicitly handled. ✓

### 4.5 Skip path does NOT clear latch

The skip path bypasses the entire dialog block, so `clearCredentialLatch` does not fire. The latch only clears on INTERACTIVE approve. **Correct per Grok v4.1 §3.2**: "After a successful interactive initial L2 approve while credentialSurfaceSeen was true: clear the flag." The skip path is NOT interactive, so latch persists.

### 4.6 Type corpus extraction is naive

Only matches `{ action: "type", text: string }`. Doesn't handle:
- Nested corpora (e.g., if actions had `{ action: "type_batch", texts: [...] }`)
- Conditional corpora (e.g., type-if-exists)
- Hash-normalized texts (current: exact string match — "Hello" ≠ "hello")

For v4.1 this is acceptable (only the literal type action exists). If future actions add more type variants, corpus extraction must be extended.

### 4.7 Budget not consulted

Grok v4.1 §3.4 mentions `draftHasT3OnlyFlags` as a skip-eligibility check. I interpreted this minimally — only checked trust + corpus. The budget is NOT checked (a task with budget=30 vs prior budget=15 would still skip if corpus matches). **Concern**: a larger budget enlarges blast radius even with the same type corpus. Should we also check `budget ≤ priorBudget`?

I left this out because:
- Budget is already capped at MAX_TASK_BUDGET=30
- The corpus check is the primary safety property (new text = new surface)
- Idle expiry (30 min) bounds the blast radius

But you may want stricter.

## 5. Decision requested

**FINAL APPROVE to ship P2–P5** / **BLOCK with specifics** / **CONDITIONAL with caveats**.

If APPROVE: G2 manual lab is the next step (user runs Tahoe lab per Grok v4 §5: A frontmost, B prompt cadence, C coords, D safety). All coding work for Approach C-minus v4.1 is then complete.

If CONDITIONAL: name the additional check(s) you want and I'll patch.

---

*Generated per autonomous workflow: Claude codes, Grok plans, Pi confirms.*
