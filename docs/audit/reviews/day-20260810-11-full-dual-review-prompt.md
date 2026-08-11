# Dual external review — Full day (2026-08-10→11): multi-adv deep + C10 god-file split

## Context

**Branch tip:** `fix/c10-godfile-split-a` @ `cd3aa9c`  
**Base:** `origin/main`  
**PRs:**
- **#162** `fix/multi-adv-deep-wave012` — multi-adversarial deep Wave0–2 security/UX fixes (already dual r3 both APPROVE)
- **#163** stacks on #162 — C10 phased god-file mechanical extract A→H (each phase dual-reviewed; this is **integrative end-of-day re-review**)

## Do NOT
- Do not rubber-stamp prior phase verdicts.
- Do not read the multi-MB `docs/audit/reviews/*-diff-*.patch` audit dumps as primary evidence.
- Prefer live tree + code-only diff:

```bash
git log --oneline origin/main..HEAD | head -40
git diff --stat origin/main...HEAD -- companion/src chrome-extension/src docs/adr docs/mcp.md docs/computer-use-user-guide.md docs/host-and-apps.md CHANGELOG.md
# Sample critical modules with Read/Grep
```

## Part 1 — Multi-adv deep security/UX (must re-verify)

Findings C1–C16 from multi-adversarial deep review. Confirm still correct at tip:

| ID | Expected |
|----|----------|
| C1 | Dual-clock: pre-arm cruise snapshot + durable file + boot reconcile; bare disarm no clobber unless clear_cruise |
| C2–C3 | 急停「值守仍开」; Confirm Center 值守 banner |
| C4 | Matrix evaluate still forceConfirms under default 值守 (three-flag only) |
| C5 | Pack Trust skip_l2 requires confirmation_phrase server-side |
| C6 | Worker HARD_DENY in isToolAllowed + thread.update filter |
| C7–C8 | shell cwd / netsec ports normalize before L2 bind |
| C9 | WS lockstep test router ⊆ validators |
| C12 | security-gates no false-green force_confirm OR |
| C13–C15 | SUPERSEDED SoTs; mcp require_grant true; CU AppsPanel docs |

**Key paths:** `computer/unattended-grant.ts`, `message-router.ts` unattended arm/disarm, `threads/thread-manager.ts`, `tool/l2-admission.ts` forceConfirm algebra, extension SafetyStrip/Cockpit/autopilot-tier/PacksPanel.

## Part 2 — C10 god-file split (mechanical integrity)

`server.ts` **7421 → ~1022** LOC via extractions. Confirm:

1. **No circular imports** lifecycle ↛ server; companion-dispatch/mcp-dispatch bind patterns.
2. **createToolExecutor order** preserved:
   `normalize → tool.start → pregate → cookie → browser_download → L2 → URL → image → companion/MCP → forward`
3. **Security algebra moved not rewritten** for L2, cookie, URL, IMAGE_FETCH, MCP critical, outbound originWs.
4. **Public re-exports** still work for tests (`startServer`, `handleSecurityConfirmationResponse`, `pendingToolCalls`, `enhanceMcpError`, `validateWsMessage`, …).
5. **bind* runtime** called (initServices / seedThreadManager / module load) so tests don't hit "not bound".

**Key modules:**

| Module | Role |
|--------|------|
| `ws/lifecycle.ts` | startServer, auth, broadcast |
| `ws/validate.ts` | validateWsMessage |
| `ws/tool-forward.ts` | pending map, dispatch, forward |
| `security/confirm-response.ts` | L2 response + whitelist injection guard |
| `orchestrator/tool-pregate.ts` | ADR-015 multi-agent |
| `tool/l2-admission.ts` | L2 forceConfirm / token |
| `tool/url-cookie-admission.ts` | cookie + navigate URL |
| `tool/image-fetch-admission.ts` | analyze_image two-phase |
| `tool/browser-download-admission.ts` | path sandbox |
| `tool/companion-dispatch.ts` | companion tools |
| `mcp/dispatch.ts` | MCP tools/meta |

## Part 3 — Tests / regressions

Prefer re-running (or confirming from prior evidence + spot-check):

```bash
cd companion && npx tsc -p tsconfig.test.json
node --test .test-dist/tests/integration/security-gates.test.js   # expect 63
node --test .test-dist/tests/ws-router-validator-lockstep.test.js
node --test .test-dist/tests/computer-unattended-grant.test.js
node --test .test-dist/tests/worker-hard-deny-runtime.test.js
node --test .test-dist/tests/orchestrator-tool-pregate.test.js
node --test .test-dist/tests/ws-tool-forward.test.js
node --test .test-dist/tests/image-fetch-admission.test.js
node --test .test-dist/tests/url-cookie-admission.test.js
node --test .test-dist/tests/ws-origin.test.js .test-dist/tests/healthz.test.js
```

Pre-existing computer-executor/uia-watch failures on main are **not** blockers if identical to base.

## Capability declaration (ADR-020)

- **Surface:** L2 honesty/bind/isolation unchanged in product; multi-adv hardens gates; C10 is structure only
- **Composition:** Pack Trust phrase step-up only; MCP dispatch extract
- **Autonomy:** unattended dual-write lifecycle fix; multi-agent pregate extract
- **Trust:** restore cruise on disarm/TTL/boot; no new skip paths; originWs preserved on confirms
- **Channel:** Side Panel + Companion; no new runtime

## Verdict guidance

- **REJECT** if security algebra regression, missing bind, broken order, or C1–C8 incomplete
- **APPROVE_WITH_NITS** for residual docs/test nits, C10 cosmetic, deferred tabUrlCache colocation
- **APPROVE** if production code is shippable after #162+#163 merge order

Final line MUST be exactly one of:
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
