# Independent adversary — Security / Trust / ADR-020

> **Lane**: Security / Trust / ADR-020 (did **not** implement)
> **Date**: 2026-08-22
> **Worktree**: `/tmp/cmspark-wait-for`
> **Branch**: `fix/wait-for-default` vs `origin/main` (`bebb8c4`)
> **Diff**: `docs/audit/reviews/wait-for-1snvlv-diff-20260822.patch` (13 files, +243/−39)
> **Blast**: T2 L1 — `wait_for` default `network_idle`; `create_tab` load-wait. No new L2.

Do not rubber-stamp. This review treats the 1snvlv ⚠️ as a *candidate* security stop until proven otherwise, then tries to skip L2 / originWs / evaluate / god-mode / recoverability-as-gate through the new default.

---

## Capability declaration (required)

Present in the review prompt body (checklist: PR **or** prompt body):

```text
Surface:      L1 (wait_for default network_idle; create_tab waits for load)
L2-classes:   none
Compose:      none
Autonomy:     single
Trust:        no new confirm dialect; classifyError recoverability only
Channel:      community
```

**Axes fit** `[inspected]`: change hangs on Surface L1 (tab/DOM wait), not Composition, not Autonomy. `SURFACE_BY_TOOL.wait_for` / `create_tab` stay `"L1"` (`chrome-extension/src/sidepanel/mode/surface-by-tool.ts:18,35`). `TAB_L2_TOOLS` remains `{evaluate}` only (`companion/src/orchestrator/constants.ts:88`). Pack-first / new Side Panel chrome: N/A (no new tool, no new UI entry). Experimental TinyClick: untouched.

Missing declaration would be a nit here (no new tools/gates/UI). Declaration is complete for T2 L1.

---

## MACHINE `[executed]`

| Suite | Result |
|-------|--------|
| chrome `wait-for-mode` | **5/5** |
| chrome `tsc --noEmit` | **0** |
| companion `tsc -p tsconfig.test.json` | **0** |
| companion targeted (`wait-for-params`, `tool-schemas`, `security-thread`, `web-act-loop-wave1`, `bridge`) | **128/128** |
| adversary probes (`classifyError` collisions, Zod bounds, `TOOL_EXECUTION_TIMEOUT_MS`) | see Q3 / Q5 |

---

## Diff scope (trust-relevant)

Touched production files only:

| File | Trust-relevant? |
|------|-----------------|
| `chrome-extension/src/background/wait-for-mode.ts` | mode resolver (pure) |
| `chrome-extension/src/background/browser-bridge.ts` | `createTab`, `waitForTabLoad`, `waitFor` |
| `companion/src/tool/wait-for-params.ts` | inject `network_idle:true` |
| `companion/src/llm/adapter.ts` | normalize before `executeTool`; prompt rule 6 |
| `companion/src/security.ts` | `classifyError` recoverable needles only |
| `companion/src/bridge/tool-schemas.ts` | Zod `wait_for` (no selector\|network_idle refine) |
| `companion/src/bridge/tool-definitions-catalog.json` | description + `settle_ms` |
| tests | coverage |

**Not in diff** `[inspected]`: `l2-admission.ts`, `url-cookie-admission.ts`, `security-confirmation.ts`, `evaluate-code-policy.ts`, `config.ts` (`auto_approve_*` / `allow_all_schemes`), `companion-dispatch.ts`, `ws/tool-forward.ts` `originWs` bind, shell/netsec.

---

## Attack questions

### Q1 — New confirm dialect / L2 skip / originWs / evaluate integrity / god-mode?

**No.** `[inspected]`

- **Confirm dialect**: no new `securityConfirmations.request(`, no new Cockpit copy, no new `suggested_action` family that binds a token. Invalid leftover uses existing `codedToolError("WAIT_CONDITION_REQUIRED", …, { suggested_action: "wait_for_network_idle" })` (`browser-bridge.ts:1523-1526`). That is a recovery hint, not L2 HITL.
- **L2 skip**: `wait_for` is not in any forceConfirm algebra. `URL_GATE_TOOLS = ["navigate","create_tab","set_tab_url"]` (`url-cookie-admission.ts:34`) — `wait_for` never was and is not added. `create_tab` still hits the URL gate **before** dispatch; the new load-wait is post-admission (`browser-bridge.ts:478-490`).
- **originWs**: `handleToolResult` still drops cross-socket spoof (`tool-forward.ts:125-132`). Dispatch still stores `originWs: ws` (`:330`). Unchanged.
- **evaluate integrity (P1-3)**: `evaluate()` / `resolveEvaluateExecution` untouched. Selector wait still uses a **fixed** `Runtime.evaluate` template (see Q4). Default tabId-only path does **not** call CDP evaluate — only `waitForTabLoad` + settle (`browser-bridge.ts:1548-1550`). Slightly *less* evaluate surface than the old selector-required mental model for 1snvlv.
- **god-mode (P1-1)**: no `config.set`, no `allow_all_schemes`, no `auto_approve_*`.
- **P1-4 shell**: untouched.

`normalizeWaitForParams` (`adapter.ts:1155-1156`) only spreads `network_idle: true` onto `wait_for` args. It does not strip `security_token`, does not set `__user_confirmed`, does not touch URL-gate params.

---

### Q2 — Trust monotonicity: does making a previously hard-fail wait succeed skip a user-visible stop that was protecting something?

**No. The 1snvlv stop was a schema/runtime mismatch, not a security gate.** `[inspected]` + `[executed]`

**What shipped in prod (thread 1snvlv):**

1. `create_tab` returned `{id, url:"", title:""}` (no load wait).
2. Model called `wait_for({tabId})` (catalog `required: [tabId]` only).
3. Extension `throw new Error("selector or network_idle is required")` in ~4ms.
4. `classifyError` defaulted to **`non_recoverable`** (string matched neither `"timeout"` nor `"missing required"` / `"required parameters"`).
5. Side Panel `⚠️` / `chat.error`. User 「继续」; same call; same stop.

**Old runtime** `[inspected]` (pre-diff `waitFor`): `if (selector) …; if (params.network_idle) …; throw`. That throw is argument validation, not:

- cookie trust domain
- navigate/create_tab URL Layer 1/2
- evaluate `security_token` bind
- CU / shell / netsec forceConfirm
- user deny / `Security Block:`

ADR-020 trust monotonicity is “deeper Surface must not inherit looser L0 semantics; god-mode / auto_approve must not silently skip CU/shell/netsec L2.” This PR does not deepen Surface and does not inherit L0 skip. It makes an **already-catalog-legal** L1 call do the documented wait — the same wait that `wait_for({tabId, network_idle:true})` already performed **without** confirmation.

The ⚠️ was an *accidental circuit-breaker* on a confused tool call. After it, the user still had an open tab (create_tab had already succeeded). Removing that stop does not skip a gate that was supposed to fire; it unblocks the turn that the catalog already authorized.

**Residual (named, not a skip):** leftover `network_idle:false` without selector is now `WAIT_CONDITION_REQUIRED` + **recoverable** → LLM gets 3 retries (`MAX_SAME_TOOL_RECOVERABLE_FAILURES = 3`) then a loop-guard `chat.error`, instead of an immediate ⚠️. That is more autonomy on an *invalid* shape, still not L2.

---

### Q3 — `classifyError` needles overly broad?

**Not a security downgrade. Slightly sloppy substring, non-blocking.** `[executed]`

Added to the **recoverable** list (`security.ts:1041-1043`), after security / non_recoverable:

```text
"wait_condition_required"
"selector or network_idle"
"network_idle is required"
```

Match is `msg.toLowerCase().includes(p)` and is **not** scoped to `toolName === "wait_for"`.

Probes `[executed]`:

| Message | Level | Why it matters |
|---------|-------|----------------|
| `selector or network_idle is required` | recoverable | intended 1snvlv leftover |
| `WAIT_CONDITION_REQUIRED: selector or network_idle is required` | recoverable | codedToolError form |
| `Security Block: evaluate … User denied` | **security** | security path first |
| `User denied execution of wait_for because network_idle is required` | **security** | `"user denied"` wins |
| `blocked by user: selector or network_idle` | **security** | same |
| `permission denied` | non_recoverable | non_recoverable list first |
| `permission denied: selector or network_idle is required` | **non_recoverable** | `"permission denied"` before recoverable |
| `not in trusted domains` / `cookie domain mismatch` | non_recoverable | unchanged |
| `the network_idle is required by policy to skip confirmation` | recoverable | **theoretical** false positive; no such production string |
| `Tool execution timeout (15000ms): wait_for` | recoverable | pre-existing `"timeout"` needle |

`"network_idle is required"` is a **substring of** `"selector or network_idle is required"` — redundant for the actual leftover. `classifyError` is **not** a confirm skip: it only chooses `chat.error` stop vs LLM retry (`adapter.ts:1373-1410`). Security / non_recoverable still short-circuit first.

Nit N1: global (not tool-scoped) needles; redundant `"network_idle is required"`. Do not treat as a gate hole.

---

### Q4 — Selector interpolated via `JSON.stringify` into `Runtime.evaluate` — XSS / CDP injection?

**Pre-existing, not introduced. Equivalent to `selectorJsLiteral`.** `[inspected]`

```1529:1538:chrome-extension/src/background/browser-bridge.ts
    if (mode.kind === "selector") {
      ...
          const result = await this.sendCdp(tabId, "Runtime.evaluate", {
            // Safe interpolation: JSON.stringify produces a valid JS string literal.
            expression: `!!document.querySelector(${JSON.stringify(mode.selector)})`,
```

`selectorJsLiteral` **is** `JSON.stringify` (`selector-js-literal.ts:12-14`). Dedicated tests already cover quote / backslash / newline breakout (`chrome-extension/tests/selector-js-literal.test.ts`). `querySelector` receives a string; it does not `eval` the selector. Expression is existence-check only (`!!…`), not innerHTML write.

`resolveWaitForMode` only takes `typeof params.selector === "string"` after trim (`wait-for-mode.ts:27-28`) — no `toJSON` object gadget.

This path **bypasses** evaluate `security_token` (same as click/hover/type helpers). P1-3 is about post-approval rewrite of the `evaluate` tool, not CSS locators. **Not new in this PR.** TabId-only default never enters this branch.

Nit N2: `waitFor` should call `selectorJsLiteral(mode.selector)` for lock-step with `waitForSelector` (`browser-bridge.ts:1745`). Cosmetic.

---

### Q5 — Companion inject `network_idle:true` — hostile page / LLM stall DoS of the agent turn?

**Bounded stall, not unbounded DoS. Same class as pre-existing explicit `network_idle`. Not a confirm skip.** `[executed]` + `[inspected]`

#### What changed vs 1snvlv instant fail

| Path | Before | After |
|------|--------|-------|
| `wait_for({tabId})` | throw 4ms, non_recoverable ⚠️ | load wait + settle |
| Extension default | n/a | `timeoutMs=15_000`, `settleMs=2_000` (`wait-for-mode.ts:10-11,39-42`) |
| Companion compat | n/a | `normalizeWaitForParams` injects `network_idle:true` (`wait-for-params.ts:14-18`) so **old unpacked** extension takes the old `network_idle` branch (30s `waitForTabLoad` + settle) |
| `create_tab` | return immediately (empty url/title) | `waitForTabLoad` unless `wait_for_load === false` (`browser-bridge.ts:485-488`) |

Hostile **page** cannot set `settle_ms` / `timeout`. It can only delay `chrome.tabs` `status === "complete"`.

#### Hard cap on the agent turn `[executed]`

```javascript
TOOL_EXECUTION_TIMEOUT_MS === 15000
resolveToolDispatchTimeoutMs("wait_for", { timeout: 1e15, settle_ms: 1e15 }) === 15000
resolveToolDispatchTimeoutMs("create_tab", {}) === 15000
```

Companion WS timeout is **15s** for every non-download tool (`tool-forward.ts:20-31`). So:

- Default 15s load + 2s settle **cannot fully elapse** on the companion clock if load already ate 15s; companion returns `Tool execution timeout (15000ms): wait_for` (already **recoverable** via `"timeout"`).
- Recoverable loop guard: 3 same-tool failures then stop (`adapter.ts:161,1397-1410`). Hostile never-complete page ≈ **≤45s** then ⚠️, not infinite.
- Successful waits can repeat up to `MAX_TOOL_CALL_ROUNDS = 100` — **pre-existing** for `network_idle:true`. Models that already passed the flag could stall the same way. This PR makes the *catalog-legal* tabId-only call join that path (the 1snvlv trajectory).

`create_tab` wait is the same 30s `waitForTabLoad` already used by `navigate` (`browser-bridge.ts:500-514`). New for `create_tab` only.

#### Unbounded Zod vs extension orphan (nit N3) `[executed]`

```javascript
tryParseToolArgs("wait_for", { tabId: 1, timeout: 1e15, settle_ms: 1e15 })
// ok: true
tryParseToolArgs("wait_for", { tabId: 1, timeout: Infinity })
// ok: true  — but resolveWaitForMode positiveMs/nonNegativeMs reject !Number.isFinite → 15s / 2s fallback
parseToolArgs("create_tab", { url: "https://example.com", wait_for_load: false })
// { url }  — wait_for_load STRIPPED (LLM cannot skip the new wait)
```

`settle_ms` / `timeout` have **no Zod max**. If the LLM passes a huge finite `settle_ms`, the extension `setTimeout` can run long (browsers clamp ~2³¹−1 ms) **after** companion already timed out and deleted `pendingToolCalls`. That **orphans** a tab-queue holder for that `tabId` (`tab-queue.ts:17-38`). Pre-existing for explicit `network_idle` + `settle_ms`; now reachable on tabId-only + `settle_ms`. Hostile page cannot trigger it. Agent-turn clock still 15s.

#### `create_tab` 30s wait vs 15s companion (nit N4)

Slow load → companion timeout → recoverable → model may **retry `create_tab`** → extra tab. Same class as `navigate` today. URL gate still runs each time. Not privilege escalation; tab-spam / UX.

`waitForTabLoad` still resolves success on closed/missing tab (`browser-bridge.ts:534`) then settle → `{ success: true, mode: "network_idle" }`. Pre-existing for explicit `network_idle`; tabId-only now hits it. Next tool fails with no-tab (recoverable). False success, not a gate skip.

---

### Q6 — Capability declaration completeness for T2 L1?

**Pass.** `[inspected]`

| Check | Result |
|-------|--------|
| Surface L1 | Correct; no L2-class tools added |
| L2-classes none | Correct |
| Compose none | No skill/MCP/pack/user-env |
| Autonomy single | No worker/board change (`wait_for` already in `TAB_LEASE_TOOLS`) |
| Trust | Recoverability only; no new confirm dialect |
| Channel community | Correct |
| Pack-first | N/A |
| originWs | No new `request(` |
| No new runtime | Still single tool-loop |
| Experimental write path | N/A |

Outbound MCP `cmspark__wait_for` description still “Wait for selector/condition” (`outbound-mcp/stdio-server.ts:48`) and **does not** go through `normalizeWaitForParams` (adapter-only). New extension still defaults via `resolveWaitForMode`. Stale copy = nit N5, not a second Surface.

---

## Scores

| Axis | Score | Note |
|------|-------|------|
| **Outcome** | pass | 1snvlv `{tabId}` no longer ⚠️; leftover invalid is recoverable; `create_tab` waits; no new L2 |
| **Trajectory** | pass | Catalog-legal call now does the wait the flag already allowed; gate order URL → dispatch → wait unchanged |
| **Component** | pass with nits | `classifyError` / `wait-for-params` / `waitFor` / `createTab` checked; stall bounded by 15s WS + 3-fail loop |

---

## P1 watchlist (2026-07-29)

| ID | Topic | This PR |
|----|--------|---------|
| P1-1 | god-mode step-up | **not touched** |
| P1-2 | originWs | **not touched** (no new `request(`) |
| P1-3 | evaluate integrity | **not touched**; selector `Runtime.evaluate` pre-existing; default path has none |
| P1-4 | shell structure | **not touched** |

---

## Confirmed-safe (do not re-litigate)

- 1snvlv ⚠️ was **not** a security gate.
- No new confirm dialect / L2 / god-mode / originWs regression.
- Security and `permission denied` still beat the new recoverable needles `[executed]`.
- JSON.stringify selector interpolation is the existing safe helper, not a new CDP injection.
- Default wait is not infinite on the companion clock (15s).
- Zod does **not** re-require selector\|network_idle (would re-kill 1snvlv at schema) `[executed]`.
- Explicit `network_idle: false` without selector still invalid; companion does not overwrite false (`wait-for-params.ts:17`).
- Dead duplicate `return` after old `network_idle` success removed (listener/`done` flag is a leak fix, not a skip).

---

## Nits (non-blocking)

| ID | Sev | Item |
|----|-----|------|
| N1 | nit | `classifyError` needles are global substrings; `"network_idle is required"` redundant. Prefer tool-scoped or the coded prefix only (`wait_condition_required`). |
| N2 | nit | `waitFor` should use `selectorJsLiteral` for lock-step (same `JSON.stringify`). |
| N3 | nit | Zod `timeout` / `settle_ms` unbounded; extension can orphan `setTimeout` + tab-queue after companion 15s timeout. Cap (e.g. ≤15s / ≤5s) or clamp in `resolveWaitForMode`. Pre-existing for explicit `network_idle`. |
| N4 | nit | `create_tab` extension wait 30s vs companion 15s → recoverable timeout → possible duplicate tabs. Align with `navigate` or extend dispatch timeout like `browser_download`. |
| N5 | nit | Outbound MCP `cmspark__wait_for` description stale; inject lives only on adapter path. |

---

## DoD vs evidence

| # | Observable | Verdict |
|---|------------|---------|
| 1 | `wait_for({tabId})` does not throw 1snvlv string | **pass** `[executed]` resolver + inject |
| 2 | selector still wins | **pass** `[executed]` wait-for-mode test |
| 3 | Zod accepts tabId-only | **pass** `[executed]` |
| 4 | leftover missing-arg recoverable | **pass** `[executed]` classifyError |
| 5 | `create_tab` waits unless `wait_for_load === false` | **pass** `[inspected]`; LLM **cannot** pass false (Zod strips) `[executed]` — stronger than catalog |
| 6 | default wait bounded | **pass** companion 15s `[executed]`; extension 15s+2s / 30s |
| 7 | no new L2 / host_computer / confirm dialect | **pass** `[inspected]` |

---

VERDICT: APPROVE_WITH_NITS
