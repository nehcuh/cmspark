I'll start from the R2 index and read every listed part, staying inside that snapshot with no extra files, commands, or subagents.Index lists two parts as one continuous packet. Reading both next.# R2 independent review — #453 wiring + #454/#455 Packs + #450 template

Read-only packet review of `453-wiring-packs-r2-index.md` + parts 1–2 as one continuous diff. No other files, commands, edits, or subagents. Evidence is **[inspected]** only. Packet-asserted machine result (wiring 23/23, build exit 0) is **not** re-executed here.

**Not in scope, not approved:** core checker, MCP modules, release, or true enterprise acceptance. Those remain separate gates.

---

## Trusted invocation composition

`bindChatEvidenceScope` is a real `ToolExecutorFn` wrapper: it spreads the fifth-arg `invokeOpts` and then overwrites only `evidenceScope`. That is the right shape for composing with #451 `siteContextTabId`.

```16:19:companion/src/business-evidence/chat-scope.ts
export function bindChatEvidenceScope(execute: ToolExecutorFn, threadId: string): ToolExecutorFn {
  return (id, name, params, signal, invokeOpts) =>
    execute(id, name, params, signal, { ...invokeOpts, evidenceScope: { kind: "chat", threadId } })
}
```

Chat `handleMessage` binds that wrapper at the three `executeTool` injection sites. `createToolExecutor` then takes scope **only** from `invokeOpts`, and only when `kind === "chat"`, `trustedOutbound` is unset, and the thread still exists. `__thread_id` is written onto `finalParams` from that bound scope, not from model args.

WS test `Chat evidence wrapper composes trusted tab metadata…` sends forged `__site_context_tab_id: 999` plus trusted `{ siteContextTabId: 7 }` and asserts the wire tab is `7`. Unbound `draft_create` with a planted `__thread_id` returns `DRAFT_CHAT_SCOPE_REQUIRED`. Bound create with a foreign `__thread_id` still lands in the wrapper thread; foreign `draft_read` is `DRAFT_NOT_FOUND`.

#451 `resolveSiteTarget` staying on the unbound `session.executeTool` is the correct split: site-target resolution is not this wrapper’s job.

## Midflight policy / deletion

Write permission is an AND of dispatch and completion:

- Start: `captureWritesAllowedAtStart` is false if the live Chat thread is `plan_readonly`.
- End: capture runs only if that thread still exists **and** is still not `plan_readonly`.
- Deleted thread at completion → `currentEvidenceThread` is missing → `captureLocalPageResult` is invoked with `scope === undefined` → no new observation.

The WS test flips `plan_readonly → default` and deletes the thread **during the pending `get_page_text`**. Both paths stay `success: true` for the ordinary read, with `observation_id === undefined` and an empty store. That is the attack that matters (capturing by relaxing policy midflight).

Plan mode still allows the page read; it only skips durable capture (`PLAN_READONLY`). `draft_update` is blocked by the producer with `PLAN_READONLY_BLOCKED`. `draft_render` remains allowed. `PLAN_READONLY_ALLOWED_TOOLS` gained `draft_read` / `draft_render` only.

## Strict Chat evidence boundaries

| Boundary | Packet behavior |
| --- | --- |
| Scope source | Router-owned fifth arg; params cannot supply it |
| MCP / outbound | `trustedOutbound` drops Chat scope; `executeDraftTool` rejects missing and `kind: "mcp"` |
| Capture tools | Only `get_page_text` / `get_page_html`, and only after authenticated L1 forward |
| Caller-authored IDs | `observation_id` / `evidence_capture` stripped before model delivery |
| DOM | `NON_ATOMIC_DOM_READ`; content still returned |
| Abort | `INTERRUPTED` before store write |
| Store errors | `EVIDENCE_STORE_ERROR`; corrupt file left intact |
| Adapter metadata | Only `__thread_id` and `tabId` stripped; legacy aliases stay unknown business input |
| Errors | Non-`CODE` messages mapped to `INVALID_DRAFT_REQUEST_OR_STORE` |

Unit tests loop **both** text and HTML through forge / DOM / abort / plan / error. Ordinary chats are documented as in-scope for bounded capture; that matches the router bind, not Mission-only.

`criteria_catalog` is empty until `requirement.id` and `requirement.acceptance_criteria` are both `supported`; then IDs match `^REQ-1#[a-f0-9]{64}$`. `draft.mutation_result` is absent on read.

## Pack / catalog / plan tests, both independent Missions

Catalog, companion dispatch, and plan allowlist line up:

- `COMPANION_TOOLS` + `BUSINESS_DRAFT_TOOL_DEFINITIONS` + `executeCompanionTool` cases: all four draft tools
- Plan allowlist: read/render only
- Inject path is the existing catalog injector (same pattern as `skill_install`)

Both builtin Missions (`change-material`, `development-trace`):

- `kind: mission`, `requires_modules: []`, `mcp_servers: []`, `min_capability: L1`, `workspace: none`, `board_mode: false`
- Allow: page read/nav + draft_* + progress/block + `use_skill`
- Deny / not-allowed: shell, host, evaluate, workers, ACP, `mcp__remote__write`

Pack test installs and applies through the existing Pack engine, asserts those allow/deny sets, then unapplies. Example loader locks 7 bindings, 7 collection scopes, 8 source bindings, `pass_values: ["passed"]`, `freshness.runtime_ms: 900000`, and `criteria_cases.from.kind === "acceptance_criterion"`. Prompts tell the model not to claim publish/complete/full crawl; docs say the example is not enterprise acceptance.

Harness note in-packet: `_security-gates-setup` sets `CMSPARK_DATA_DIR` before server imports; the Pack test does the same around `initDataDir`.

---

## Findings

### BLOCK
None.

### MAJOR
None. Core checker and MCP are **not** implied-green by this verdict.

### NIT
1. Composition WS test proves trusted `siteContextTabId` survives the wrapper, but does not pass a forged `invokeOpts.evidenceScope` and does not run a **single** `get_page_text` that both captures and uses trusted tab `7`. Structure already separates the two fields; a combined call would lock the intended composition more tightly.
2. Midflight TOCTOU is only exercised for `get_page_text`. HTML shares the same executor branch and is covered in unit tests; still a WS gap.
3. Plan-mode producer coverage is `draft_update` blocked + `draft_render` allowed. `draft_create` blocked and `draft_read` allowed are allowlist-implied, not asserted.
4. `captureLocalPageResult` forwards the raw L1 `result` (including forged `observation_id` / `evidence_capture`) into `store.capture`, while stripping those fields only on the model-visible copy. Tests show the **returned/store id is not `"forged"`**, so this is defense-in-depth for the core store gate, not a demonstrated ID bind.
5. Failed page reads return the original `result` without stripping forged IDs. Citations still have to hit the store; fail-closed strip would be cheaper hygiene.
6. `writesAllowed` defaults to `true`. The sole caller passes the AND flag; a future caller that omits it would fail open on plan.
7. Pack YAML `deny` lists host/ACP/shell but not MCP write names. `mode: allowlist` plus `isToolAllowed(..., "mcp__remote__write") === false` already covers it.

---

## Gates (explicit, not approved here)

| Gate | This packet |
| --- | --- |
| Core checker / store / schema | Separate. Not approved. |
| MCP grant/session, profile allowlists, outbound executor | Not in packet, not exposed. `executeDraftTool` rejects MCP scope; `trustedOutbound` drops Chat evidence. **MCP remains a separate gate.** |
| Release / true enterprise acceptance | Docs and remaining choices correctly refuse this. Synthetic fixtures ≠ pilot acceptance. |

Generic model catalog exposing draft tools to ordinary Chat is a documented product choice, not a Mission-only feature. MCP allowlists are unchanged here and must be re-checked when #456 lands.

---

## VERDICT: **APPROVE_WITH_NITS**

Wiring composition, midflight plan/delete, Chat evidence boundaries, catalog/plan allowlists, and both independent-mode Missions are consistent in this packet. No MAJOR. NITs are test-tightening and defense-in-depth, not merge blockers for this gate.

Do not treat this as core approval, MCP approval, or enterprise-pilot acceptance.
