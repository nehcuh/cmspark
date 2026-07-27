# Batch 1 — Round 3 Amendments Applied

**Date**: 2026-07-24

## Round 3 findings addressed

### Finding 1 — A8 residual doc accuracy ✓

Updated `companion/src/security.ts:validateWildcardPattern` docstring. Now lists the eTLDs that are STILL accepted post-A10 partial expansion:
- `*.azurewebsites.net`, `*.cloudfront.net`, `*.firebaseapp.com`, `*.web.app`, `*.fly.dev`, `*.run.app`, `*.edgeapp.net`, `*.on-aws.com`, `*.lovable.app`, `*.lover.ai`

The previously listed examples (`*.github.io`, `*.appspot.com`, etc.) are now caught by A10's expanded PUBLIC_SUFFIXES set — no longer claimed as residual.

### Finding 2 — A3 brief lead-in ✓

`docs/decisions/v1.3/batch1-security-p0-brief.md` Fix 2 lead-in updated:

> Post-spawn, `fs.statSync(pre.realpath)` on the **path** (`statInodeDev`); if inode/dev changed, kill + report. A3 (Grok round 2): this catches rename-swap but NOT same-inode content rewrite — full process-image identity check via `proc_pidpath`/`lsof` is P1.

Struck the "re-fstat the spawned child's proc-info path" wording.

### Finding 3 — A11 try/catch for UTF-8 byte-length mismatch ✓

`companion/src/security-policy.ts:timingSafeEqual` wrapper now catches RangeError:

```typescript
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return cryptoTimingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}
```

Added regression test `S-P0-5 / A11: UTF-8 byte-length mismatch does not throw (returns false)` (`companion/tests/security/security-policy.test.ts`) — issues a token for toolName `"é"` (UTF-8 2 bytes) and validates with `"a"` (UTF-8 1 byte). Both JS length 1, different byte length. Asserts `doesNotThrow` + returns false.

## Test results

```
companion:        1727 tests, 1708 pass, 3 fail (pre-existing, unchanged)
chrome-extension: 200 tests,  199 pass, 1 fail  (pre-existing, unchanged)
tsc:              clean both sides
```

**Awaiting**: APPROVE / FURTHER AMENDMENTS / REJECT.
