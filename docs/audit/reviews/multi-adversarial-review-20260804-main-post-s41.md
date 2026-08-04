# Multi-Adversarial Code Review — main post-S41 (Outbound MCP + SPA scroll + S41 P0 fix)

**Date**: 2026-08-04  
**Range**: `79d7420..d4c4ebf` (after `git pull --ff-only origin main`)  
**Base**: `79d7420` (S41 multi-adv tip / Pi merge-gate docs for PR #114)  
**Tip**: `d4c4ebf` (`docs(mcp): document Outbound MCP for Grok…` #116)  
**Method**: 4 independent adversarial lanes in parallel (Security / Correctness / Architecture / Compat)  
**Orchestrator**: Grok Build · omx-code-review style synthesis  
**Diff artifact**: `docs/audit/reviews/s42-main-pull-diff-20260804.patch`  
**Lane reports**:
- [`s42-lane-security-20260804.md`](s42-lane-security-20260804.md)
- [`s42-lane-correctness-20260804.md`](s42-lane-correctness-20260804.md)
- [`s42-lane-architecture-20260804.md`](s42-lane-architecture-20260804.md)
- [`s42-lane-compat-20260804.md`](s42-lane-compat-20260804.md)

**Prior targeted reviews in range** (not re-litigated as open):
- Outbound MCP P0c adversary → Pi **APPROVE_WITH_NITS**
- L8/L9 adversary **REJECT** (B1) → fix → Pi **APPROVE_WITH_NITS**
- S41 multi-adv **REQUEST_CHANGES** → fix commit `45480f9` (P0 closed in live source)

---

## Lane verdicts

| Lane | Status | Recommendation |
|------|--------|----------------|
| Security | WATCH | **REQUEST_CHANGES** |
| Correctness | WATCH | **APPROVE_WITH_NITS** |
| Architecture | WATCH | **APPROVE_WITH_NITS** (bake-off only; not Trust-complete ship) |
| Compat/Platform | WATCH | **APPROVE_WITH_NITS** |

## Final synthesis

| Field | Value |
|-------|--------|
| **Architectural status** | WATCH |
| **Internal multi-lane (initial)** | **REQUEST_CHANGES** |
| **After S42 P0 fix** | Security F1 **CLOSED** `[executed]`; residual → **APPROVE_WITH_NITS** (P1 items remain) |
| **Final recommendation** | **APPROVE_WITH_NITS** post-fix (was REQUEST_CHANGES pre-fix) |
| **Merge-ready (code already on main)?** | **YES for isolation claim after P0 fix lands on branch/main**; P1 nits non-blocking for bake-off |
| **Product ship / default-on?** | **No** |
| **Bake-off / opt-in MCP with honest docs?** | **YES** after P0 fix (honest L3+/ws_secret/Windows tray language still required) |

### Deterministic merge gate
- Architect ≠ BLOCK  
- Security **REQUEST_CHANGES** (HIGH confirmed) → internal **REQUEST_CHANGES**  
- Correctness / Architecture / Compat **APPROVE_WITH_NITS** do not override Security HIGH  
- Prior dual (P0c / L8L9) green does **not** cover the new param-injection attack surface on the shared executor  

### Evidence levels
- Lane findings: primarily `[inspected]` live tip source  
- Correctness lane: outbound-mcp / skill-install / shell / B1 integration suites `[executed]` (pass)  
- This synthesis: cross-checked Security F1 against `tool-schemas.ts` + `server.ts` + strip pattern for `security_token` `[inspected]`

---

## Scope (production themes in range)

| Theme | Commits / notes |
|-------|-----------------|
| S41 P0 fix | `45480f9` — skill_install L2, content/zip budgets, dest_path, blank `base_url`, argv ENV=/`~`, shell glyph |
| Outbound MCP P0c→L8/L9 | stdio + loopback HTTP + disclosure + dual-entry + B1 whitelist skip + integration tests |
| Prefer extension WS | `d31be84` — tray must not own CDP runner when extension present |
| SPA scroll CDP-first | `2c65572` — X/Twitter CSP regression |
| MV3 message port | `ec83bce` — always `sendResponse` |
| Docs | ADR-022, `docs/mcp.md`, #116 Grok/troubleshooting |

---

## P0 — must address (HIGH, multi-lane)

### 1. `__outbound_mcp` is LLM-injectable → pack / multi-agent whitelist bypass

- **Status (S42 fix)**: **CLOSED** `[executed]` — 53 outbound-mcp related tests pass after fix
- **Lanes**: Security F1 (primary); Architecture residual on shared executor trust  
- **Evidence** `[inspected]` (pre-fix):
  - `server.ts` — `isOutboundMcpCall = (finalParams as any).__outbound_mcp === true` **skipped** `threadManager.isToolAllowed`
  - `companion-http.ts` — legitimate outbound path **sets** the flag after Bearer auth
  - `tool-schemas.ts` — `GENERIC_FALLBACK = z.record(z.unknown())` preserves unknown keys
  - Contrast: LLM-provided `security_token` was already stripped; `__outbound_*` was not
- **Fix landed**:
  1. `createToolExecutor` **always strips** `__outbound_mcp` / `__outbound_caller_id` from params
  2. Re-applies only when `invokeOpts.trustedOutbound === true` (5th arg)
  3. `ensureOutboundToolRunnerWired` passes `{ trustedOutbound: true }` after Bearer-gated HTTP
  4. Adversarial tests: pack whitelist + injected flag without trust → `tool_not_allowed`; trusted path still skips; untrusted runner wire still fails closed
- **Files**: `companion/src/server.ts`, `companion/tests/integration/outbound-mcp-executor.test.ts`

---

## P1 — should fix soon (MEDIUM, multi-lane)

| ID | Lanes | Status | Summary |
|----|-------|--------|---------|
| S-F2 | Security | **CLOSED** S42 | Outbound navigate URL-gate: fan-out + unbound origin + executor socket |
| S-F3 / A-F6 | Sec/Arch | **CLOSED** S42 | L2 preview + binding `overwrite=true/false` via `skillInstallOverwritePreview` |
| S-F4 | Security | **CLOSED** S42 | Zip header pre-budget before `getData()` + post-getData still enforced |
| C-F1 | Correctness | **CLOSED** S42 | SPA scroll PageUp/PageDown by `deltaY` sign; skip when `deltaY===0` |
| C-F2 | Correctness | **CLOSED** S42 | Outbound runner extension-only (no tray fallback) |
| C-F3 | Correctness | **CLOSED** S42 | Disclosure accept: `ok` reflects companion dual-write; fail → revoke local |
| A-F1 | Architecture | **DOCS** S42 | `docs/mcp.md` honest: agent self-ack ≠ user cloud exfil consent |
| A-F2 | Architecture | open (P1 grant) | `ws_secret` dual-used as MCP Bearer |
| A-F3 | Architecture | open (mid-term) | Dual process disclosure/invoke stacks |
| Compat-C5 | Compat | **CLOSED** S42 | `trayEligible` only Swift; platform-honest OUTBOUND_CONFIRM copy |
| Compat-C6/C7 | Compat | open residual | win32 argv `%VAR%` literal; Downloads segment EN/`下载` only |

---

## S41 P0 residual (closed at tip — do not re-open as P0)

| Claim | Live status | Evidence |
|-------|-------------|----------|
| skill_install L2 + forceConfirm | **FIXED** | `L2_GATE_TOOLS` + token bind + god-mode never skip |
| content size cap | **FIXED** | `MAX_CONTENT_BYTES = 256KiB` |
| zip uncompressed budget | **FIXED** | extract loop + cleanup (memory residual = P1) |
| dest_path / name honesty | **FIXED** | engine return values surfaced |
| config.test empty `base_url` | **FIXED** | `nonBlank` merge |
| POSIX `FOO=1` / unquoted `~` | **FIXED** | stay `shell:true` |
| Outbound B1 `isToolAllowed` | **FIXED** for **real** outbound path | skip only when flag set (but flag trust = **new** P0) |

---

## What is solid (do not regress)

- Outbound default profile fail-closed (no cookies/eval/host/shell/netsec/`skill_install` on allowlist)
- Caller `disclosure_accepted` ignored; server session only (even if accept is self-service)
- Loopback bind `127.0.0.1` + Bearer auth on invoke/disclosure
- L9 dual-entry: explicit `tabId`, Side Panel wins force-release, structured queue errors
- Prefer extension WS over tray when both connected
- SPA scroll expression numeric-only (no user string injection)
- MV3 runtime message always `sendResponse` (port closed noise fixed)
- `windowsHide: true` on both shell spawn paths; win32 argv still PE/COM only
- skill_install `%TEMP%`/`%USERPROFILE%` expand; audit lines on install
- Integration coverage for outbound B1 + full stack `[executed]`

---

## Claim matrix (honest)

| Claim | Allowed? |
|-------|----------|
| S41 skill_install / config.test / argv P0 closed | **YES** |
| Outbound MCP Phase 0 code exists + opt-in (`mcp-outbound`) | **YES** |
| L8/L9 B1 production break closed for HTTP-tagged outbound | **YES** |
| Pack / multi-agent tool whitelist isolation holds under adversarial LLM args | **NO** until P0 #1 |
| Product ship / default-on / multi-tenant IDE isolation | **NO** |
| “User accepted cloud exfil” privacy ship language | **NO** (agent self-ack) |
| Windows native tray confirm for outbound L8 | **NO** (Side Panel + notifier only) |

---

## Recommended next actions (priority order)

1. **P0**: Strip / ALS-bind `__outbound_mcp` — never trust LLM params; add adversarial pack test  
2. **P1**: Outbound runner = extension-only (no tray fallback)  
3. **P1**: SPA scroll direction-aware PageUp/PageDown + non-stacking fallbacks  
4. **P1**: Disclosure accept body honesty + (product) human confirm for L3+  
5. **P1**: skill_install overwrite preview; zip header/stream budget before `getData()`  
6. **P1**: Platform-honest L8 copy; optional URL-gate fan-out for outbound navigate  
7. Optional dual external re-review (`scripts/dual-external-review.sh`) after P0 fix

---

## Orchestrator note

This batch landed **after** S41 multi-adv and after targeted outbound P0c/L8L9 duals. Those reviews correctly closed their scoped claims. The multi-lane post-pull review surfaces a **composition bug at the shared executor boundary**: B1’s skip flag is correct for real outbound, but provenance is client-controlled on the Side Panel path — same class as the historical `security_token` strip.

**Final internal recommendation: REQUEST_CHANGES** (fix Security F1 before treating isolation / Outbound-on-shared-executor as closed).
