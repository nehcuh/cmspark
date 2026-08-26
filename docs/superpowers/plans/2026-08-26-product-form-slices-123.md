# Product-form slices 1–3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 租手钥匙 CLI, Confirm L8 (overlay-origin confirms live on 确认台/tray), and summoner honesty copy — without overlay Allow/Deny or overlay grant-issue.

**Architecture:** Reuse `issueOutboundGrant` from a new argv handler (no HTTP). Persist `allow_page_export` on the grant **file**. Shared `confirm-fanout.ts` binds overlay-origin confirms to the extension (or unbound) and fans out like outbound already does. Rewrite `rejectAll(ws)` so unbound confirms survive overlay close. First exfil still Confirm Center HITL in the **daemon**. Summoner MCP rail is hide-not-delete.

**Tech Stack:** Companion Node/TS, Swift HUD (source-regex tests), Side Panel React (settings checkbox only), markdown docs.

**Adversary:** [synthesis](../../audit/reviews/product-form-slices-123-adversary-synthesis-20260826.md) · SoT [deepening](../specs/2026-08-26-product-form-deepening-design.md)

```text
Surface:      Capture overlay unchanged ACL ; Confirm = 确认台/tray fan-out ; 租手 = CLI grant
L2-classes:   none new on overlay
Compose:      outbound grant persist flag ; no overlay CONFIGURE
Autonomy:     same tool-loop
Trust:        overlay never Allow/Deny ; grant ≠ ws_secret ; disclosure = grant flag ∧ operator HITL
Channel:      community ; outbound not default-on
```

**Blast:** PR-A/B = **T3**. PR-C = **T2**. 五分钟租手 **not green until PR-B Task 10** (first-exfil HITL). Dual-review: Claude 三路 AWN + Pi APPROVE `product-form-slices-123-*-20260826-150244` (nits folded).

**How tests run:** `cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/<file>.js`. Do not `node --test` the `.ts` sources. Full suite = `npm test` (`scripts/run-tests.mjs`).

**PR split (locked):**

| PR | Scope | 五分钟 DoD |
|----|--------|-----------|
| **A** | Grant CLI + `allow_page_export` on disk + mcp.md / bake-off / TROUBLESHOOTING | **Not green** (docs say 实验; exfil fail-closed without HITL) |
| **B** | Confirm L8 + first-exfil operator HITL | **Required** |
| **C** | 展开对话 / 打开浏览器 / hide MCP rail | Independent T2 |

**BLOCK (any of these = stop and fix):** overlay grant-issue or confirm.response; CLI `listen()` / POST `/disclosure` / `acceptOutboundDisclosure` in CLI; skip-confirm on Win/Linux; `chrome.sidePanel.open`; delete MCP source to pass tests; user-facing Handoff for outbound; snippets without `CMSPARK_OUTBOUND_GRANT`; HUD stdin grant-issue this slice.

---

## File map

| File | PR | Role |
|------|----|------|
| `companion/src/outbound-mcp/outbound-grants.ts` | A | `allow_page_export` on record |
| `companion/src/outbound-mcp/grant-cli.ts` | A | **Create.** argv handler, no server |
| `companion/src/index.ts` | A | `outbound-grant` case + printUsage |
| `companion/src/outbound-mcp/facade.ts` + `companion-http.ts` + `stdio-server.ts` | A then B | A: fail-closed without flag; B: HITL session |
| `chrome-extension/src/sidepanel/components/OutboundMcpSettingsSection.tsx` | A | checkbox + copy-once still backup |
| `companion/src/message-router.ts` | A | pass `allow_page_export` on WS issue |
| `docs/mcp.md` + bake-off + TROUBLESHOOTING + coding-handoff guide link | A | 5 分钟租手 recipe |
| `companion/src/mcp/confirm-fanout.ts` | B | **Create.** binding + fan-out |
| `companion/src/security-confirmation.ts` | B | `rejectAll(ws)` only matching origin |
| `companion/src/tool/l2-admission.ts` + `url-cookie-admission.ts` | B | use helper |
| `companion/src/ws/lifecycle.ts` | B | overlay close; `waitForExtensionPeer` |
| `companion/src/mcp/confirm-target.ts` + `dispatch.ts` | B | copy + same fan-out |
| `companion/src/summoner-web.ts` (~1130) + `summoner/client.ts` notices | B | 侧栏 → 确认台 fallback (rest of file is PR-C) |
| `companion/src/server.ts` | B | inject `getWsSurface` into L2/URL ctx |
| `companion/src/summoner-web.ts` (chevron/CTA/mic) + `SummonerOverlay.swift` + tests | C | honesty chrome |
| `companion/src/tray/swift-tray-bridge.ts` | C | SHA256 after Swift rebuild |

---

### Task 1: Persist `allow_page_export` on the grant record (PR-A)

**Files:**
- Modify: `companion/src/outbound-mcp/outbound-grants.ts`
- Test: `companion/tests/outbound-mcp-grants.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("issueOutboundGrant default allow_page_export is false and listed without token", () => {
  const issued = issueOutboundGrant({ label: "t", caller_id: "agent-a" })
  assert.match(issued.token, /^cmg_/)
  const listed = listOutboundGrants()
  assert.equal(listed[0].allow_page_export, false)
  assert.equal((listed[0] as { token?: string }).token, undefined)
})

test("issueOutboundGrant allow_page_export persists on disk and does not set disclosure Map", () => {
  clearAllOutboundDisclosureSessions() // BEFORE issue — if issue wrongly arms the Map, this test must catch it
  issueOutboundGrant({ label: "t", caller_id: "exfil-caller", allow_page_export: true })
  const rec = listOutboundGrants().find((g) => g.caller_id === "exfil-caller")
  assert.equal(rec?.allow_page_export, true)
  assert.equal(hasOutboundDisclosure("exfil-caller"), false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/outbound-mcp-grants.test.js`

Expected: FAIL — `allow_page_export` is not a field.

- [ ] **Step 3: Minimal implementation**

Add to `OutboundGrantRecord` and `IssueGrantOpts`:

```ts
allow_page_export?: boolean  // opts; default false
allow_page_export: boolean   // record
allow_page_export_at: string | null
```

`issueOutboundGrant`: `allow_page_export: !!opts.allow_page_export`, timestamp if true. `listOutboundGrants` returns the boolean, never `token` / `token_hash`. Audit `outbound_mcp.grant_issue` includes the flag, **never** the raw token. Export `grantAllowsPageExport(callerId: string): boolean` that reloads JSON and ignores revoked/expired.

Do **not** call `acceptOutboundDisclosure`.

- [ ] **Step 4: Run tests to verify they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add companion/src/outbound-mcp/outbound-grants.ts companion/tests/outbound-mcp-grants.test.ts
git commit -m "feat(outbound): persist allow_page_export on grant records"
```

---

### Task 2: Grant CLI module (PR-A)

**Files:**
- Create: `companion/src/outbound-mcp/grant-cli.ts`
- Create: `companion/tests/outbound-grant-cli.test.ts`
- Modify: `companion/src/index.ts` (`printUsage` ~30–56 and `switch` ~307)

- [ ] **Step 1: Write the failing tests**

```ts
test("printUsage lists outbound-grant", () => {
  const src = fs.readFileSync(new URL("../src/index.ts", import.meta.url), "utf8")
  // or import a captured usage string
  assert.match(src, /outbound-grant/)
})

test("handleOutboundGrantCli issue prints cmg_ once and env snippet", async () => {
  const { stdout, stderr, code } = await runGrantCli([
    "issue", "--caller-id", "codex", "--label", "Codex",
  ])
  assert.equal(code, 0)
  assert.match(stdout, /cmg_[0-9a-f]{64}/)
  assert.match(stdout, /CMSPARK_OUTBOUND_GRANT/)
  assert.match(stdout, /这把钥匙只出现一次。它不是扩展配对码。/)
  assert.doesNotMatch(stderr, /cmg_/)
  const listed = listOutboundGrants()
  assert.equal(listed.filter((g) => g.caller_id === "codex").length, 1)
})

test("handleOutboundGrantCli --allow-page-export sets grant flag not disclosure Map", async () => {
  await runGrantCli(["issue", "--caller-id", "c", "--allow-page-export"])
  assert.equal(grantAllowsPageExport("c"), true)
  assert.equal(hasOutboundDisclosure("c"), false)
})

test("unknown subcommand exits 1", async () => {
  const { code } = await runGrantCli(["explode"])
  assert.equal(code, 1)
})
```

CLI **MUST NOT** import `acceptOutboundDisclosure` (add a grep test on `grant-cli.ts`). Same grep **MUST** forbid `listen(`, `createServer(`, `fetch(` in that file.

- [ ] **Step 2: Run tests — expect FAIL** (module missing)

- [ ] **Step 3: Implement `grant-cli.ts` + wire `index.ts`**

```text
cmspark-agent outbound-grant issue --caller-id <id> [--label <name>] [--allow-page-export] [--ttl-ms N]
cmspark-agent outbound-grant revoke --grant-id <id>
cmspark-agent outbound-grant list
```

**MUST NOT:** `listen()`, `createServer`, `fetch`/`POST` to companion, `--profile`, `--require-grant`. Profile stays hard-wired `outbound_l1_default`.

`index.ts` `case "outbound-grant":` → `initDataDir()` then dynamic-import handler. `printUsage` one block next to `mcp-outbound`, user name **租手钥匙**, never Handoff.

Issue stdout: banner + token + env snippet (`CMSPARK_OUTBOUND_GRANT`, `CMSPARK_OUTBOUND_CALLER_ID`, `CMSPARK_OUTBOUND_PORT=23401`) + platform `command`/`args` (darwin DMG path **or** win `%LOCALAPPDATA%\CMspark\node.exe` + `cmspark-agent.js`). Consent lines from SoT §6 / Product chapter.

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit** `feat(cli): outbound-grant issue/revoke/list for 租手钥匙`

---

### Task 3: Exfil fail-closed without grant flag (PR-A)

**Files:**
- Modify: `companion/src/outbound-mcp/facade.ts`, `companion-http.ts` (POST `/disclosure` ~458, invoke ~284), `stdio-server.ts` META_ACCEPT
- Test: `companion/tests/outbound-mcp-facade.test.ts`, `outbound-mcp-http-e2e.test.ts` (today’s POST-ack happy path **must go red** — update to fail-closed)

- [ ] **Step 1: Failing tests**

```ts
test("exfil without allow_page_export is DISCLOSURE_NOT_GRANTED even if caller disclosure_accepted")
test("HTTP POST /disclosure with acknowledge does not arm exfil")
test("stdio accept_data_disclosure acknowledge is not sufficient")
test("grant allow_page_export still DISCLOSURE_HITL_REQUIRED without operator session")
```

- [ ] **Step 2: FAIL** (current code treats HTTP ack as SoT)

- [ ] **Step 3: Gate algebra**

```text
exfil tool
  → bad grant: GRANT_*
  → grant.allow_page_export !== true: DISCLOSURE_NOT_GRANTED (no confirm, no execute)
  → flag true, no operator HITL: DISCLOSURE_HITL_REQUIRED (PR-A; PR-B queues Confirm Center)
  → MCP acknowledge / POST /disclosure MUST NOT set the Map that the gate reads
```

`disclosure_accepted` on args stays ignored. **No** `/outbound-mcp/v1/grants` routes (keep 404).

After the rename, grep companion for leftover `DISCLOSURE_REQUIRED` on exfil paths — only `DISCLOSURE_NOT_GRANTED` / `DISCLOSURE_HITL_REQUIRED` (or keep the old code as an alias that still fail-closes, never as a success path).

- [ ] **Step 4: PASS** (e2e that previously ack’d then `get_page_text` now asserts fail-closed)

- [ ] **Step 5: Commit** `fix(outbound): caller disclosure ack is not operator consent`

---

### Task 4: Settings backup checkbox + docs (PR-A)

**Files:**
- Modify: `OutboundMcpSettingsSection.tsx` — checkbox `允许 <caller> 把页文/截图发给其云模型`; help: `推荐命令行签发（五分钟主路）。这里是备用与撤销。`; copy env **and** platform command/args
- Modify: `message-router.ts` `outbound_mcp.grants.issue` pass `allow_page_export`
- Modify: `docs/mcp.md` from Outbound heading through 现状 — follow External outline:
  - H2: `## 5 分钟租手（Outbound MCP · 实验）` keep `<a id="outbound-mcp"></a>`
  - Verbatim §8.1 disclaimer first
  - Two-door table + link `coding-handoff-user-guide.md`
  - Adoption paragraph (CMspark vs Playwright vs DevTools)
  - CLI as 拿钥匙 main path (only because Task 2 shipped in this PR)
  - Every json/toml/bash with `mcp-outbound` **must** contain `CMSPARK_OUTBOUND_GRANT`
  - Windows NSIS snippet
  - Claude `mcp add` with `--env` grant (fallback: same JSON)
  - Delete `acknowledge: true` as human consent
  - Win/Linux: **打开 Chrome 确认台**, never native tray confirm
- Modify: `docs/superpowers/plans/2026-08-04-outbound-mcp-p0d-bakeoff-checklist.md` health Bearer → `CMSPARK_OUTBOUND_GRANT`
- Modify: `docs/TROUBLESHOOTING.md` same
- Modify: `docs/coding-handoff-user-guide.md` one paragraph: Outbound = **租手**, this guide = **编程接力**
- Create: `companion/tests/outbound-mcp-docs-grant.test.ts` source-regex

```ts
test("docs/mcp.md outbound snippets all include CMSPARK_OUTBOUND_GRANT", () => {
  const md = fs.readFileSync("docs/mcp.md", "utf8")
  const outbound = md.slice(md.indexOf("outbound-mcp"))
  assert.match(outbound, /5 分钟租手/)
  assert.match(outbound, /尚未跑/)
  assert.match(outbound, /LOCALAPPDATA|Local\\\\CMspark|Local\\CMspark/)
  assert.doesNotMatch(outbound, /无缝对接|CMspark for Codex|Handoff/)
  assert.match(outbound, /打开 Chrome 确认台/)
  // every fenced block containing mcp-outbound must contain GRANT
})
```

Grep-forbid in this PR (user-facing): `无缝对接`, `CMspark for Codex`, `Bearer $SECRET` next to mcp-outbound, user-facing `Handoff` on outbound.

- [ ] Docs tests FAIL then PASS
- [ ] Commit `docs(mcp): 5-minute 租手 recipe with grant env and T1 disclaimer`

**Stop:** Do not claim 五分钟完成. Do not start overlay L8 in this PR. Dual-review PR-A as T3 before merging if shipping alone; otherwise stack B.

---

### Task 5: `confirm-fanout` helper (PR-B)

**Files:**
- Create: `companion/src/mcp/confirm-fanout.ts`
- Create: `companion/tests/confirm-fanout.test.ts`

- [ ] **Step 1: Failing tests**

```ts
test("summoner origin binds extension when present, else unbound")
test("summoner origin never returns overlay as originWs")
test("panel origin stays origin-bound")
test("outbound stays unbound")
test("trayOwnerWs is extension or null, never summoner")
```

Shape:

```ts
export function resolveConfirmBinding(args: {
  originatingWs: WebSocket
  originatingSurface?: string
  isOutboundMcpCall: boolean
  extensionWs: WebSocket | null
}): {
  originWs: WebSocket | undefined
  overlayNotice: boolean
  trayOwnerWs: WebSocket | null
}
```

Fan-out: `security.confirmation.request` to authenticated **non-summoner** peers (include `chrome-extension://` via `pickAuthenticatedClientWs`). Overlay: `mcp.confirm.pending` **only**. Filter `surface !== "summoner"` — **do not** use `surface === "tray"` (extension handshake surface is already `"tray"`).

**BLOCK:** Allow/Deny payload to overlay.

- [ ] Implement until PASS
- [ ] Commit `feat(confirm): fan-out helper never binds overlay origin`

---

### Task 6: `rejectAll(ws)` only matching origin (PR-B)

**Files:**
- Modify: `companion/src/security-confirmation.ts` (~508–544)
- Test: `companion/tests/security-confirmation-origin.test.ts`

Today: `originWs === undefined` dies on **any** peer close — overlay close kills outbound L8 too.

- [ ] **Failing tests**

```ts
test("rejectAll(disconnect, overlay) does not kill unbound")
test("rejectAll(disconnect, overlay) does not kill originWs=extension")
test("rejectAll(disconnect, extension) does kill originWs=extension")
```

- [ ] **Impl:** with `ws` argument, reject **only** `pending.originWs === ws`. No-arg `rejectAll()` still drains (shutdown). Timeout 45s remains the reaper. Update the comment that claimed unbound = broadcast-reject.

- [ ] Commit `fix(confirm): overlay disconnect must not kill unbound confirms`

---

### Task 7: L2 + URL admission use helper (PR-B)

**Files:**
- Modify: `companion/src/tool/l2-admission.ts` (~1146–1293)
- Modify: `companion/src/tool/url-cookie-admission.ts` (~248, ~328–357) — **same hole**
- Modify: `companion/src/server.ts` — pass `getWsSurface` into L2/URL ctx (MCP already has it at ~870)
- Test: `companion/tests/l2-summoner-confirm-origin.test.ts`

```ts
// if getWsSurface(ws)==="summoner" || isOutboundMcpCall
//   bind via resolveConfirmBinding
//   sendConfirm = fan-out exclude summoner
//   activeTrayConfirmsByWs.set(trayOwnerWs) — never overlay
// notifier: 「请在确认台或托盘里批准」 not Side Panel
```

`trayEligible` stays Swift-only. Do not mark systray2 eligible.

`L2AdmissionContext.wsAuthGet` must grow `surface`.

- [ ] Commit `fix(l2): overlay-origin confirms fan out like outbound`

---

### Task 8: Overlay close + wait for extension event (PR-B)

**Files:**
- Modify: `companion/src/ws/lifecycle.ts` (~317 grace, ~989 auth.ok, ~1398 close)
- Create: `waitForExtensionPeer({ timeoutMs })` subscribed on extension `auth.ok` (`chrome-extension://` + `pickAuthenticatedClientWs`)
- Test: `companion/tests/wait-for-extension-peer.test.ts`

```ts
test("waitForExtensionPeer resolves when subscribe fires, not via timer poll")
test("waitForExtensionPeer timeout rejects; never approved")
```

Source-regex: wait helper has **no** `setInterval` / `while (!pick()) await sleep()`. One `setTimeout` fail path is OK.

Win/Linux overlay/inbound confirm without extension:

1. `attachChromeOnly` (existing; never `openSidePanel`)
2. `await waitForExtensionPeer`
3. Timeout → explicit error, **never** `approved: true`

Overlay close: do not `cancelConfirm` tray ids owned by extension. Grace already skips unbound tool calls; confirm path must match after Task 6.

- [ ] Commit `fix(ws): wait for extension peer on event; overlay close keeps operator confirms`

---

### Task 9: Inbound MCP same fan-out + 确认台 copy (PR-B)

**Files:**
- Modify: `companion/src/mcp/confirm-target.ts`, `dispatch.ts`
- Modify: `companion/src/summoner-web.ts` ~1130 fallback
- Modify: `companion/src/summoner/client.ts` pack/MCP notices
- Test: `companion/tests/mcp-confirm-target.test.ts` — **this slice, not C**

Replace:

```ts
export const MCP_OVERLAY_CONFIRM_NOTICE =
  "MCP 工具需要在确认台批准。召唤器不能代替确认台点批准。"
export const MCP_OVERLAY_CONFIRM_UNAVAILABLE =
  "MCP 工具需要批准。请打开 Chrome 让确认台出现后批准；召唤器不能点允许或拒绝。"
```

Tests `assert.match(..., /确认台/)` and `assert.doesNotMatch(..., /侧栏/)`.

Dispatch uses `resolveConfirmBinding` + Swift tray race like L2. Overlay notice-only.

Also flip pack copy: `这个场景需要确认台批准` / `当前对话有信任快照，请在侧栏装配里换场景`. Keep `侧栏占用了输入`.

- [ ] Commit `fix(mcp): overlay MCP confirm retargets to 确认台 not 侧栏`

---

### Task 10: First-exfil operator HITL (PR-B) — 五分钟 DoD

**Files:**
- Modify: `companion-http.ts` `companionInvokeOutbound` exfil branch
- Test: extend `companion/tests/integration/outbound-mcp-executor.test.ts`

```ts
test("first screenshot with allow_page_export queues confirm and does not accept via HTTP ack")
test("after operator confirm, second exfil in session passes hasOutboundDisclosure")
test("overlay socket cannot resolve exfil confirm") // pin ACL at lifecycle.ts:1038 (summoner never reaches respondFrom). Do NOT bind outbound pending to the extension just to make this pass — tray must still win outbound.
```

On operator approve **in the daemon**: `acceptOutboundDisclosure(caller_id)`. Confirm Center approve **MUST NOT** write `allow_page_export=true` on the grant JSON (session ≠ 30d consent). Revoke grant → exfil fails even if Map still has caller.

Overlay: `assertSummonerAllowed("summoner", "security.confirmation.response").ok === false` stays.

- [ ] Commit `feat(outbound): first exfil requires 确认台 HITL`
- [ ] **五分钟租手 machine DoD now checkable** (CLI exists + L8 + HITL)

---

### Task 11: Summoner copy + attach CTAs (PR-C)

**Files:**
- Modify: `companion/src/summoner-web.ts` (~751–795, empty log, mic titles)
- Modify: `companion/src/tray/SummonerOverlay.swift` (~1349 CTA hidden, ~1362 展开工作台)
- Modify: `companion/src/summoner/client.ts` attach copy if needed
- Tests: `summoner-overlay.test.ts` (flip `展开工作台` → `展开对话`; invert `ctaBox isHidden = true` for detached)
- Tests: `summoner-web.test.ts` (stop matching `去侧栏处理`)
- `summoner-workbench-compose.test.ts` Allow/Deny regex: **narrow** to `允许|拒绝|Allow|Deny` as **actions**; **allow** `确认台` / `需要确认` / `打开确认台`

Strings (both shells, same sentence for title/aria/tooltip):

| State | Copy |
|-------|------|
| Chevron collapsed | `展开对话` |
| Chevron expanded | `收起对话` |
| L0 Chrome down | `可以继续聊。要操作网页，需要打开浏览器。` |
| CDP needed | `网页操作需要浏览器（扩展已配对的 Chrome）。` |
| 租手 Chrome down | `编程助手要看你的页面，但浏览器没在。` |
| Primary CTA | `打开浏览器` → `attachChromeOnly` silent |
| Secondary | `打开并前置浏览器` |
| Footnote | `我们不能替你打开侧栏。要盯着页面，请点工具栏的 CMspark。` |
| Mic | `听写在侧栏` (not `去侧栏处理`) |

Mac HUD: `ctaBox` **unhidden when detached**. HTML: **add** the two buttons (today none).

- [ ] Commit `fix(summoner): 展开对话 and 打开浏览器 honesty CTAs`

---

### Task 12: Hide MCP rail, freeze CONFIGURE chrome (PR-C)

**Files:** Swift HUD + `summoner-web.ts`

- Hide MCP **icon** (`isHidden` / `hidden`). Do **not** delete `summoner.mcp.toggle` / `summoner.mcp.add` / stdin handlers.
- Hide rows `＋ 添加 MCP` / `＋ 导入知识`.
- Expand default section = 对话.
- `summoner-workbench-compose.test.ts` **stays green** (source-regex still finds mcp.toggle/add).
- Optional new test: MCP button `isHidden` without deleting `summoner.mcp.add`.
- `mcp.toggle_server` / `skill.activate` remain on `SUMMONER_ALLOW`. No rollback this PR. Ticket `overlay-acl-rollback` unchanged.
- Rebuild Swift: `bash companion/src/tray/build-tray.sh` then update `SWIFT_TRAY_SHA256`.

- [ ] Commit `fix(summoner): hide MCP rail without deleting protocol`

---

## Manual UAT (after PR-B+C)

Companion tray green, extension once paired. Do **not** open Side Panel 设置 except revoke.

1. `cmspark-agent outbound-grant issue --caller-id codex --label Codex` (no export flag) → `cmg_` once.
2. Paste grant into Codex/Claude/Grok **with** `CMSPARK_OUTBOUND_GRANT`. New chat: list tabs.
3. Empty grant → `GRANT_REQUIRED`, not `ws_secret`.
4. Codex navigate off-whitelist → 确认台/Mac tray. Overlay: `需要确认才能继续。` + **打开确认台**, no 允许/拒绝. Close overlay, approve on 确认台 — still runs.
5. Win/Linux or Chrome quit: confirm without extension → **failure**, not pass.
6. `get_page_text` without flag → `DISCLOSURE_NOT_GRANTED`. With flag: first shot still 确认台. Caller ack alone insufficient.
7. Hotkey: chevron **展开对话**. Expand: no MCP icon. Chrome quit: **打开浏览器**, not only `BROWSER_UNAVAILABLE`.

Fail the 五分钟 milestone if 4–6 fail even if 1 is pretty.

---

## Self-review

- Spec §8 grant CLI → Tasks 1–4
- Spec §8.4 disclosure HITL → Tasks 3 + 10
- Spec §7 L8 overlay L2 + MCP + rejectAll + Win wait → Tasks 5–9
- Spec §6/§5 honesty + hide MCP → Tasks 11–12
- `url-cookie-admission` named (Impl nit)
- No overlay grant, no HUD stdin grant, no Handoff user name
- Placeholders: none. Tray grant window **explicitly deferred**
- Type names: `allow_page_export`, `resolveConfirmBinding`, `waitForExtensionPeer` used consistently
