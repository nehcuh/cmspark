## Review: acp-coding-handoff-impl (feat/coding-handoff)

I read the actual code at HEAD (commits `6c7a170`, `23515e0`, `933bf39`), ran the two new test files (6/6 and 4/4 pass), and traced the L2 admission path end-to-end.

### Verification checklist

| Item | Result |
|---|---|
| 1. Phase A terminal button copy-first (no free exec) | ✅ `CodingTaskPackageModal.doOpenTerminal` copies to clipboard + toast only; no `exec`/`spawn`. |
| 2. Catalog lockstep includes new COMPANION_TOOLS | ✅ all 6 `acp_*` in `COMPANION_TOOLS`, catalog, and `tool-catalog-lockstep.test.ts`. |
| 3. sanitizeAcpConfig forces review_readonly / allow_exec false | ⚠️ partial — see nit N2. |
| 4. ADR-020 no 中层 Agent language | ✅ copy uses "本机终端编程助手 / 外部 Agent"; pack only negates "不是中层 Agent". |
| 5. Workers cannot ACP; propose/start need security_token | ⚠️ workers OK (WORKER_HARD_DENY + `isToolAllowed` runtime + `agent_role` check); token present — but HITL is bypassable, see blocker. |

### Blocker

**B1 — ACP propose/start auto-approve under god-mode / auto_approve_dangerous (violates ADR-025 L4).**
`companion/src/tool/l2-admission.ts:782-793` — `acp_propose_session` and `acp_start_session` are added to `L2_GATE_TOOLS` (lines 63-64) but **not** to `capabilityForceConfirm`. That list is the only thing that forces a dialog when `skipConfirmation` is true. With `security.auto_approve_dangerous=true` or `allow_all_schemes=true` (god-mode), `skipConfirmation` becomes `true`, `forceConfirm` is `false`, and the gate falls into the `else` "auto_approved" branch (line ~1320) where a `security_token` is auto-issued — **no dialog, no HITL**. The LLM can then spawn an external ACP agent process (cwd = user workspace; the prompt is read-only *text* but the external process is explicitly not sandboxed) with zero human confirmation.

This directly contradicts the design the branch claims to implement:
- ADR-025 L4: `acp_propose_session / acp_start_session 强制 L2；autoConfirmEligible 不适用静默`
- Product design: `auto_approve / 无人值守跳过 ACP | Never` (line 467), `禁止自动 spawn`
- The code's own comment at `l2-admission.ts:63-64`: "ADR-025 ACP coding handoff — spawn/start always HITL"

Sibling "real HITL" tools (`spawn_worker`, `board_complete`, `ask_user`) are correctly in `capabilityForceConfirm`; the ACP spawn tools were simply omitted — an incomplete fix. Fix: add `toolName === "acp_propose_session" || toolName === "acp_start_session"` to `capabilityForceConfirm` (and add a regression test under god-mode, which currently does not exist).

### Nits

- **N1 — ACP tokens are unbound (empty payload).** `security-policy.ts:46` `bindingPayloadFor` has no `acp_*` case → falls to `default: ""` (line 127). The tokens are bound only to tool name + `"default"` thread, not to `agent_id`/`goal`/`session_id`. The file's own instruction ("Adding a new L2-gated tool: extend this function ONLY") was not followed. Defense-in-depth gap — add cases binding `agent|goal` (propose) and `session_id` (start).
- **N2 — sanitizeAcpConfig does not force `review_readonly`.** `acp/types.ts:89-90` preserves valid `propose_diff`/`agent_default` profiles and can set `allow_write:true`; only the runtime lock in `AcpManager.propose()` (forces `review_readonly`) keeps it read-only. The verify claim "sanitizeAcpConfig forces review_readonly" is overstated. Effective behavior is safe (manager demotes + hardcoded read-only prompt), and `allow_write`/`allow_exec` are dead fields — but the sanitizer should demote to `review_readonly` itself to make the invariant true at the config boundary.
- **N3 — No thread ownership on start/collect/cancel/status.** `companion-dispatch.ts:282,314,332,340` look up sessions by id without checking `session.thread_id === caller __thread_id` (only `propose` checks worker role). Workers are still blocked by `WORKER_HARD_DENY`, and session ids are unguessable, so low severity — but a cross-thread start/cancel should be explicitly refused.
- **N4 — Dead code in meta-slash.** `meta-slash.ts:359-368`: the `coding_handoff` fallback branch is nested inside the `meta-cockpit` block after an unconditional `return`, so it is unreachable. `/code` and `/编程` still resolve via `byName`, so it's latent — but the brace placement is wrong and should be moved out.
- **N5 — "在终端打开" button never opens a terminal.** `CodingTaskPackageModal.tsx:109-119` copies + toasts "请打开终端粘贴" only; the label and the dead `copiedAndTerminal`/`terminalFailed` copy strings are misleading. Copy-first is correct per design, but the button should be relabeled (e.g. 复制) or the terminal-open implemented.
- **N6 — No L2 test coverage for ACP.** `acp-handback-workspace.test.ts` covers framing/workspace/taint/sanitize only; nothing asserts propose/start force-confirm (which is exactly what would have caught B1).

VERDICT: REJECT
