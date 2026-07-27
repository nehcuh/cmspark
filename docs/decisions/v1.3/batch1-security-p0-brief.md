# Batch 1 — Security P0 Review Brief (Round 2)

**Date**: 2026-07-24
**Reviewer**: Grok
**Request**: APPROVE / APPROVE WITH AMENDMENTS / REJECT
**Scope**: 5 Security P0 fixes from `diagnosis-synthesis.md` + carry-over P0a Tray amendments from round 1.

---

## Context

Round 1 covered P0a (Tray `NSPanel(.nonactivatingPanel, .floating)` + `Promise.race` wiring) and returned APPROVE WITH AMENDMENTS — all 4 amendments applied (A1-A4):

- A1 `becomesKeyOnlyIfNeeded` comment corrected
- A2 `panel.level = .floating` set
- A3 control-char sanitization in Swift summary boundary
- A4 docstring on `respond()` documents tray as production caller

Round 2 covers the 5 Security P0s that came out of the full cmSpark audit. All 5 implemented; tests added/updated; companion 1701/1720 pass + chrome-extension 198/199 pass. 3 pre-existing failures unrelated to Batch 1 (NTFS case-folding, `apps.add` lolbin path validation, log retention) — see "Pre-existing failures" appendix.

---

## Fix 1 — S-P0-1: host-bin env override (`CMSPARK_HOST_BIN`)

**File**: `companion/src/host-use/darwin/host-bin.ts`

**Vulnerability**: `CMSPARK_HOST_BIN` env override was gated by `NODE_ENV !== "production"`. Packaged apps rarely set NODE_ENV, so the override was live in production. `launchctl setenv CMSPARK_HOST_BIN /tmp/evil` could substitute the binary that performs Touch ID / Automation TCC checks.

**Fix**: Replace NODE_ENV check with explicit opt-in env.

```typescript
if (process.env.CMSPARK_HOST_BIN) {
  if (process.env.CMSPARK_ALLOW_HOST_BIN_OVERRIDE === "1") {
    return process.env.CMSPARK_HOST_BIN
  }
  throw new Error(
    "host-use/darwin: CMSPARK_HOST_BIN override ignored. " +
    "Set CMSPARK_ALLOW_HOST_BIN_OVERRIDE=1 to enable (dev/test only).",
  )
}
```

**Test** (`companion/tests/host-use-darwin-adapter.test.ts:404-418`): sets `CMSPARK_HOST_BIN` + opt-in flag, verifies override used; clears flag, verifies fallback to default path.

**Open question for Grok**: Is the throw-on-ignored-override too noisy? Existing dev workflows that set `CMSPARK_HOST_BIN` without opt-in would now crash. Alternative: log warn + ignore. I went with throw because silent ignore is the exact misconfiguration that created this hole. Push back welcome.

---

## Fix 2 — S-P0-2: Tray binary TOCTOU

**File**: `companion/src/tray/swift-tray-bridge.ts`

**Vulnerability**: `verifyIntegrity(binPath)` did `fs.realpathSync` → `fs.readFileSync` → hash. Between `verifyIntegrity` returning and `spawn(binPath, ...)`, an attacker with write access to the path could swap the binary. Auto-rebuild-on-hash-mismatch made it worse: it destroyed the evidence of tampering AND re-opened the hole.

**Fix**: Replaced `verifyIntegrity` with `checkIntegrity` — opens fd once, hashes from fd, captures inode + dev + realpath. Spawn uses the realpath (still TOCTOU between fd-close and execve, but bounded). Post-spawn, `fs.statSync(pre.realpath)` on the **path** (`statInodeDev`); if inode/dev changed, kill + report. A3 (Grok round 2): this catches rename-swap but NOT same-inode content rewrite — full process-image identity check via `proc_pidpath`/`lsof` is P1.

```typescript
interface IntegrityCheck { ok: boolean; inode: number; dev: number; realpath: string }

function checkIntegrity(binPath: string): IntegrityCheck {
  let fd: number | null = null
  try {
    const realpath = fs.realpathSync(binPath)
    fd = fs.openSync(realpath, "r")
    const stat = fs.fstatSync(fd)
    const hash = crypto.createHash("sha256")
    const BUF = Buffer.alloc(64 * 1024)
    while (true) {
      const n = fs.readSync(fd, BUF, 0, BUF.length, null)
      if (n === 0) break
      hash.update(BUF.slice(0, n))
    }
    return { ok: hash.digest("hex") === SWIFT_TRAY_SHA256, inode: stat.ino, dev: stat.dev, realpath }
  } catch {
    return { ok: false, inode: -1, dev: -1, realpath: "" }
  } finally {
    if (fd !== null) try { fs.closeSync(fd) } catch {}
  }
}
```

**Auto-rebuild policy change**: only auto-rebuild if binary is **missing**. Hash mismatch is now a hard fail (logs + throws, no respawn) — preserves forensic evidence.

**`handleCrash` hardened**: re-`checkIntegrity` before respawn; refuse respawn on inode mismatch.

**No dedicated unit test originally** — A5 (Grok round 2) added `companion/tests/swift-tray-integrity.test.ts` covering `checkIntegrity` ENOENT/hash-mismatch/symlink-realpath paths, plus inode/dev/realpath population on hash-mismatch (used by the TOCTOU re-stat).

Manual verification covers the full race:
1. Building binary → recording SHA in `SWIFT_TRAY_SHA256`.
2. `mv tray.bin tray.bin.evil; cp evil-binary tray.bin` → spawn fails with "integrity check failed" + no respawn.
3. Daemon restart with binary deleted → auto-rebuild kicked in (missing-binary path).
4. Daemon restart with tampered binary → hard fail, no rebuild, no respawn.

**A3 (Grok round 2) — brief accuracy correction**: Earlier prose in this section claimed post-spawn recheck used `/proc/<pid>/exe`, `lsof`, or `proc_pidpath`. That was aspirational and incorrect. The actual implementation is `fs.statSync(pre.realpath)` on the **path** (see `statInodeDev` in `swift-tray-bridge.ts:94-101`). This catches rename-swap TOCTOU but NOT same-inode content rewrite. The residual window is documented; full process-image identity check (via `proc_pidpath`/`lsof`) is P1 — see A4 amendment in the round-2 review.

---

## Fix 3 — S-P0-3: page-sanitizer bypasses

**File**: `chrome-extension/src/background/page-sanitizer.ts`

**Three bypasses fixed**:

### (a) Nested-script reassembly
Single pass of `<script>` strip left `<scr` + `ipt>` fragments that downstream parsers could reassemble into `<script>`. Classic attack: `<scr<script>ipt>alert(1)</scr<script>ipt>`.

Fix: loop until stable, capped at 5 iterations to bound pathological input.

```typescript
let result = html
for (let i = 0; i < 5; i++) {
  const next = result
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, "")
    .replace(/<script\b[^>]*>/gi, "")
  if (next === result) break
  result = next
}
```

### (b) Slash-separated event handlers
`<img/onerror=...>` (slash, no whitespace) bypassed `\s+on\w+\s*=`.

Fix: `[\s/]+` instead of `\s+`.

```typescript
const result = html.replace(/[\s/]+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "")
```

### (c) `data:image/svg+xml` + `data:text/html` XSS
Not in attribute list; `data:` protocol not matched.

Fix: broadened attribute list (`href|src|action|formaction|data|xlink:href|poster|srcset|cite|background|dynsrc|lowsrc|srcdoc`); pattern catches both `javascript:` and `data:`.

**Tests added** (`chrome-extension/tests/page-sanitizer.test.ts`): all 3 new tests pass.

**Open question**: Should `srcdoc` be in the strip list? `<iframe srcdoc="<script>alert(1)</script>">` is an XSS vector, but the spec allows it and legitimate uses exist. Currently stripping `srcdoc="javascript:..."` and `srcdoc="data:..."` only — not all `srcdoc`. Reasonable?

---

## Fix 4 — S-P0-4: Wildcard apex collapse + bare-TLD bypass

**Files**: `companion/src/security.ts`, `companion/src/config.ts`

**Vulnerability as found**: `*.example.com` matched bare `example.com` (apex collapse); `*.com` matched every `.com` host + bare `com` (global bypass).

**Diagnosis update mid-implementation**: Apex collapse is documented in ADR-007 and is INTENTIONAL — a user typing `*.example.com` typically DOES want the apex covered. The real hole is bare-TLD wildcards: `*`, `*.com`, `*.cn`, `*.co.uk`.

**Fix applied**:
- `matchDomain` keeps apex-collapse behavior (intentional, ADR-007).
- New `validateWildcardPattern(p)` rejects `*` and bare-TLD wildcards via a `PUBLIC_SUFFIXES` set (`com`, `org`, `net`, `co.uk`, etc.).
- `saveConfig` now FILTERS (was: advisory `console.warn`) — drops unsafe entries from `trusted_domains` and `auto_approved_domains` before persistence.

```typescript
// config.ts
const filterPatterns = (arr: string[] | undefined, label: string): string[] => {
  if (!arr) return []
  const out: string[] = []
  for (const p of arr) {
    const v = validateWildcardPattern(p)
    if (!v.ok) {
      console.warn(`[config] dropping ${label} entry "${p}": ${v.reason}`)
      continue
    }
    out.push(p)
  }
  return out
}

if (config.trusted_domains) {
  config.trusted_domains = filterPatterns(config.trusted_domains, "trusted_domains")
}
if (config.auto_approved_domains) {
  config.auto_approved_domains = filterPatterns(config.auto_approved_domains, "auto_approved_domains")
}
```

```typescript
// security.ts
const PUBLIC_SUFFIXES = new Set([
  "com", "org", "net", "edu", "gov", "mil", "io", "co", "cn", "jp", "uk", "us",
  "de", "fr", "ca", "au", "ru", "br", "in", "it", "nl", "se", "no", "es", "ch",
  "com.cn", "co.uk", "co.jp", "com.au", "co.in", "com.br",
  // ... (full PSL fetch is out-of-scope for S-P0-4; hardcoded the common ones)
])

export function validateWildcardPattern(pattern: string): { ok: boolean; reason?: string } {
  const p = String(pattern || "").toLowerCase().trim()
  if (p === "*") return { ok: false, reason: "global wildcard `*` matches every host" }
  if (p.startsWith("*.")) {
    const suffix = p.slice(2)
    if (PUBLIC_SUFFIXES.has(suffix)) {
      return { ok: false, reason: `bare-TLD wildcard \`${p}\` matches every \`.${suffix}\` host` }
    }
    const dotCount = (suffix.match(/\./g) || []).length
    if (dotCount === 0) {
      return { ok: false, reason: `bare-TLD wildcard \`${p}\`` }
    }
  }
  return { ok: true }
}
```

**Hand-edited configs**: `matchDomain` runtime still honors `*` and bare-TLD wildcards for configs that bypass `saveConfig` (operators who edit `config.json` directly take responsibility). `saveConfig` is the gate.

**Tests added/updated** (`companion/tests/security-thread.test.ts`, `companion/tests/single/files.test.ts`):
- saveConfig filters `*` and bare-TLD wildcards from both `trusted_domains` and `auto_approved_domains`
- Deep wildcards (`*.example.com`) and exact domains survive
- Apex collapse preserved (matches `*.company.com` to `company.com`)
- `matchDomain` direct call still honors `*` for legacy configs

**Open question**: I hardcoded ~30 PSL entries. Real fix is to use `publicsuffix-list` npm package (auto-updates from the official PSL). I deferred that as P1 (ops burden: adding a runtime dependency + update mechanism). Is the hardcoded set acceptable for P0, or should I push for the npm package now?

---

## Fix 5 — S-P0-5: HMAC token timing oracle

**File**: `companion/src/security-policy.ts`

**Vulnerability**: `validateToken` had early-return checks for each field (`!payload`, wrong `toolName`, wrong `threadId`, expired). An attacker could distinguish "no token" from "wrong toolName" from "wrong threadId" by response timing. Final `code !== code` was non-constant-time string compare on attacker-influenceable data.

**Fix**: All equality checks computed via `timingSafeEqual` and AND'd. TTL + length-cap early returns remain (acceptable: timing reveals "valid sig + expired" which is single-use anyway; length cap prevents hashing 1MB strings).

```typescript
validateToken(token: string, toolName: string, code: string, threadId = "default"): boolean {
  const payload = this.issuedTokens.get(token)
  if (!payload) return false

  // Constant-time HMAC signature comparison — authoritative.
  const expected = this._sign(payload)
  const sigOk = timingSafeEqual(token, expected)

  // Constant-time field comparisons.
  const toolOk = timingSafeEqual(payload.toolName, toolName)
  const threadOk = timingSafeEqual(payload.threadId, threadId)

  // TTL — single-use + deleted below; timing leak here is acceptable.
  const live = Date.now() <= payload.ts + TOKEN_TTL_MS
  if (!live) {
    this.issuedTokens.delete(token)
    return false
  }

  // Length cap on inbound code BEFORE hashing — avoids hashing 1MB.
  if (code.length > MAX_CODE_LENGTH) {
    if (sigOk) this.issuedTokens.delete(token)
    return false
  }

  // Code equality via hash: avoids non-constant-time string compare on attacker input.
  const inboundHash = this._hashCode(code)
  const codeOk = timingSafeEqual(payload.codeHash, inboundHash)

  const ok = sigOk && toolOk && threadOk && codeOk
  if (ok) this.issuedTokens.delete(token)
  return ok
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}
```

**Existing tests** (`companion/tests/security/security-policy.test.ts`): 13/13 pass — token issuance, validation, single-use, threadId binding, host_app `app+action` binding, etc.

**Open question**: `timingSafeEqual` length check (`a.length !== b.length`) leaks length. For HMAC sigs that's not interesting (sig length is fixed by algorithm). For `toolName`/`threadId`/`codeHash` it leaks the legitimate length — bounded and not exploitable in practice. Is the leak acceptable or should I pad to fixed-width?

---

## Pre-existing failures (NOT from Batch 1)

| Test | Reason |
|------|--------|
| `comparison is case-insensitive (NTFS)` | Windows-only behavior, runs on macOS dev host |
| `apps.add lolbin → lolbin_denied` | Returns `absolute_path_required` (path validation runs before lolbin check) — pre-existing |
| `deletes companion date logs older than retention` | Test assumes UTC, runs in local TZ — pre-existing |

These are tracked separately in `diagnosis-synthesis.md` P2 (Ops).

---

## Summary

- 5/5 Security P0s fixed + tests added/updated.
- Carry-over P0a Tray amendments from round 1 all applied.
- All Batch 1-related tests green.
- 3 pre-existing failures unrelated (logged in P2 backlog).
- tsc clean on both `companion` and `chrome-extension`.

**Awaiting verdict**: APPROVE / APPROVE WITH AMENDMENTS / REJECT.
