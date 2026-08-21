# Adversary review (Product / UX / 1snvlv replay) — wait_for tabId-only default

**Batch**: `wait-for-1snvlv-20260822`  
**Role**: independent Product / UX skeptic (did **not** implement)  
**Lane**: 1snvlv replay — would the user still see ⚠️, and is the new default the right wait?  
**Diff**: `docs/audit/reviews/wait-for-1snvlv-diff-20260822.patch`  
**Worktree**: `/tmp/cmspark-wait-for` branch `fix/wait-for-default` vs `origin/main` (`bebb8c4`)  
**Blast (claimed)**: T2 L1. No new L2. `wait_for` / `create_tab` load-wait.

```text
Surface:      L1 (wait_for default network_idle; create_tab waits for load)
L2-classes:   none
Compose:      none
Autonomy:     single
Trust:        no new confirm dialect; classifyError recoverability only
Channel:      community
```

Do **not** treat “catalog now says tabId-only is network_idle” as proof the Zhihu write session completes. The incident was a **turn-killing ⚠️**, not “editor ready.”

---

## Machine (this worktree) `[executed]`

- companion `npm test`: **3107 pass / 0 fail** (23 skipped)
- chrome-extension `npm test`: **797 pass / 0 fail**, including 5 `wait-for-mode` tests
- Direct walk of `{ tabId: 1492094196 }` through Zod → `normalizeWaitForParams` → `resolveWaitForMode` → `classifyError` / `formatChatErrorLine` / `humanizeSidepanelGateError` (node, compiled `.test-dist`)

---

## 1. Findings

No blocker that re-creates the 1snvlv **first-shot ⚠️**. Residual product nits below; none should hold merge if Pi agrees they are not the incident.

### NIT N1 — `timeout` is a load cap, not Playwright `waitForTimeout` sleep

**Claim to falsify**: GLM `wait_for({tabId, timeout:5000})` means “sleep 5s”; the new default would wait load+2s instead.

**What the code actually does** `[executed]`

```
resolveWaitForMode({ tabId: 1, timeout: 5000 })
→ { kind: "network_idle", timeoutMs: 5000, settleMs: 2000 }
```

Then `waitFor` (`chrome-extension/src/background/browser-bridge.ts:1548-1550`) always:

1. `waitForTabLoad(tabId, timeoutMs)` — **cap**, resolves on `status==="complete"` **or** timeout (never throws)
2. **additional** `settleMs` (default 2000)

So `timeout:5000` is **not** 5s wall-clock. After `create_tab` has already seen `complete`, this is ~300ms poll + **2s settle** (~2.3s), **shorter** than 5s. If the document is still loading, it is `min(load, 5s) + 2s` (up to ~7s), then companion WS may cut at 15s (`TOOL_EXECUTION_TIMEOUT_MS`).

Unknown sleep aliases are stripped by the new Zod object `[executed]`:

```
parseToolArgs("wait_for", { tabId: 1492094196, ms: 5000, wait: 5000 })
→ { tabId: 1492094196 }   // ms/wait gone; default load+2s
```

**Product judgment**: this is the **correct** Playwright mapping (`locator.waitFor({timeout})` / `waitForLoadState(..., {timeout})` are caps; `page.waitForTimeout` is a *different*, discouraged API). Catalog now says tabId / tabId+timeout = 等待加载完成. Do **not** add a sleep mode to “match GLM.” Residual: a model that learned `timeout` = sleep will under-wait SPAs. Adapter rule 6 already points at `selector` for elements — keep it.

### NIT N2 — `create_tab` `complete` is not Zhihu-write ready; `wait_for({tabId})` still useful, but only as +2s settle

**Claim to falsify**: blocking `create_tab` on load hides SPA `complete` too early; `wait_for` after `create_tab` is obsolete.

Chrome `tabs.Tab.status === "complete"` is **document load**, not Playwright `networkidle`, not “editor mounted.” `zhuanlan.zhihu.com/write` is a JS shell + later editor. `[assumed]` the textarea/contenteditable is often still missing at `complete`.

After this diff:

| Step | Wait | What the model gets |
|------|------|---------------------|
| `create_tab` | `waitForTabLoad` default 30s (companion dispatch **15s**) | `id` + likely non-empty `url`/`title` |
| `wait_for({tabId})` (rule 6 still teaches this) | load already complete → ~300ms + **2s settle** | `{ mode: "network_idle", settle_ms: 2000 }` success |
| click/type editor | — | may still `ELEMENT_NOT_FOUND` (recoverable) |

So: **still need `wait_for` after `create_tab` for SPA**, but the **useful** form is `wait_for({tabId, selector})`, not tabId-only. Rule 6 documents that. TabId-only after the new `create_tab` is mostly a **2s courtesy settle**, not a second load wait. Extra latency, not a ⚠️.

`waitForTabLoad` also does not distinguish initial `about:blank` `complete` vs destination `complete` (`browser-bridge.ts:532-541`). `[assumed]` a fast blank-complete could still return a thin url; 1snvlv empty url is **mitigated**, not formally impossible. That does **not** restore the ⚠️: `wait_for({tabId})` no longer throws.

### NIT N3 — Catalog / adapter / runtime are aligned on the incident, slightly sloppy on XOR and names

Not a training contradiction that re-kills 1snvlv. Details in Q5.

### NIT N4 — `wait_for_load` opt-out is dead for the LLM (and that is OK)

See Q6. Not a defect for 1snvlv; dead runtime branch vs Zod strip is maintainer-facing only.

### NIT N5 — `humanizeSidepanelGateError` still prefixes ⚠️ on **any** `chat.error`

If a leftover `WAIT_CONDITION_REQUIRED` ever reaches `chat.error` (3× same-tool loop, or a future classify miss), the bubble is still `⚠️ …`. First-shot 1snvlv no longer takes that path. See Q4.

---

## 2. Attack questions

### Q1. Would the exact 1snvlv sequence still ⚠️?

**No.** `wait_for({tabId:1492094196})` does not throw `selector or network_idle is required`. It becomes load+settle success (or a later **recoverable** timeout, not first-shot `chat.error`).

Trace (prod 1snvlv): `create_tab(https://zhuanlan.zhihu.com/write)` → `{id, url:"", title:""}` → GLM `wait_for({tabId})` (24 tokens) → extension throw in 4ms → `classifyError` **non_recoverable** → Side Panel ⚠️ → user 「继续」 → same stop.

Walk with **exact** params `{tabId:1492094196}` after this diff:

**A. Companion Zod** — `companion/src/bridge/tool-schemas.ts:145-153`

TabId-only is valid. **Must not** refine `selector|network_idle` (that would re-kill at schema before execute). `[executed]`

```
tryParseToolArgs("wait_for", { tabId: 1492094196 })
→ { ok: true, args: { tabId: 1492094196 } }
```

**B. Companion inject (old unpacked extension compat)** — `companion/src/tool/wait-for-params.ts:10-18` applied at `companion/src/llm/adapter.ts:1155-1156`

```
normalizeWaitForParams("wait_for", { tabId: 1492094196 })
→ { tabId: 1492094196, network_idle: true }
```

Old extension’s `if (params.network_idle)` branch would run; it would **not** hit `throw new Error("selector or network_idle is required")`.

**C. Extension resolver** — `chrome-extension/src/background/wait-for-mode.ts:26-43`

No selector; `network_idle === false` is the only invalid shape. Injected `true` (or omitted on a new extension) → `kind: "network_idle"`, `timeoutMs=15000`, `settleMs=2000`. `[executed]`

**D. Runtime** — `chrome-extension/src/background/browser-bridge.ts:1520-1550`

`kind !== "invalid"` → skip `WAIT_CONDITION_REQUIRED` → `waitForTabLoad(1492094196, 15000)` → sleep 2000 → `{ success: true, data: { mode: "network_idle", settle_ms: 2000 } }`.

**E. `create_tab` half of the sequence** — `browser-bridge.ts:478-490`

New wait-for-load before return, then `chrome.tabs.get`. Empty `url`/`title` is no longer the **intended** return. (N2 race residual only.)

**F. ⚠️ gate** — only `security` / `non_recoverable` send `chat.error` (`adapter.ts:1381-1391`). This call succeeds; classify is not reached.

**Mixed deploy**

| Companion | Extension | 1snvlv `wait_for({tabId})` |
|-----------|-----------|----------------------------|
| new | new | network_idle success |
| new | old | inject `network_idle:true` → old idle path |
| old | new | resolver defaults tabId-only → idle |
| old | old | **original ⚠️** (not this PR) |

**Answer:** the exact ⚠️ sequence does **not** survive this diff.

### Q2. Is defaulting to `network_idle` right vs Playwright sleep?

**Yes, as product interpretation.** Sleep is the wrong default for a tool whose catalog `required` is only `tabId` and whose name is “wait for (a condition).”

- Playwright: `waitForTimeout(ms)` ≠ `waitForLoadState` ≠ `locator.waitFor({timeout})`. Timeout is a **deadline**.
- 1snvlv GLM omitted the condition after `create_tab` returned a hollow tab. Treating that as “wait until this tab has loaded” matches user intent (write on Zhihu), not “pause 15s.”
- Catalog (`tool-definitions-catalog.json:513-542`) now states 只传 tabId（或 tabId+timeout）视为等待加载完成, and `settle_ms` default 2000. Adapter rule 6 matches.

Residual (N1): `timeout:5000` after a completed `create_tab` is **2s settle**, not 5s sleep. Unknown `ms`/`wait` keys stripped. Do not add sleep to fix that; if a model needs wall-clock, `settle_ms` is the documented knob.

### Q3. Does blocking `create_tab` on load hide SPA complete too early?

**It can return before the Zhihu editor exists. That is not a reason to skip `wait_for`.** It **is** a reason that tabId-only wait is not sufficient for write.

`create_tab` now copies `navigate` (`browser-bridge.ts:485-488` vs `507-510`): wait `complete`, then `tabs.get` for url/title. For a SPA:

- Shell HTML `complete` → url/title populated → **1snvlv hollow tab fixed** (usual case).
- Editor hydrate is later → tabId-only `wait_for` only adds **2s settle**.
- Adapter still says “After create_tab/navigate, wait_for({tabId}) … Use wait_for({tabId, selector}) when waiting for a specific element” (`adapter.ts:477`).

**Still need `wait_for` after `create_tab` for Zhihu write**, preferably **selector**. Product: session continues (click/type miss is recoverable `element_not_found`, already in `classifyError`). User may still 「继续」 if the editor is slow — that is a **weaker** failure than ⚠️ `non_recoverable`.

Companion dispatch timeout is **15s** (`companion/src/ws/tool-forward.ts:20-31`) and is **not** raised for `create_tab` / `wait_for`. `waitForTabLoad`’s 30s default on `create_tab` is fiction: the WS layer wins. Slow Zhihu/login can `Tool execution timeout (15000ms): create_tab` — **recoverable** (`classifyError` already matches `"timeout"` at `security.ts:951`). First-shot ⚠️ still no; 3× same-tool loop still ⚠️ (pre-existing loop guard).

### Q4. User-visible ⚠️ path — `formatChatErrorLine` / `humanizeSidepanelGateError`

**If the leftover error is still thrown, first-shot is no longer ⚠️. If it ever becomes `chat.error`, the bubble is still scary.**

Incident path:

1. Extension throw / coded error
2. `classifyError` → **was** default `non_recoverable` (string not in list)
3. `adapter.ts:1381-1387` `chat.error` with `formatChatErrorLine("non_recoverable", …)` → `无法继续：selector or network_idle is required` (`user-gate-copy.ts:186-187`)
4. Side Panel `useWebSocket.ts:435-461` always `humanizeSidepanelGateError`
5. Fallback `[executed]`: **`⚠️ selector or network_idle is required`** (`gate-error-copy.ts:128-130` — any `chat.error` that is not 📁/🎭 gets ⚠️)

After this diff:

| Event | classify | `chat.error`? | User bubble |
|-------|----------|---------------|-------------|
| 1snvlv `wait_for({tabId})` | not reached (success) | no | no ⚠️ |
| Leftover `network_idle:false` without selector | **recoverable** (`security.ts:1041-1043`) `[executed]` | no (fed to LLM; `suggested_action: wait_for_network_idle`) | no ⚠️ |
| Same leftover ×3 | loop guard `adapter.ts:1397-1408` | **yes** | `[executed]` `⚠️ 工具 wait_for 连续 3 次执行失败…WAIT_CONDITION_REQUIRED…` |
| Hypothetical classify miss | `non_recoverable` | yes | `[executed]` `⚠️ selector or network_idle is required` |

`formatChatErrorLine("recoverable", leftover)` does **not** add `无法继续` / `不可恢复` (`user-gate-copy.ts:189` returns the raw human string). Recoverable leftovers never call it unless someone later wires `chat.error` for recoverable.

`humanizeSidepanelGateError` has **no** special case for wait_for. It does not need one if classify+default hold. Unconditional ⚠️ on `chat.error` is pre-existing and appropriate for real stops.

**Answer:** leftover is not first-shot scary. ⚠️ copy is unchanged **if** the stop path is taken. That is the right trade: stop-rare, retry-default.

### Q5. Catalog vs adapter rule 6 vs runtime — will it train the model wrong?

**Not on the 1snvlv shape.** Small wording nits (N3):

| Surface | Says | Runtime |
|---------|------|---------|
| Catalog description | 只传 tabId（或 tabId+timeout）视为等待加载完成（network_idle） | tabId-only → load + 2s settle |
| Catalog `selector` | 与 network_idle **二选一**；都不传则默认 network_idle | **Selector wins** if both set (`wait-for-mode.ts:28-33`, test “selector still wins”) — not XOR-invalid |
| Catalog `network_idle` | 不传 selector 时默认 true | omitted/`true` → idle; **`false` without selector is invalid** |
| Catalog `timeout` | 超时毫秒数，默认 15000 | load **cap** (idle) or poll budget (selector); **settle extra** |
| Adapter rule 6 | After create_tab/navigate, `wait_for({tabId})` waits for load; tabId-only = network_idle; selector for elements | create_tab **already** waited; tabId-only is mostly +2s |
| Flag name `network_idle` | implies Playwright networkidle | **document `complete` + settle**, no in-flight request accounting |

1snvlv training: tabId-only is valid and waits. **Correct.**  
SPA training: rule 6 still offers selector. **Correct, easy to ignore.**  
`二选一` might scare a model away from passing both; runtime would have accepted selector. Harmless.  
Rule 6 “after create_tab, wait_for({tabId})” is slightly redundant on load, useful on settle. **Do not delete it** — deleting it would train “create_tab return ⇒ interact now” and starve SPA hydrate.

### Q6. Missing `wait_for_load` in `create_tab` catalog — LLM cannot opt out. OK?

**Yes. Omitting the opt-out is the correct product choice for this incident.**

Evidence `[executed]`:

```
parseToolArgs("create_tab", { url: "https://zhuanlan.zhihu.com/write", wait_for_load: false })
→ { url: "https://zhuanlan.zhihu.com/write" }   // wait_for_load STRIPPED
```

- Catalog `create_tab` (`tool-definitions-catalog.json:17-35`): `url`, `active` only.
- Zod `create_tab` (`tool-schemas.ts:334-338`): `url`, `active`, `index` — **no** `wait_for_load`.
- Runtime (`browser-bridge.ts:485`): `params.wait_for_load !== false` — copy of `navigate`, **unreachable from LLM**.

If the catalog advertised `wait_for_load:false`, GLM would recreate hollow `{url:""}` and we are back at 1snvlv. Fire-and-forget prefetch tabs cannot skip the wait: accepted cost (up to companion **15s**). Same undocumented pattern already exists on `navigate`.

Nit for maintainers: either delete the dead `wait_for_load` branch or add it to Zod+catalog as an **internal/test-only** flag. Do not teach it to the model.

### Q7. Trajectory — drive-by unrelated files?

**No.** `git diff --name-only origin/main` is 13 files, all on-claim:

- extension: `browser-bridge.ts`, new `wait-for-mode.ts` + test
- companion: catalog, Zod, adapter rule 6 + normalize call, `classifyError`, new `wait-for-params.ts`
- tests: `bridge.test.ts`, `security-thread.test.ts`, `tool-schemas.test.ts`, `wait-for-params.test.ts`, `web-act-loop-wave1.test.ts`

No HUD / CU / MCP / confirm-dialect / host_computer. Dead duplicate `return` after network_idle success removed (claimed). `waitForTabLoad` `done` flag so the listener is not leaked on double-resolve — on-claim, not drive-by.

---

## 3. DoD scorecard (external observables)

| # | Observable | Result | Evidence |
|---|------------|--------|----------|
| 1 | `wait_for({tabId})` does not throw the 1snvlv string; defaults to load+settle | **PASS** | `[executed]` mode `network_idle` 15s/2s; runtime skips throw |
| 2 | `wait_for({tabId, selector})` still polls selector (selector wins) | **PASS** | `[executed]` unit test; `[inspected]` `waitFor` selector branch |
| 3 | Zod accepts tabId-only | **PASS** | `[executed]` `tryParseToolArgs` ok |
| 4 | Missing-arg leftover is recoverable (not first-shot ⚠️) | **PASS** | `[executed]` classify recoverable; `[inspected]` `chat.error` only security/non_recoverable/3× loop |
| 5 | `create_tab` waits for complete before returning url/title (unless `wait_for_load` false) | **PASS*** | `[inspected]` wait+`tabs.get`; *LLM cannot pass false (N4) — desired |
| 6 | Default wait is bounded (not infinite) | **PASS** | 15s wait_for / 30s `waitForTabLoad` / **15s WS** is the real cap |
| 7 | No new L2 / host_computer / confirm dialect | **PASS** | `[inspected]` diff; Trust = classifyError only |

---

## 4. Outcome / trajectory / component

**Outcome (1snvlv user):** the turn-killing ⚠️ is gone. Hollow `create_tab` is usually gone. Zhihu **editor** may still need a selector wait; that failure is recoverable, not `无法继续`.

**Trajectory:** small, named, test-locked change. Dual-layer default (companion inject + extension resolver) is the right unpack-extension story. No thrash.

**Component hotspots**

- `chrome-extension/src/background/wait-for-mode.ts:26-43` — default + only-invalid-false
- `chrome-extension/src/background/browser-bridge.ts:478-490` — `create_tab` wait
- `chrome-extension/src/background/browser-bridge.ts:517-550` — `waitForTabLoad` timeout/`done`
- `chrome-extension/src/background/browser-bridge.ts:1520-1550` — `waitFor` dispatch
- `companion/src/tool/wait-for-params.ts:10-18` — old-extension inject
- `companion/src/bridge/tool-schemas.ts:143-153` — **do not refine** selector\|network_idle
- `companion/src/security.ts:1041-1043` — leftover recoverable
- `companion/src/llm/adapter.ts:477` — rule 6
- `companion/src/llm/adapter.ts:1381-1408` — ⚠️ vs retry
- `chrome-extension/src/sidepanel/utils/gate-error-copy.ts:128-130` — ⚠️ prefix on `chat.error`
- `companion/src/ws/tool-forward.ts:20-31` — 15s dispatch vs 30s load wait (pre-existing, now more visible)

**Capability (ADR-020):** L1 wait semantics only. No new confirm family, no pack chrome, no CU. Blast matches.

---

## 5. Residual risks (owned, not merge-blocking)

1. SPA editor not ready after `complete` + 2s settle (N2) — model should use selector; rule 6 says so.
2. `timeout` ≠ sleep (N1) — documented; no sleep alias.
3. Companion 15s vs `waitForTabLoad` 30s / idle 15s+2s settle — pre-existing `navigate` footgun, now on `create_tab`. Recoverable timeout, 3× → ⚠️.
4. `waitForTabLoad` success-on-timeout (never errors) — model may think the page loaded when it did not.
5. Blank-document `complete` race — hollow url theoretically still possible; ⚠️ not restored.

---

VERDICT: APPROVE_WITH_NITS
