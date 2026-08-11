# C10 God-file Split — Phase C (2026-08-11)

Branch: `fix/c10-godfile-split-a` (continues Phase A/B on same worktree)

## Goal

Extract **cookie trust gate** + **URL navigate gate** from `createToolExecutor` into `companion/src/tool/url-cookie-admission.ts` with **zero intentional behavior change**.

## LOC before / after

| File | Before (post Phase B) | After | Δ |
|------|----------------------|-------|---|
| `companion/src/server.ts` | 3640 | 3490 | **−150** |
| `companion/src/tool/url-cookie-admission.ts` | — | 285 | new |
| `companion/tests/url-cookie-admission.test.ts` | — | 318 | new |

## What moved

### Block 1 — Cookie trust gate

- **From** `server.ts` `createToolExecutor`: comment `// Security Pre-flight Checks (P0 - Cookie Trust Domains Gate)` through end of `COOKIE_TOOLS` block
- **To** `runCookieTrustAdmission(ctx): AdmissionEarlyResult` (sync)
- **Tools**: `get_cookies` / `set_cookie` / `delete_cookie` / `list_all_cookies` (`COOKIE_TOOLS`)
- **Behavior preserved**:
  - domain from params / URL (`getDomainFromUrl` injected)
  - `isTrustedDomain` / `cookieTrustBlockedPayload`
  - full-autonomy cruise waive via **`isFullAutonomyCruise(getConfig().security)`** (reuses pure helper from `l2-admission.ts`; no re-inlined three-flag AND)

### Block 2 — URL navigate gate

- **From** `server.ts`: comment `// Audit item 12: navigate...` through end of `URL_GATE_TOOLS` block
- **To** `runUrlNavigateAdmission(ctx): Promise<AdmissionEarlyResult>` (async)
- **Tools**: `navigate` / `create_tab` / `set_tab_url` (`URL_GATE_TOOLS`)
- **Behavior preserved**:
  - Layer 1 scheme hard-block + god-mode (`allow_all_schemes`) audit
  - Layer 2 domain gate: `auto_approved_domains` ∪ `auto_approve_dangerous` ∪ `allow_all_schemes` (ADR-007: cookie trust does **not** skip URL)
  - outbound MCP fan-out + unbound origin; Side Panel origin-bound
  - `wsAuthGet` injection (no circular import of `wsAuth`)

### Wiring in `createToolExecutor`

Order unchanged:

```
multi-agent → cookie → browser_download → L2 → URL → image → dispatch
```

```ts
const cookieOutcome = runCookieTrustAdmission({ ... })
if (!cookieOutcome.ok) return cookieOutcome.result
// browser_download path sandbox (still in server)
const l2Outcome = await runL2ToolAdmission({ ... })
// ...
const urlOutcome = await runUrlNavigateAdmission({ ... })
if (!urlOutcome.ok) return urlOutcome.result
```

### Re-exports from `server.ts`

```ts
export {
  runCookieTrustAdmission,
  runUrlNavigateAdmission,
  COOKIE_TOOLS,
  URL_GATE_TOOLS,
} from "./tool/url-cookie-admission"
```

### FREEZE update

- `createToolExecutor` shell documents cookie/URL living in `tool/url-cookie-admission.ts`
- `l2-admission.ts` FREEZE no longer claims cookie/URL stay in server

## Not moved (deferred)

| Item | Why |
|------|-----|
| `browser_download` path sandbox | Explicit Phase C exclusion |
| `runL2ToolAdmission` | Already Phase B |
| `analyze_image` / `analyze_image_fetch` IMAGE_FETCH_GATE | Separate gate family; still in `server.ts` |
| `COMPANION_TOOLS` dispatch | Phase A / companion-dispatch |
| Dual-review of extracted module | Pending (this note flags it) |

## Verification (executed)

```bash
cd companion
npx tsc -p tsconfig.test.json
node --test .test-dist/tests/url-cookie-admission.test.js   # 12 pass
node --test .test-dist/tests/l2-admission-pure.test.js        # 5 pass
node --test .test-dist/tests/integration/security-gates.test.js # 63 pass
```

All of the above **pass** (80 total when run together).

## Constraints honored

- No intentional behavior change
- Cookie cruise uses shared `isFullAutonomyCruise` (same three-flag semantics)
- Image gate + browser_download + L2 left untouched
- Worktree only (`cmspark-wt-c10-godfile`); no push
