# OS Agent Shell P0 Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On macOS, with Chrome fully quit, a hashed Swift overlay can hydrate the current thread (≤20 plaintext lines), send `chat.create`, stream tokens, search thread titles, and when the model calls an L1 tool return typed `BROWSER_UNAVAILABLE` with zero auto-retry and zero `tool.execute` on the summoner socket.

**Architecture:** Companion remains the only tool-loop. Overlay window/hotkey travel the existing tray stdin pipe. Chat uses a **second** WS from `menu-bar-agent` with `Origin: cmspark-tray://local` and handshake `surface: "summoner"`. L1 dispatch is split: conversation origin ≠ actuator (`pickAuthenticatedClientWs`). Overlay never renders Allow/Deny.

**Tech Stack:** TypeScript (Node companion, `node:test`), Swift AppKit (same `Tray.swift` binary + SHA256 gate), existing WS protocol.

**UI lock (user 2026-08-22):** 两段式捕获结构 × Side Panel 看山白底 token（`docs/design/os-summoner-p0-chosen.html`）。历史为纯文本行，不用聊天气泡。空场只有一条 16px 圆角输入。禁止「主界面」。CTA 必须含「不能替你打开侧栏」。

**Upstream locks (do not re-open):**

- Brief v2.1: `docs/decisions/os-agent-shell-brief-2026-08-22.md` (S1–S24)
- Adversary synthesis + Claude/Pi/Kimi APPROVE_WITH_NITS
- HUD N2/N5/N6 unchanged; N1 one SHA256 binary
- GOAL.md one-liner **frozen** (S24)

**Capability declaration**

```text
Surface:      L0 capture overlay (macOS spike); L1 actuator = Chrome extension WS; L2 unchanged
L2-classes:   none new
Compose:      index only (thread.list); no Pack apply / allowTrust
Autonomy:     single
Trust:        SHA256 tray binary; overlay not a confirm writer; S19 non-retryable; S21 per-connection ACL
Channel:      community
```

---

## Spike exit criteria

| # | Criterion | Evidence |
|---|-----------|----------|
| E1 | Tray-origin / summoner-origin L1 never sends `tool.execute` to that socket | unit: fake WS records frames |
| E2 | No extension peer → `{ error_code: "BROWSER_UNAVAILABLE" }`; `classifyError` = `non_recoverable` even if copy contains “not connected” | `node --test` |
| E3 | Adapter does **not** retry that L1 tool (`recoverableFailureCounts` stays 0 / loop stops) | unit with stub executor |
| E4 | `surface=summoner` connection: `pack.apply`, `config.set`, `security.unattended.arm`, `security.confirmation.response`, `mcp.add` → typed deny; `chat.create` / `thread.list` / `system.ping` allowed | unit |
| E5 | Tray connection (no surface or `surface=tray`) still `skill.list` / `executeQuickAction` | existing tray tests + ACL test |
| E6 | `composer.lease` `{thread_id, holder, rev}` CAS; non-holder `chat.create` → `OVERLAY_STANDBY` | unit |
| E7 | Overlay paints, hydrates ≤20 plaintext lines, streams tokens; close ≠ abort | manual + protocol tests |
| E8 | Attach button calls `openChrome()` only (not lying `openSidePanel` copy); no LLM tool schema named `openChrome` | grep + manual |
| E9 | IME: composing Return does not submit (5/5 smoke) | manual checklist |
| E10 | `SWIFT_TRAY_SHA256` matches rebuilt binary; menu bar still works | `tray:rebuild` + hash |

**Explicit non-goals**

- Electron / Raycast plugin / plugin marketplace
- Overlay Allow/Deny, Pack install, dictation, message-body search
- Chrome five-state probes (`sw_dead` vs `absent`) — P0 is binary attached/detached
- Pixel hit-test self-ui (S23 full) — P0 only add tray basename; window-rect reject is P1
- GOAL.md / ADR-020 one-liner rewrite
- Windows/Linux overlay
- Auto-replay of the failed L1 tool_call

---

## File map

| File | Role |
|------|------|
| **Create** `companion/src/ws/l1-actuator.ts` | `resolveL1ActuatorWs`, `browserUnavailableResult`, codes |
| **Create** `companion/src/ws/summoner-acl.ts` | per-connection method allow/deny |
| **Create** `companion/src/ws/composer-lease.ts` | S20 map + CAS |
| **Create** `companion/src/summoner/protocol.ts` | stdin JSON types (window only) |
| **Create** `companion/src/summoner/hydrate.ts` | thread → ≤20 plaintext lines |
| **Create** `companion/tests/l1-actuator.test.ts` | E1–E3 |
| **Create** `companion/tests/summoner-acl.test.ts` | E4–E5 |
| **Create** `companion/tests/composer-lease.test.ts` | E6 |
| **Create** `companion/tests/summoner-hydrate.test.ts` | plaintext cap |
| **Create** `companion/tests/classify-error-browser-unavailable.test.ts` | E2 |
| Modify `companion/src/security.ts` | `classifyError` honors `error_code` |
| Modify `companion/src/llm/adapter.ts` | pass `error_code`; stop on `BROWSER_UNAVAILABLE` |
| Modify `companion/src/server.ts` | `createToolExecutor` uses actuator WS for forward |
| Modify `companion/src/ws/tool-forward.ts` | `originWs` vs `actuatorWs` (pending map stays actuator for result) |
| Modify `companion/src/ws/lifecycle.ts` | handshake `surface`; ACL before `handleMessage`; `WsAuthState.surface` |
| Modify `companion/src/ws/validate.ts` | `auth.handshake.surface`; lease + summoner messages |
| Modify `companion/src/message-router.ts` | lease gate on `chat.create`; hydrate helper RPC if needed |
| Modify `companion/src/tray/companion-client.ts` | optional `surface`; fire-and-forget `chat.create`; subscribe `chat.*` |
| Modify `companion/src/menu-bar-agent.ts` | second WS; stdin overlay cmds; attach RPC; **no** `openSidePanel` on attach |
| Modify `companion/src/tray/tray-adapter.ts` | overlay open/close/hydrate methods (no-op non-Swift) |
| Modify `companion/src/tray/swift-tray-bridge.ts` | stdin cmds + SHA256 after rebuild |
| Modify `companion/src/tray/Tray.swift` | `SummonerController` lazy window; hotkey; NSTextView; **zero** Allow buttons |
| Modify `companion/src/config.ts` | `summoner.hotkey?: string`; `companion_ui_exe_basenames` include tray binary name |
| Modify `chrome-extension/src/sidepanel/store/agentStore.tsx` (or InputArea) | `OVERLAY_STANDBY` → composer read-only + surface name |
| Modify `companion/src/computer/self-ui.ts` | add `cmspark-tray` basename (process-level; hit-test P1) |
| **Create** `docs/decisions/os-agent-shell-p0-spike-ship-note-2026-08-22.md` | after spike: go/no-go for P0 user test |

Do **not** add `openChrome` / `launch_browser` to tool catalogs.

---

## Protocol (P0)

### Handshake (summoner WS)

```ts
// existing + optional surface. Omit → "tray" (menu-bar primary connection).
{ type: "auth.handshake", proof: string, surface?: "tray" | "summoner" }
```

Origin stays `cmspark-tray://local`. ACL keys off `WsAuthState.surface`, not Origin.

### Summoner connection allowlist (S21)

**Allow:** `system.ping`, `system.pong`, `chat.create`, `chat.abort`, `thread.list`, `thread.select`, `thread.create`, `history.query`, `composer.lease.claim`, `composer.lease.release`, `composer.lease.get`.

**Deny (typed `SUMMONER_ACL`):** everything else, including `pack.apply`, `config.set`, `security.unattended.arm`, `security.confirmation.response`, `mcp.add`, `skill.list`, `executeQuickAction`.

Tray connection (`surface !== "summoner"`): unchanged.

### stdin Companion → Swift (`cmd`)

```ts
{ cmd: "summoner.open", thread_id: string }
{ cmd: "summoner.close" }
{ cmd: "summoner.hydrate", thread_id: string, lines: string[], browser: "attached" | "detached", search_hint: "P0 不搜正文" }
{ cmd: "summoner.token", text: string }
{ cmd: "summoner.done" }
{ cmd: "summoner.error", message: string, error_code?: string }
{ cmd: "summoner.hotkey.prompt" } // first-run picker
```

### stdout Swift → Companion (`type`)

```ts
{ type: "summoner.ready" }
{ type: "summoner.closed" }
{ type: "summoner.submit", thread_id: string, text: string }
{ type: "summoner.search", query: string }
{ type: "summoner.attach_chrome" } // UI gesture only
{ type: "summoner.continue" }      // new user message; never replay tools
{ type: "summoner.hotkey.chosen", combo: string }
{ type: "summoner.composing", on: boolean }
```

### Typed errors

```ts
export const BROWSER_UNAVAILABLE = "BROWSER_UNAVAILABLE"
export const OVERLAY_STANDBY = "OVERLAY_STANDBY"
export const L2_CONDUCTOR_ELSEWHERE = "L2_CONDUCTOR_ELSEWHERE"
export const SUMMONER_ACL = "SUMMONER_ACL"
```

`BROWSER_UNAVAILABLE` **error string must be exactly**  
`BROWSER_UNAVAILABLE: Chrome extension peer missing`  
(no `timeout` / `disconnected` / `not found` substrings).

`composer.lease` P0 fields: `{ thread_id: string, holder: "overlay" | "panel", rev: number }`.

---

### Task 1: `BROWSER_UNAVAILABLE` + `classifyError` code gate

**Files:**

- Create: `companion/src/ws/l1-actuator.ts` (result helper only in this task)
- Modify: `companion/src/security.ts` (`classifyError` signature)
- Modify: `companion/src/llm/adapter.ts` (pass `error_code`)
- Test: `companion/tests/classify-error-browser-unavailable.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { classifyError } from "../src/security"
import { browserUnavailableResult } from "../src/ws/l1-actuator"

test("BROWSER_UNAVAILABLE is non_recoverable even if copy mentions not connected", () => {
  const r = browserUnavailableResult()
  assert.equal(r.error_code, "BROWSER_UNAVAILABLE")
  assert.equal(r.success, false)
  assert.equal(/timeout|disconnected|not found/i.test(r.error), false)
  assert.equal(
    classifyError(r.error, { toolName: "navigate", error_code: r.error_code }),
    "non_recoverable",
  )
})

test("substring timeout without code stays recoverable", () => {
  assert.equal(classifyError("Tool execution timeout (15000ms)", { toolName: "click" }), "recoverable")
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd companion && npx tsc -p tsconfig.test.json --pretty false --noEmit false
node --test .test-dist/tests/classify-error-browser-unavailable.test.js
```

Expected: FAIL (`l1-actuator` missing and/or `error_code` unused).

- [ ] **Step 3: Minimal implementation**

`companion/src/ws/l1-actuator.ts`:

```ts
export const BROWSER_UNAVAILABLE = "BROWSER_UNAVAILABLE" as const

export function browserUnavailableResult(): {
  success: false
  error: string
  error_code: typeof BROWSER_UNAVAILABLE
} {
  return {
    success: false,
    error_code: BROWSER_UNAVAILABLE,
    error: "BROWSER_UNAVAILABLE: Chrome extension peer missing",
  }
}
```

In `classifyError`, **first** branch (before recoverable list):

```ts
export function classifyError(
  errorMessage: string,
  context?: { toolName?: string; domain?: string; error_code?: string },
): ErrorLevel {
  if (context?.error_code === "BROWSER_UNAVAILABLE") return "non_recoverable"
  // ... existing body
}
```

`adapter.ts` around the existing `classifyError(toolResult.error || "", { toolName })` call:

```ts
const errorLevel = classifyError(toolResult.error || "", {
  toolName,
  error_code: (toolResult as { error_code?: string }).error_code,
})
```

- [ ] **Step 4: Re-run test — PASS**

- [ ] **Step 5: Commit**

```bash
git add companion/src/ws/l1-actuator.ts companion/src/security.ts companion/src/llm/adapter.ts companion/tests/classify-error-browser-unavailable.test.ts
git commit -m "feat(summoner): classify BROWSER_UNAVAILABLE as non-retryable"
```

---

### Task 2: `resolveL1ActuatorWs` (origin ⊥ actuator)

**Files:**

- Modify: `companion/src/ws/l1-actuator.ts`
- Test: `companion/tests/l1-actuator.test.ts`
- Uses: `pickAuthenticatedClientWs`, `getWsAuthState` from `ws/lifecycle.ts`

- [ ] **Step 1: Failing tests**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { resolveL1ActuatorWs, BROWSER_UNAVAILABLE } from "../src/ws/l1-actuator"

function fakeWs() {
  const e = new EventEmitter() as any
  e.readyState = 1
  e.OPEN = 1
  e.send = () => {}
  return e
}

test("extension-origin loop keeps its own socket as actuator", () => {
  // test double: inject getAuth/pickExt via resolveL1ActuatorWs deps in module
})
```

Prefer a **deps object** so tests do not boot `startServer`:

```ts
export type L1ActuatorDeps = {
  getAuth: (ws: WebSocket) => { origin?: string; authenticated?: boolean } | undefined
  pickExtensionWs: () => WebSocket | null
}

export function resolveL1ActuatorWs(
  originatingWs: WebSocket,
  deps: L1ActuatorDeps,
): { ok: true; ws: WebSocket } | { ok: false; error_code: typeof BROWSER_UNAVAILABLE } {
  const origin = deps.getAuth(originatingWs)?.origin || ""
  if (/^chrome-extension:\/\//i.test(origin)) {
    return { ok: true, ws: originatingWs }
  }
  const ext = deps.pickExtensionWs()
  if (!ext) return { ok: false, error_code: BROWSER_UNAVAILABLE }
  return { ok: true, ws: ext }
}
```

Cases:

1. origin `chrome-extension://abc` → same object identity as `originatingWs`
2. origin `cmspark-tray://local`, `pickExtensionWs() === null` → `ok: false`
3. origin `cmspark-tray://local`, pick returns `ext` → `ws === ext` and `ws !== originatingWs`
4. origin missing, pick null → unavailable

- [ ] **Step 2: Run — FAIL** (function missing)

- [ ] **Step 3: Implement `resolveL1ActuatorWs` as above** (keep `browserUnavailableResult`)

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `feat(summoner): resolve L1 actuator independently of chat origin`

---

### Task 3: `createToolExecutor` forwards L1 only to actuator WS

**Files:**

- Modify: `companion/src/server.ts` (`createToolExecutor` terminal `forwardToolToExtension`)
- Modify: `companion/src/ws/tool-forward.ts` if `originWs` on pending must be **actuator** (result correlation). Comment already says originWs is the socket that received `tool.execute` — that must be the **extension** socket after this change.
- Test: extend `companion/tests/l1-actuator.test.ts` **or** a new `companion/tests/tool-forward-actuator.test.ts` that stubs `dispatchToExtension`/`ws.send`.

Do **not** change companion-tool / MCP branches in this task (they stay on originating `ws` for `originWs` confirm binding — S6).

- [ ] **Step 1: Failing test** — create two fake sockets (`trayWs`, `extWs`). `createToolExecutor(trayWs)` invoking a non-companion tool (e.g. `list_tabs`) must:

  - call send on `extWs` with `type: "tool.execute"`
  - never call send on `trayWs` with `tool.execute`
  - if `pickAuthenticatedClientWs` is null, return `browserUnavailableResult()` without sending

  Wire deps: the production path should be:

```ts
const resolved = resolveL1ActuatorWs(ws, {
  getAuth: (w) => getWsAuthState(w),
  pickExtensionWs: pickAuthenticatedClientWs,
})
if (!resolved.ok) {
  const result = browserUnavailableResult()
  logToolFinish(toolCallId, toolName, startedAt, result)
  return result
}
return forwardToolToExtension({
  toolCallId,
  toolName,
  finalParams,
  ws: resolved.ws, // actuator
  actingThreadId,
  startedAt,
  logToolFinish,
})
```

Insert this **immediately before** the existing `return forwardToolToExtension({...})` in `createToolExecutor` (`server.ts` ~756). Extension-origin loops are unchanged (resolved.ws === originating).

- [ ] **Step 2: FAIL** (still forwards to originating)

- [ ] **Step 3: Patch `server.ts` as above.** If tests cannot import `createToolExecutor` without full server, extract a 15-line `forwardL1OrUnavailable(...)` next to `resolveL1ActuatorWs` and unit-test that; `createToolExecutor` becomes a one-line call. Prefer extraction if `createToolExecutor` is hard to boot.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `fix(summoner): never tool.execute on tray/summoner sockets`

---

### Task 4: Summoner handshake `surface` + method ACL

**Files:**

- Create: `companion/src/ws/summoner-acl.ts`
- Modify: `companion/src/ws/lifecycle.ts` (`WsAuthState.surface`, handshake parse)
- Modify: `companion/src/ws/validate.ts` (`auth.handshake` optional `surface`)
- Modify: `companion/src/tray/companion-client.ts` (constructor `surface?: "tray" | "summoner"`; include in handshake JSON)
- Test: `companion/tests/summoner-acl.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { assertSummonerAllowed } from "../src/ws/summoner-acl"

test("summoner allows chat.create and ping", () => {
  assert.equal(assertSummonerAllowed("summoner", "chat.create").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "system.ping").ok, true)
})

test("summoner denies trust elevation", () => {
  for (const t of [
    "pack.apply",
    "config.set",
    "security.unattended.arm",
    "security.confirmation.response",
    "mcp.add",
    "skill.list",
    "executeQuickAction",
  ]) {
    const r = assertSummonerAllowed("summoner", t)
    assert.equal(r.ok, false)
    assert.equal(r.error_code, "SUMMONER_ACL")
  }
})

test("tray surface does not use summoner allowlist", () => {
  assert.equal(assertSummonerAllowed("tray", "skill.list").ok, true)
  assert.equal(assertSummonerAllowed(undefined, "skill.list").ok, true)
})
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement**

```ts
const SUMMONER_ALLOW = new Set([
  "system.ping",
  "chat.create",
  "chat.abort",
  "thread.list",
  "thread.select",
  "thread.create",
  "history.query",
  "composer.lease.claim",
  "composer.lease.release",
  "composer.lease.get",
])

export function assertSummonerAllowed(
  surface: string | undefined,
  type: string,
): { ok: true } | { ok: false; error_code: "SUMMONER_ACL"; error: string } {
  if (surface !== "summoner") return { ok: true }
  if (SUMMONER_ALLOW.has(type)) return { ok: true }
  return {
    ok: false,
    error_code: "SUMMONER_ACL",
    error: `SUMMONER_ACL: ${type} not allowed on summoner surface`,
  }
}
```

Handshake: in `lifecycle.ts` `auth.handshake` success path, after `st.authenticated = true`:

```ts
const rawSurface = (msg as any).surface
st.surface = rawSurface === "summoner" ? "summoner" : "tray"
```

`WsAuthState` add `surface?: "tray" | "summoner"`.

Before `handleMessage` for authenticated app messages:

```ts
const gate = assertSummonerAllowed(wsAuth.get(ws)?.surface, msg.type)
if (!gate.ok) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "error", error: gate.error, error_code: gate.error_code }))
  }
  return
}
```

`validate.ts` `auth.handshake`: if `surface` present, must be `"tray"` | `"summoner"`.

`CompanionClient`: add `surface?: "tray" | "summoner"` to options; handshake body `{ type, proof, protocol_version, surface: this.options.surface ?? "tray" }`.

- [ ] **Step 4: PASS** + run existing `companion/tests/ws-origin.test.ts` (still no new origin)

- [ ] **Step 5: Commit** `feat(summoner): per-connection ACL via handshake surface`

---

### Task 5: `composer.lease` (S20 three fields)

**Files:**

- Create: `companion/src/ws/composer-lease.ts`
- Modify: `companion/src/message-router.ts` (`chat.create` + three lease messages)
- Modify: `companion/src/ws/validate.ts`
- Test: `companion/tests/composer-lease.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { ComposerLeaseRegistry } from "../src/ws/composer-lease"

test("claim overlay bumps rev; stale rev fails", () => {
  const r = new ComposerLeaseRegistry()
  const a = r.claim({ thread_id: "t1", holder: "overlay", rev: 0 })
  assert.equal(a.ok, true)
  assert.equal(a.state.holder, "overlay")
  assert.equal(a.state.rev, 1)
  const stale = r.claim({ thread_id: "t1", holder: "panel", rev: 0 })
  assert.equal(stale.ok, false)
  const ok = r.claim({ thread_id: "t1", holder: "panel", rev: 1 })
  assert.equal(ok.state.holder, "panel")
})

test("absent lease defaults holder panel", () => {
  const r = new ComposerLeaseRegistry()
  assert.equal(r.get("missing").holder, "panel")
  assert.equal(r.get("missing").rev, 0)
})
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement registry + router**

Default holder `panel`. Overlay `summoner.open` path (Task 8) will `claim` overlay with current rev.

`chat.create` in `message-router.ts` after thread paused/trash gates:

```ts
const surface = services.wsSurface?.(rest) // or pass from lifecycle via rest.__surface
const lease = composerLeases.get(rest.thread_id)
const incoming: "overlay" | "panel" = surface === "summoner" ? "overlay" : "panel"
if (lease.holder !== incoming) {
  return {
    type: "chat.error",
    thread_id: rest.thread_id,
    error: "OVERLAY_STANDBY: composer is on the other surface",
    data: { error_code: "OVERLAY_STANDBY", holder: lease.holder },
  }
}
```

Cleanest wiring: `lifecycle` stamps `msg.__cmspark_surface = wsAuth.surface` **after** ACL (internal, strip before LLM). Do not accept `__cmspark_surface` from the client — overwrite always.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `feat(summoner): composer.lease CAS with overlay/panel holders`

---

### Task 6: Hydrate plaintext (≤20)

**Files:**

- Create: `companion/src/summoner/hydrate.ts`
- Test: `companion/tests/summoner-hydrate.test.ts`

- [ ] **Step 1: Failing test** — 25 messages → 20 lines; `tool` role → `[工具] ${name}`; empty content skipped; no mermaid/html.

```ts
export function hydratePlaintext(
  messages: Array<{ role: string; content?: string; tool_calls?: Array<{ function?: { name?: string } }> }>,
  cap = 20,
): string[] {
  const lines: string[] = []
  for (const m of messages) {
    if (m.role === "tool") {
      lines.push("[工具]")
      continue
    }
    const text = String(m.content || "").replace(/\s+/g, " ").trim()
    if (!text) continue
    const who = m.role === "user" ? "你" : m.role === "assistant" ? "助手" : m.role
    lines.push(`${who}: ${text.slice(0, 240)}`)
  }
  return lines.slice(-cap)
}
```

- [ ] **Step 2–4:** TDD then implement exactly as above.

- [ ] **Step 5: Commit** `feat(summoner): truncate thread hydrate to plaintext`

---

### Task 7: stdin protocol codecs

**Files:**

- Create: `companion/src/summoner/protocol.ts`
- Test: `companion/tests/summoner-protocol.test.ts` (encode/decode round-trip + reject Allow-shaped cmds)

No `summoner.confirm.*` commands exist. Test that a payload `{ cmd: "summoner.confirm.allow" }` is **invalid**.

- [ ] Commit `feat(summoner): stdin protocol without confirm dialect`

---

### Task 8: Second WS + streaming `chat.create` (Node, no Swift yet)

**Files:**

- Modify: `companion/src/tray/companion-client.ts`
- Modify: `companion/src/menu-bar-agent.ts`
- Test: extend companion-client tests if present; otherwise a small fake-server test.

Behavior:

1. Existing `CompanionClient` remains `surface: "tray"` (default).
2. `menu-bar-agent` constructs `summonerClient = new CompanionClient({ ..., surface: "summoner" })`.
3. Add `sendChatCreate({ thread_id, message })`: **does not** use `sendRequest` 5s RPC. Sends `{ type: "chat.create", thread_id, message }` and returns immediately.
4. `onAppMessage` already exists — forward `chat.token` / `chat.done` / `chat.error` to Swift via stdin `summoner.token|done|error`.
5. Title search: `thread.list` then filter `title`/`alias` with `query.includes`; empty query = last thread. Copy for empty: `P0 不搜正文`.

Continue button → `sendChatCreate` with message exactly:

`浏览器已连接。请等待我的下一条指令；不要重试刚才失败的网页操作。`

(no tool replay server-side; S19 already forbids auto-retry.)

Attach → `getChromeOpener().openChrome()` only. Notify text **must** include: `我们不能替你打开侧栏`.

- [ ] Commit `feat(summoner): tray-side streaming client with surface=summoner`

---

### Task 9: Swift overlay window (no Allow)

**Files:**

- Modify: `companion/src/tray/Tray.swift` — new `SummonerController` (mirror `HudController` structure, **delete** confirm Allow/Deny controls; use `NSTextView` not `NSTextField`)
- Modify: `companion/src/tray/swift-tray-bridge.ts` — send/recv cmds from Task 7
- Modify: `companion/src/tray/tray-adapter.ts` — `openSummoner?`, `hydrateSummoner?` no-op on systray2/readline
- Rebuild: `bash companion/src/tray/build-tray.sh` then paste SHA256 into `SWIFT_TRAY_SHA256`

Window:

- `NSPanel` `.nonactivatingPanel` + `.floating` (start)
- Title: `CMspark 召唤器（实验）` — never 「主界面」
- Badge: `浏览器已连接` | `浏览器未连接`
- Scrollback: plaintext lines
- Composer: `NSTextView`
- Buttons: 发送, 激活 Google Chrome (only when detached), 已连接，继续对话 (only when attached after a `BROWSER_UNAVAILABLE` in this overlay session)
- **Zero** Allow/Deny/确认
- Close → `summoner.closed` + lease release; does **not** send `chat.abort`

- [ ] Manual: overlay opens from a debug stdin `summoner.open` after rebuild.

- [ ] Commit `feat(summoner): macOS overlay window without confirm chrome`  
  (include hash update in same commit)

---

### Task 10: First-run hotkey picker (S11)

**Files:** Tray.swift + config.ts `summoner?: { hotkey?: string }`

- No default hotkey. Tray menu item `召唤器（实验）…` opens overlay without a hotkey.
- First overlay open with empty config → `summoner.hotkey.prompt` UI listing candidates that are **not** `Cmd+Space`, `⌥Space`, `Alt+Space`, `⌃⇧Space`.
- Persist chosen combo; register `RegisterEventHotKey`.
- Composing (`hasMarkedText`) → ignore hotkey and Return-to-send (`summoner.composing`).

- [ ] Commit `feat(summoner): opt-in hotkey picker, no stolen defaults`

---

### Task 11: Extension respects `OVERLAY_STANDBY`

**Files:** `chrome-extension/src/sidepanel/store/agentStore.tsx` and/or `InputArea.tsx`

On `chat.error` with `data.error_code === "OVERLAY_STANDBY"`: disable textarea, show `正在召唤器输入` (use `holder` if provided). Clear on next successful local send or `composer.lease` broadcast if you add `composer.lease.changed` fan-out (optional P0: overlay close claims panel by releasing; panel can type again without extra message).

**P0 minimum:** overlay close → `composer.lease.release` → holder `panel`. Panel does not need a push if user simply types; `chat.create` from panel succeeds after release.

Still add the disabled state for the dual-open case.

- [ ] Test: chrome-extension unit if store tests exist; otherwise a small reducer test.

- [ ] Commit `feat(summoner): Side Panel composer standby when overlay holds lease`

---

### Task 12: self-ui basename (S23 partial)

**Files:** `companion/src/config.ts` default `companion_ui_exe_basenames`; `companion/src/computer/self-ui.ts`

Add `cmspark-tray` (and current Swift executable basename if different). Test: `isCompanionUiOwner` true for that basename.

**Do not** implement window-rect hit-test in P0.

- [ ] Commit `fix(computer): treat Swift tray binary as companion UI`

---

### Task 13: Spike ship note + machine checklist

**Create:** `docs/decisions/os-agent-shell-p0-spike-ship-note-2026-08-22.md`

Fill after running:

```bash
cd companion && npm test -- --test-name-pattern "l1-actuator|summoner-acl|composer-lease|classify-error-browser-unavailable|summoner-hydrate|summoner-protocol"
rg -n "openChrome|launch_browser" companion/src/bridge companion/src/bridge/tool-definitions-catalog.json
# must not add a tool
```

Manual matrix (author): Chrome quit; overlay hydrate; ask non-web question; ask to open a URL → badge + honest CTA; continue does not fire L1 in `history.db`; IME composing Return.

Go/no-go for the 8+5 user falsification in brief §11. **Do not** edit GOAL.md.

- [ ] Commit `docs: OS agent shell P0 spike ship note`

---

## TDD / commit cadence

One commit per task above. Do not mix Swift hash with ACL unless Task 9. If `createToolExecutor` extraction in Task 3 grows, stop and keep the helper in `l1-actuator.ts`.

## Spec coverage (self-review)

| Brief P0 item | Task |
|---------------|------|
| S19 actuator ⊥ origin | 2–3 |
| classifyError explicit code | 1 |
| S21 surface ACL not Origin cleave | 4 |
| S20 three fields | 5 |
| hydrate ≤20 plaintext | 6 |
| no overlay Allow | 7, 9 |
| streaming chat.create | 8 |
| honest attach CTA | 8, 9 |
| continue = new user message | 8 |
| hotkey picker, not ⌃⇧Space | 10 |
| dual composer | 5, 11 |
| IME composing | 10 |
| SHA256 one binary | 9 |
| GOAL frozen | 13 |
| self-ui basename | 12 |
| no Pack/allowTrust from overlay | 4 |

## Placeholders

None. IME×CU process split remains **OPEN** (S10): P0 uses nonactivating panel + composing flag; if IME fails the 5/5 smoke, ship note = **no-go for CN users**, not a silent identity 2 launch.
