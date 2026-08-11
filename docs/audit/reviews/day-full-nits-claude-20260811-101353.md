Let me write a brief summary and finalize.

## Review summary

**Diff scope (commit `ee80f72`):** 5 nits closed — image-fetch originWs bind, tabUrlCache colocation, C9 lockstep brace-scoping, static imports, new unit tests.

**Verified `[executed]`:**
- `node --test tab-url-cache + image-fetch-admission + ws-router-validator-lockstep`: 16/16 pass
- `node --test integration/security-gates`: 63/63 pass (incl. M4 image gate, three-flag god-mode, auto_approve_dangerous)
- `node --test computer-unattended-grant + worker-hard-deny-runtime`: 33/33 pass

**Verified `[inspected]`:**
- `image-fetch-admission.ts:205` passes `{ originWs: ws }` — matches the L2/URL/MCP pattern (`server.ts:711`, `tool-forward.ts:183,330`, `mcp/dispatch.ts:198,532`, `lifecycle.ts:1033,1168`, `url-cookie-admission.ts:250`, `l2-admission.ts:1142`).
- `ws/tab-url-cache.ts` is a leaf module (only imports `logger`) — **no circular imports** with server/lifecycle.
- `applyTabNavigated` removed from `bindWsLifecycle` call site; lifecycle.ts imports it directly (`lifecycle.ts:39,1140`). Dep-type kept optional/deprecated for bind compat — non-blocking.
- `tabUrlCache` server-local fully removed; `getTabUrlCache`/`getCachedTabUrl`/`refreshTabUrlCache`/`applyTabNavigated` re-exported from server.ts for test consumers (security-gates.test.ts:24 still works).
- Static imports of `normalizeShellCwd`/`normalizeNetsecPorts` confirmed at declarations (`capability/shell.ts:201`, `netsec/scan.ts:20`); neither module imports server.ts.
- C9 lockstep brace-scope correctly walks `const validators: Record<...> = { … }` depth; new "not whole-file false positives" test asserts `!keys.has("type")` and presence of `chat.create`/`security.unattended.arm`.

**ADR-020 capability check:**
- *Trust monotonicity*: three-flag god-mode test confirms IMAGE_FETCH confirm still fires; `isAutoApprovedDomain` (not `trusted_domains`) is the only skip path — verified at `image-fetch-admission.ts:175`.
- *originWs*: image-fetch now aligned with all other L2/URL/MCP confirms.
- *Capability declaration*: not in implementer prompt, but diff is pure refactor + security hardening on an **existing** gate (no new tools/gates/UI entry points) — declaration requirement not triggered.
- *No new runtime / Pack-first / no bare 中层 Agent*: n/a — no new runtime or surface introduced.

**Nits (non-blocking):**
1. `ws/lifecycle.ts:133` — `applyTabNavigated?` in `WsLifecycleDeps` is now dead (no caller passes it; the handler imports the function directly). The "kept optional for bind compat" comment is speculative; safe to remove in a follow-up.
2. `ws-router-validator-lockstep.test.ts:114` — `extractValidatorKeysLoose` fallback targets an "old layout" that no longer exists in `ws/validate.ts` (the `const validators:` marker is always present). Dead branch; harmless.

Both nits are pure dead-code hygiene — they do not affect behavior or security.

VERDICT: APPROVE
