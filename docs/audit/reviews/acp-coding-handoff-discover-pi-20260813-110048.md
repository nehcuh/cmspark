I've inspected the diff and the actual code across both companion and extension. All five verification points check out against the real implementation. Here's my review.

## Findings

**Verify point 1 — ACP forceConfirm never waived under god-mode: ✅ PASS**
`companion/src/tool/l2-admission.ts:782-816`:
```ts
const acpForceConfirm =
  toolName === "acp_propose_session" || toolName === "acp_start_session"
...
const forceConfirm =
  acpForceConfirm ||
  ((capabilityForceConfirm || hostComputerGated) && !userFullAutonomy)
```
The cruise-waive branch (`if ((capabilityForceConfirm || hostComputerGated) && userFullAutonomy && !acpForceConfirm)`) explicitly excludes ACP, so even three-flag full autonomy cannot skip the confirm. Additionally, the ACP taint gate (`acp_q5_force_l2`, lines 757-775) clears `skipConfirmation` for ACP tools on handback-tainted threads, and `companion-dispatch.ts` requires an L2 `security_token` for both `acp_propose_session` (line 240-254) and `acp_start_session` (line 282-295).

**Verify point 2 — FocusBand priority: ✅ PASS**
`focus-band-priority.ts:resolveFocusBandSlot` order is `confirm` → `l2_safety` (`hasL2Task`) → `coding_session` → `fleet` → `thread_tools` → `l1_context`. `FocusBand.tsx:94-105` feeds `hasCodingSession` (running/offered/handback) correctly.

**Verify point 3 — Stop sends only `acp.session.cancel`: ✅ PASS**
`CodingSessionChip.tsx:onStop` sends `{ type: "acp.session.cancel", session_id }` only. Copy uses `停止编程会话` (`copy.ts:21`), not `急停`. `validate.ts` enforces `session_id`, and `manager.cancel()` kills SIGTERM→SIGKILL without touching CU abort.

**Verify point 4 — No free-exec from Phase A copy path: ✅ PASS**
`CodingTaskPackageModal.tsx` — `doCopy`/`doOpenTerminal` are clipboard-only (`copyTextToClipboard`). The ACP start path (`doAcpStart`) sends `acp.ui_start`, which in `handlers.ts:68-125` requires `ctx.requestConfirmation` (else cancels the offered session and errors), sets `autoConfirmEligible: false`, `riskLevel: "high"`. Confirmation is origin-bound via `{ originWs: ws }` (`lifecycle.ts:1196-1205`).

**Verify point 5 — acp.enabled default false: ✅ PASS**
`config.ts:446` (`acp: { enabled: false, ... }`) and the sanitize fallback (`config.ts:607-615`) both default to disabled.

**Other checks:** discovered agents spawn via absolute `which`→`realpathSync` paths (no shell, no injection); discovery never persists to config.json (`resolveServer` builds ephemeral config); `acp.rediscover` is validated and routed; all ACP tests pass (`10 pass / 0 fail`). Pre-existing failures in `computer-executor`/`computer-uia-watch` are unrelated to this branch.

## Nits

- `companion/src/acp/discover.ts:56` hardcodes `.../node/v24.16.0/bin/pi` in the `pi` common-path probe — brittle version pin; would miss other Node versions.
- `companion/tests/acp-discover.test.ts` is environment-dependent (assertions silently skipped if `claude` isn't on PATH) and leaves `resolveServer` fallback, `listAgents` config/discovered merge-dedup, and `acp.rediscover` cache-reset untested.
- `handlers.ts:45-50` calls `_resetDiscoverCache()` immediately followed by `discoverCodingAgents(true)` — the reset is redundant since `force=true` already bypasses and repopulates the cache.
- `manager.ts:emitProgress` broadcasts the full `handback` (up to 48K) on the close event alongside the 400-char `progress_tail`; the store retains it though the chip never renders it.
- Cancel leaves `codingSession` in `"closed"` state indefinitely — the "完成" chip lingers (no `CLEAR_CODING_SESSION` dispatch on cancel).
- `discoverCodingAgents()` runs `execFileSync` synchronously on the `acp.list` WS path (cached 30s, but first call can block the event loop up to ~2s per probe).

VERDICT: APPROVE_WITH_NITS
