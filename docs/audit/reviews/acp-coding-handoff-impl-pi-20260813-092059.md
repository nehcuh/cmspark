# Dual Review — 编程接力 / ACP coding-handoff implementation

## Summary

I read the full 3579-line diff and inspected the actual repo files (not just the patch). The implementation faithfully covers Phase A (task-package builder + copy-first UX + settings + pack) and Phase B (ACP client manager + 6 tools + L2 gate + worker deny + untrusted handback/taint), all default-off for ACP. The five verify items largely hold; I found no hard security regression. The issues below are hardening gaps, dead code, and missing tests — none break the shipped invariants.

## Verify results

| # | Claim | Result |
|---|-------|--------|
| 1 | No free-exec from Phase A terminal button | ✅ **Verified** — `doOpenTerminal` (`CodingTaskPackageModal.tsx`) only calls `copyTextToClipboard` + a toast; zero `spawn`/`exec`/`open -a` in `coding-handoff/`. Only `document.execCommand("copy")` fallback. |
| 2 | Catalog lockstep incl. new COMPANION_TOOLS | ✅ **Verified** — all 6 `acp_*` names present in both `companion-tools.ts` and `tool-definitions-catalog.json`; `companion/tests/tool-catalog-lockstep.test.ts` enforces it. |
| 3 | `sanitizeAcpConfig` forces `review_readonly` / `allow_exec:false` | ⚠️ **Partial** — `allow_exec` is hard-coded `false` (never in v1). But `review_readonly` is **not** forced: `propose_diff`/`agent_default` are accepted profiles and `allow_write` can be `true` for them (`types.ts:89`). Enforcement is delegated to `manager.propose()` which always demotes to `review_readonly`. Inert but misleading. |
| 4 | ADR-020: no 中层 Agent language in UI copy | ✅ **Verified** — `copy.ts` user strings use 编程接力/终端助手 only. The phrase "中层 Agent/第二 runtime" appears only as a **negation** inside `pack.yaml` system_prompt_append (telling the model what not to say) and docs — not user-facing. |
| 5 | Workers cannot ACP; propose/start need `security_token` | ⚠️ **Mostly** — all 6 `acp_*` in `WORKER_HARD_DENY` ✅; both `acp_propose_session` and `acp_start_session` check + `validateTokenFor` ✅. **But** the L2 token binds to an *empty* payload (see N1). |

## Nits (non-blocking, prioritized)

1. **Empty security-token binding payload for ACP spawn tools** — `security-policy.ts` `bindingPayloadFor` has no `case` for `acp_propose_session`/`acp_start_session`, so both hit `default: return ""` — the exact footgun the code itself warns about at line ~50 ("the `default: ""` footgun … makes tokens replayable across apps"). The token is still toolName-bound and single-use, and is injected server-side (never exposed to the model), so it is not directly exploitable today. But it deviates from design §6.5's params-binding intent and the codebase's own discipline; add `case "acp_propose_session": return \`acp_propose|${agent_id}|${goal}\`` and a session_id-bound payload for start. `companion/src/security-policy.ts:46-84`.

2. **Dead code / mis-nested block in `resolveMetaSlash`** — the `coding_handoff` branch was inserted *inside* the `if (tags.includes("meta-cockpit"))` block, after its `return`, so it is unreachable dead code (`chrome-extension/src/sidepanel/composer/meta-slash.ts:360-368`). Functionally masked because the `byName` lookup at line 347-351 resolves `code`/`编程`. Move the branch outside the `meta-cockpit` block (or delete it — it's redundant with `byName`).

3. **`sanitizeAcpConfig` does not force `review_readonly`** — it permits `propose_diff`/`agent_default` and can persist `allow_write:true` (`companion/src/acp/types.ts:89`). The session-level demote in `manager.propose()` is the real guard, but the config surface contradicts the "review_readonly / allow_exec false" declaration. Consider clamping `allow_write` to false in v1 too.

4. **Prompt temp file is written but never consumed by the child** — `manager.start()` writes the goal (may contain page/code text) to `os.tmpdir()` mode 0600, but `args` never includes `promptPath`; the child only gets the prompt via stdin. The file exists solely for the "prompt at …" error message, and leaks sensitive content in `/tmp` (best-effort unlink on close; orphaned on crash/companion exit). Either pass it via args or drop it.

5. **`propose()` "only one session at a time" check is under-enforced** — it tests `this.runningCount >= 1`, but `runningCount` is only incremented in `start()`, not `propose()`. Multiple *offered* (unstarted) sessions can coexist across threads, contradicting the `ACP_SESSION_BUSY` message intent (`companion/src/acp/manager.ts`).

6. **`acp_collect_result` / `acp_cancel_session` / `acp_get_status` lack thread-ownership checks** — they look up by `session_id` only; a caller in thread B could read/cancel thread A's session if it learned the id (ids are unguessable and not listed, so low risk, but a one-line `thread_id === params.__thread_id` check would close it). `companion/src/tool/companion-dispatch.ts`.

7. **Dead copy + misleading CTA** — `copiedAndTerminal` / `terminalFailed` strings are now unused (the button only copies), and `ctaOpenTerminal: "在终端打开"` labels a button that does not open a terminal. Minor, but the label should say "复制并打开终端说明" or the strings should be removed (`copy.ts:48-50`, `CodingTaskPackageModal.tsx` `doOpenTerminal`).

8. **Test coverage gap** — `acp-handback-workspace.test.ts` and `coding-handoff-task-package.test.ts` are good, but there are no tests for `AcpManager.start/cancel` (spawn lifecycle, timeout kill, `runningCount`), the `acp_*` dispatch cases, the L2 admission entries, or `resolveMetaSlash`. Given this is a spawn/cancel state machine, a lifecycle test would be worthwhile.

## Capability declaration check

Matches the review task declaration (Surface L0/L1, no default L2-classes, acp session start L2, single autonomy, workers deny acp_*, HITL + taint + default-off, community channel). Consistent with ADR-025.

---

VERDICT: APPROVE_WITH_NITS
