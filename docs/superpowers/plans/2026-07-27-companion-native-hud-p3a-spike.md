# Companion Native HUD — P3a Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove on macOS that one Companion-spawned Swift binary can open a native HUD window, hydrate from Companion over the existing stdin JSON pipe, complete one confirm round-trip and one abort, and accept a `shell.standby` stub — without dual-track screenshots or production shell-selector UX.

**Architecture:** Extend the existing tray process (`Tray.swift` → `dist/cmspark-tray`) with a lazy `NSWindow` HUD. Node continues to own state (`SecurityConfirmationManager`, computer tasks). Spike adds: (1) protocol messages on the tray stdin/stdout pipe, (2) thin TS bridge methods on `SwiftTrayAdapter`, (3) a minimal `HudShellRouter` stub for `activeShell` + standby fan-out, (4) unit tests for protocol + single-writer broadcast hooks. Extension Cockpit and Side Panel stay fully functional; spike does **not** flip default shell to native for end users.

**Tech Stack:** Swift (AppKit / NSStatusBar + NSWindow), TypeScript (Node companion), existing `SecurityConfirmationManager`, Vitest/node:test as used by companion.

**Upstream locks (do not re-open):**
- N1–N10: `docs/decisions/v1.3/companion-native-hud-n1n10-lock-2026-07-27.md`
- Product brief: `docs/decisions/v1.3/companion-native-hud-brief-2026-07-27.md` (Option A / P3a)
- Three-mode D8 / D10′ / D11′ / D12′ / D14 / D16

**Spike exit criteria (all must pass before any dual-track screenshot work):**

| # | Criterion | Evidence |
|---|-----------|----------|
| S1 | One binary still hash-gated; tray menu works | integrity test + manual menu |
| S2 | `hud.open` paints a titled window &lt; 1.5s warm | manual stopwatch |
| S3 | `hud.hydrate` fills thread id + pending confirm count | UI labels + log |
| S4 | One elevated confirm: Allow/Deny → `respond` wins; late UI no-op | unit + manual |
| S5 | `security.confirmation.resolved` reaches HUD (broadcast NEW path stub) | unit + manual cancel |
| S6 | Abort button sends abort event; task not killed by window close | manual |
| S7 | `shell.standby` hides elevated confirm UI, shows standby status line | unit + manual |
| S8 | Dual-review of this plan = APPROVE or APPROVE_WITH_NITS | review artifacts |

**Explicit non-goals (P3a spike):**

- Dual-track screenshots / step flood over stdin  
- Full ConfirmElevated parity (nonce, whitelist, preview image)  
- Production `hud.shell` settings UI or N3 cold-start orchestration for all entry points  
- Retiring tray L2 quick-confirm  
- Linux/Windows native window  
- L1 native expand  
- Renaming binary product path (may rename SHA256 constant only)

---

## File map

| File | Role in spike |
|------|----------------|
| `companion/src/tray/Tray.swift` | Add `HudController` (lazy NSWindow); handle new cmds; emit HUD events |
| `companion/src/tray/swift-tray-bridge.ts` | Send/receive HUD cmds; pending HUD confirm promise; heartbeat/ping stubs |
| `companion/src/tray/tray-adapter.ts` | Optional interface methods on `UnifiedTray` (no-op on non-Swift) |
| `companion/src/hud/protocol.ts` | **Create** — shared TS types + validators for HUD pipe messages |
| `companion/src/hud/shell-router.ts` | **Create** — per-thread `activeShell`, standby emit, health thresholds (N3 numbers) |
| `companion/src/security-confirmation.ts` | Optional hook: `onResolved` callback / `broadcastResolved` helper (N5 NEW) |
| `companion/src/server.ts` | **Owns** `SecurityConfirmationManager` + `setOnTerminal` + spike confirm race (see dual-review amendment) |
| `companion/src/menu-bar-agent.ts` | Optional: env-gated tray menu that **signals** server / tray bridge; does **not** own a second manager |
| `companion/tests/hud-protocol.test.ts` | **Create** — protocol encode/decode + router unit tests |
| `companion/tests/hud-shell-router.test.ts` | **Create** — activeShell, standby, health |
| `companion/tests/security-confirmation-broadcast.test.ts` | **Create or extend** — resolve fans out |
| `docs/decisions/v1.3/companion-native-hud-p3a-spike-ship-note-2026-07-27.md` | **Create after spike** — results + go/no-go for dual-track |

Do **not** modify Chrome extension cockpit IA in the spike except if needed for a one-line standby consumer stub (prefer pure companion tests first).

---

## Protocol (spike v0 — line-delimited JSON on tray stdin/stdout)

### Companion → Swift (`cmd` field)

```ts
// companion/src/hud/protocol.ts — canonical shapes

/** Open (or focus) the HUD window. Lazy-create on first call (N1). */
type HudOpenCmd = {
  cmd: "hud.open"
  thread_id: string
  reason?: "spike" | "escalate" | "tray" | "debug"
}

/** Full hydrate snapshot (spike: minimal fields only). */
type HudHydrateCmd = {
  cmd: "hud.hydrate"
  thread_id: string
  shell: "hud" | "cockpit" | "standby"
  connection: "connected" | "disconnected" | "unknown"
  capability_level?: "browser" | "computer" | string
  pending_confirmations: Array<{
    confirmation_id: string
    tool_name: string
    risk_level?: string
    summary: string
    timeout_ms: number
  }>
  task?: {
    task_id: string
    goal?: string
    status: "idle" | "running" | "done" | "aborted" | string
  } | null
  /** Dual-track intentionally empty in spike */
  dual_track?: { conclusions: never[]; steps: never[] }
}

type HudConfirmRequestCmd = {
  cmd: "hud.confirm.request"
  id: string
  tool_name: string
  risk_level: string
  summary: string
  timeout_ms: number
}

type HudConfirmCancelCmd = {
  cmd: "hud.confirm.cancel"
  id: string
}

/** N5 NEW — resolved/expired fan-out so HUD clears UI */
type HudConfirmResolvedCmd = {
  cmd: "hud.confirm.resolved"
  id: string
  outcome: "approved" | "denied" | "timeout" | "disconnect" | "unknown"
}

/** N2 — hide elevated confirm + dual-track; show standby line */
type ShellStandbyCmd = {
  cmd: "shell.standby"
  thread_id: string
  active_shell: "hud" | "cockpit"
  message: string // e.g. "任务进行中 — 在 确认台 查看"
}

type HudPingCmd = { cmd: "hud.ping"; nonce: string }

type HudCloseCmd = { cmd: "hud.close" } // hide window; process stays (N4)

// Existing tray cmds unchanged: update, show-confirm, cancel-confirm, show-pairing-window, quit
```

### Swift → Companion (`type` field)

```ts
type HudReadyEvt = { type: "hud.ready" }
type HudClosedEvt = { type: "hud.closed"; reason: "user" | "cmd" | "crash" }
type HudHeartbeatEvt = { type: "hud.heartbeat"; ts: number }
type HudPongEvt = { type: "hud.pong"; nonce: string }
type HudConfirmResponseEvt = {
  type: "hud.confirm.response"
  id: string
  approved: boolean
}
type HudAbortEvt = {
  type: "hud.abort"
  thread_id?: string
  task_id?: string
}
// Keep existing: click, confirm-response (tray dialog), exit, ready
```

**Wire rule (N5):** late confirm responses must still hit `SecurityConfirmationManager.respond` / tray path and receive outcome **`unknown`** on the manager API — **do not invent `already_resolved`**. Spike HUD UI treats unknown as no-op.

**Numeric locks (N3):** heartbeat stale if last `hud.heartbeat` &gt; **3s**; on-demand `hud.ping` → `hud.pong` within **400ms**. Spike implements the messages + router checks; full N3 open path can stay behind a debug flag.

---

### Task 0: Dual-review this plan (gate) — **DONE 2026-07-27**

**Files:** review artifacts under `docs/audit/reviews/`

- [x] **Step 1: Run dual external review** via `scripts/dual-external-review.sh native-hud-p3a-spike-plan …`  
  Prompt: `docs/audit/reviews/native-hud-p3a-spike-plan-prompt-2026-07-27.md`  
  Claude: `…-claude-20260727-181620.md` · Pi: `…-pi-20260727-181620.md` · Verdict: `…-verdict-20260727-181620.json`
- [x] **Step 2: REJECT?** No — both `APPROVE_WITH_NITS`.
- [x] **Step 3: Fold nits** — see **Dual-review amendments** at bottom of this plan.

**Stop condition:** `both_approve === true` ✓  
**Next:** Task 1 (protocol module + unit tests).

---

### Task 1: Protocol module + unit tests (TDD) — **DONE 2026-07-27**

**Files:**
- Create: `companion/src/hud/protocol.ts`
- Create: `companion/tests/hud-protocol.test.ts`

- [x] **Step 1: Write failing tests**

```ts
// companion/tests/hud-protocol.test.ts
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  parseSwiftLine,
  encodeHudOpen,
  encodeHudHydrate,
  encodeShellStandby,
  isHudConfirmResponse,
} from "../src/hud/protocol"

describe("hud protocol", () => {
  it("encodes hud.open as one JSON line object with cmd", () => {
    const o = encodeHudOpen({ thread_id: "t1", reason: "spike" })
    assert.equal(o.cmd, "hud.open")
    assert.equal(o.thread_id, "t1")
  })

  it("encodes shell.standby with required message", () => {
    const o = encodeShellStandby({
      thread_id: "t1",
      active_shell: "cockpit",
      message: "任务进行中 — 在 确认台 查看",
    })
    assert.equal(o.cmd, "shell.standby")
    assert.ok(o.message.includes("确认台"))
  })

  it("parses hud.confirm.response from Swift", () => {
    const line = JSON.stringify({ type: "hud.confirm.response", id: "c1", approved: true })
    const ev = parseSwiftLine(line)
    assert.ok(isHudConfirmResponse(ev))
    assert.equal(ev.id, "c1")
    assert.equal(ev.approved, true)
  })

  it("rejects unknown cmd shapes without throwing", () => {
    const ev = parseSwiftLine("{not json")
    assert.equal(ev, null)
  })
})
```

- [x] **Step 2: Run tests — expect FAIL**

```bash
cd companion && npm test -- --test-name-pattern="hud protocol"
```

Expected: module not found / FAIL.

- [x] **Step 3: Implement minimal `protocol.ts`**

```ts
// companion/src/hud/protocol.ts
export type HudOpenPayload = { thread_id: string; reason?: "spike" | "escalate" | "tray" | "debug" }
export type ShellStandbyPayload = {
  thread_id: string
  active_shell: "hud" | "cockpit"
  message: string
}
// ... hydrate types as in Protocol section above

export function encodeHudOpen(p: HudOpenPayload) {
  return { cmd: "hud.open" as const, ...p }
}
export function encodeShellStandby(p: ShellStandbyPayload) {
  return { cmd: "shell.standby" as const, ...p }
}
/** Prefer a typed hydrate payload (see Protocol section); avoid `Record<string, unknown>` holes. */
export type HudHydratePayload = {
  thread_id: string
  shell: "hud" | "cockpit" | "standby"
  connection: "connected" | "disconnected" | "unknown"
  capability_level?: string
  pending_confirmations: Array<{
    confirmation_id: string
    tool_name: string
    risk_level?: string
    summary: string
    timeout_ms: number
  }>
  task?: {
    task_id: string
    goal?: string
    status: string
  } | null
  dual_track?: { conclusions: never[]; steps: never[] }
}

export function encodeHudHydrate(p: HudHydratePayload) {
  return { cmd: "hud.hydrate" as const, ...p }
}

export function parseSwiftLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown
  } catch {
    return null
  }
}

export function isHudConfirmResponse(ev: unknown): ev is { type: "hud.confirm.response"; id: string; approved: boolean } {
  if (!ev || typeof ev !== "object") return false
  const o = ev as Record<string, unknown>
  return o.type === "hud.confirm.response"
    && typeof o.id === "string"
    && typeof o.approved === "boolean"
}

export function isHudReady(ev: unknown): ev is { type: "hud.ready" } {
  return !!ev && typeof ev === "object" && (ev as { type?: string }).type === "hud.ready"
}

export function isHudHeartbeat(ev: unknown): ev is { type: "hud.heartbeat"; ts: number } {
  if (!ev || typeof ev !== "object") return false
  const o = ev as Record<string, unknown>
  return o.type === "hud.heartbeat" && typeof o.ts === "number"
}

export function isHudPong(ev: unknown): ev is { type: "hud.pong"; nonce: string } {
  if (!ev || typeof ev !== "object") return false
  const o = ev as Record<string, unknown>
  return o.type === "hud.pong" && typeof o.nonce === "string"
}

export function isHudAbort(ev: unknown): ev is { type: "hud.abort"; thread_id?: string; task_id?: string } {
  return !!ev && typeof ev === "object" && (ev as { type?: string }).type === "hud.abort"
}

export function isHudClosed(ev: unknown): ev is { type: "hud.closed"; reason: string } {
  if (!ev || typeof ev !== "object") return false
  const o = ev as Record<string, unknown>
  return o.type === "hud.closed" && typeof o.reason === "string"
}
```

- [x] **Step 4: Run tests — expect PASS** — 6/6 (`node --test .test-dist/tests/hud-protocol.test.js`)

```bash
cd companion && npm test -- --test-name-pattern="hud protocol"
```

- [x] **Step 5: Commit** — `5a4d654 feat(hud): P3a spike protocol types and parsers`

```bash
git add companion/src/hud/protocol.ts companion/tests/hud-protocol.test.ts
git commit -m "feat(hud): P3a spike protocol types and parsers"
```

---

### Task 2: Shell router stub (N2/N3 numbers) + tests — **DONE 2026-07-27**

**Files:**
- Create: `companion/src/hud/shell-router.ts`
- Create: `companion/tests/hud-shell-router.test.ts`

- [x] **Step 1: Write failing tests**

```ts
// companion/tests/hud-shell-router.test.ts
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { HudShellRouter } from "../src/hud/shell-router"

describe("HudShellRouter", () => {
  it("sets active shell and emits standby to previous wide shell", () => {
    const sent: any[] = []
    const r = new HudShellRouter({
      sendToHud: (m) => sent.push({ to: "hud", m }),
      sendToCockpit: (m) => sent.push({ to: "cockpit", m }),
    })
    r.setActiveShell("t1", "cockpit")
    r.setActiveShell("t1", "hud")
    const standby = sent.find((x) => x.m?.cmd === "shell.standby")
    assert.ok(standby)
    assert.equal(standby.to, "cockpit")
    assert.equal(standby.m.active_shell, "hud")
  })

  it("isHealthy requires heartbeat within 3s and optional pong within 400ms", () => {
    const r = new HudShellRouter({ sendToHud: () => {}, sendToCockpit: () => {} })
    const now = Date.now()
    r.noteHeartbeat(now)
    assert.equal(r.isHealthy(now + 2999), true)
    assert.equal(r.isHealthy(now + 3001), false)
  })

  it("records pong latency under 400ms as healthy ping", async () => {
    const r = new HudShellRouter({ sendToHud: () => {}, sendToCockpit: () => {} })
    const nonce = r.beginPing(Date.now())
    r.notePong(nonce, Date.now() + 100)
    assert.equal(r.lastPingOk(), true)
  })
})
```

- [x] **Step 2: Implement `HudShellRouter`**

```ts
// companion/src/hud/shell-router.ts
export const HUD_HEARTBEAT_STALE_MS = 3000
export const HUD_PING_TIMEOUT_MS = 400

export type WideShell = "hud" | "cockpit"

export class HudShellRouter {
  private active = new Map<string, WideShell>()
  private lastHeartbeat = 0
  private pendingPing: { nonce: string; t0: number } | null = null
  private lastPingOkFlag = false
  private hudPid: number | null = null

  constructor(
    private sinks: {
      sendToHud: (m: unknown) => void
      sendToCockpit: (m: unknown) => void
    },
  ) {}

  getActiveShell(threadId: string): WideShell | null {
    return this.active.get(threadId) ?? null
  }

  setActiveShell(threadId: string, next: WideShell): void {
    const prev = this.active.get(threadId)
    this.active.set(threadId, next)
    if (prev && prev !== next) {
      const message =
        next === "hud"
          ? "任务进行中 — 在 HUD 查看"
          : "任务进行中 — 在 确认台 查看"
      const payload = {
        cmd: "shell.standby",
        thread_id: threadId,
        active_shell: next,
        message,
      }
      if (prev === "hud") this.sinks.sendToHud(payload)
      else this.sinks.sendToCockpit(payload)
    }
  }

  noteHeartbeat(ts: number): void {
    this.lastHeartbeat = ts
  }

  isHealthy(now = Date.now()): boolean {
    if (!this.lastHeartbeat) return false
    return now - this.lastHeartbeat <= HUD_HEARTBEAT_STALE_MS
  }

  beginPing(now = Date.now()): string {
    const nonce = `p${now}`
    this.pendingPing = { nonce, t0: now }
    this.sinks.sendToHud({ cmd: "hud.ping", nonce })
    return nonce
  }

  notePong(nonce: string, now = Date.now()): void {
    if (!this.pendingPing || this.pendingPing.nonce !== nonce) return
    this.lastPingOkFlag = now - this.pendingPing.t0 <= HUD_PING_TIMEOUT_MS
    this.pendingPing = null
  }

  lastPingOk(): boolean {
    return this.lastPingOkFlag
  }

  setHudPid(pid: number | null): void {
    this.hudPid = pid
  }
}
```

- [x] **Step 3: Run tests — PASS** — 8/8 shell-router + 6/6 protocol (14 total)

```bash
cd companion && npm test -- --test-name-pattern="HudShellRouter"
```

- [x] **Step 4: Commit** — `feat(hud): shell router stub with standby and N3 health numbers`

```bash
git add companion/src/hud/shell-router.ts companion/tests/hud-shell-router.test.ts
git commit -m "feat(hud): shell router stub with standby and N3 health numbers"
```

---

### Task 3: N5 broadcast-resolved hook on manager (minimal) — **DONE 2026-07-27**

**Files:**
- Modify: `companion/src/security-confirmation.ts`
- Create: `companion/tests/security-confirmation-broadcast.test.ts` (or extend existing security confirm tests)

**Intent:** When a confirm resolves (respond / respondFrom / timeout), invoke an optional `onTerminal` callback so bridge can fan-out `hud.confirm.resolved` + existing `cancelConfirm`. Do **not** rename wire `unknown`.

- [x] **Step 1: Write failing test**

```ts
it("invokes onTerminal once when respond wins", async () => {
  const events: any[] = []
  const mgr = new SecurityConfirmationManager(5000)
  mgr.setOnTerminal((e) => events.push(e))
  const p = mgr.request((msg) => { /* capture request */ }, {
    toolName: "evaluate",
    dangerousApis: [],
    code: "1",
  }, undefined, "cid-1")
  assert.equal(mgr.respond("cid-1", true), true)
  const d = await p
  assert.equal(d.approved, true)
  assert.equal(events.length, 1)
  assert.equal(events[0].confirmationId, "cid-1")
  assert.equal(events[0].reason, "approved")
  // late respond
  assert.equal(mgr.respond("cid-1", false), false) // or outcome unknown path
})
```

- [x] **Step 2: Implement `setOnTerminal` / call from resolve paths**

In `SecurityConfirmationManager`:

```ts
private onTerminal: ((e: {
  confirmationId: string
  approved: boolean
  reason: SecurityConfirmationDecision["reason"]
}) => void) | null = null

setOnTerminal(cb: typeof this.onTerminal): void {
  this.onTerminal = cb
}

private finalize(confirmationId: string, decision: SecurityConfirmationDecision): void {
  // called wherever pending is deleted and resolve() fires
  try {
    this.onTerminal?.({
      confirmationId,
      approved: decision.approved,
      reason: decision.reason,
    })
  } catch { /* never break resolve path */ }
}
```

Wire `finalize` into **every** path that deletes pending and calls `resolve(...)`. Audit these call sites in `security-confirmation.ts` before marking Task 3 done (TDD + grep):

| Call site | Expected `reason` |
|-----------|-------------------|
| `respond()` success | `approved` / `denied` |
| `respondFrom()` success | `approved` / `denied` |
| `request()` timer timeout | `timeout` |
| `rejectAll()` / disconnect bulk | `disconnect` |
| `rejectForWorker()` (if present) | `disconnect` or existing reason |

Late `respond` / `respondFrom` that return `false` / `outcome: "unknown"` must **not** call `finalize` again. Keep wire symbol **`unknown`** — do not invent `already_resolved`.

- [x] **Step 3: Tests PASS; commit** — 7/7 broadcast + origin suite green; call sites: respond, respondFrom (+nonce_locked), timeout, rejectAll, rejectForWorker

```bash
git add companion/src/security-confirmation.ts companion/tests/security-confirmation-broadcast.test.ts
git commit -m "feat(security): onTerminal hook for multi-surface confirm fan-out"
```

---

### Task 4: Swift — lazy HUD window + cmd handlers — **SOURCE DONE 2026-07-27** (hash rebuild = macOS)

**Files:**
- Modify: `companion/src/tray/Tray.swift`

- [x] **Step 1: Add `HudController` class** (same file as `PairingController` pattern — reuse `isReleasedWhenClosed = false`)

Window contents (spike UI only):

| Region | Content |
|--------|---------|
| Title | `CMspark 确认台 (spike)` + connection label |
| Status line | hydrate thread_id / shell / standby message |
| Confirm card | tool_name, risk, summary, **允许** / **拒绝** (hidden when none or standby) |
| Task line | goal + status or "无任务" |
| Actions | **急停** (always enabled when task running), **收起** (close window ≠ quit) |

- [x] **Step 2: Extend `handleCommand`**

```swift
case "hud.open":
  let threadId = (json["thread_id"] as? String) ?? ""
  hudController.open(threadId: threadId)

case "hud.hydrate":
  hudController.applyHydrate(json)

case "hud.confirm.request":
  // populate confirm card; do NOT use tray ConfirmController dialog for HUD path
  hudController.showConfirm(json)

case "hud.confirm.cancel", "hud.confirm.resolved":
  hudController.clearConfirm(id: (json["id"] as? String) ?? "")

case "shell.standby":
  hudController.enterStandby(message: (json["message"] as? String) ?? "")

case "hud.ping":
  let nonce = (json["nonce"] as? String) ?? ""
  jsonLine(["type": "hud.pong", "nonce": nonce])

case "hud.close":
  hudController.hide()
```

- [x] **Step 3: Emit events** (source)

- On first successful open: `{"type":"hud.ready"}`  
- Heartbeat timer every **1s** **only while the HUD window is visible** (`isVisible` / order-front). Stop timer on hide/close. Do **not** run a process-lifetime 1s timer in spike. (Optional: also on `NSWindow.didBecomeKeyNotification` to restart if needed.)  
- Confirm buttons → `{"type":"hud.confirm.response","id":...,"approved":true|false}`  
- 急停 → `{"type":"hud.abort","thread_id":...}`  
- User closes window → `{"type":"hud.closed","reason":"user"}` — **do not** terminate `NSApplication`
- `hud.hydrate` with empty `dual_track.conclusions` / `steps` must be a **no-op** on the rails (do not crash)

- [x] **Step 4: Build + update hash** — **DONE 2026-07-28** (`5929b53c…` in `swift-tray-bridge.ts`)

```bash
# Run from repo root. Prefer the SHA256 printed by the build script itself.
bash companion/src/tray/build-tray.sh
# If the script does not print the digest, hash the absolute output path:
shasum -a 256 "$(git rev-parse --show-toplevel)/dist/cmspark-tray"
# Paste hex into SWIFT_TRAY_SHA256 in swift-tray-bridge.ts
# (optional rename constant to SWIFT_COMPANION_UI_SHA256 with alias export — keep one gate)
```

- [ ] **Step 5: Manual smoke without Node**

```bash
# optional: echo commands into binary if it accepts stdin
printf '%s\n' '{"cmd":"hud.open","thread_id":"t-spike"}' | dist/cmspark-tray
# expect window; kill process after
```

- [ ] **Step 6: Commit** (binary hash constant + Swift source; do not commit huge accidental artifacts)

```bash
git add companion/src/tray/Tray.swift companion/src/tray/swift-tray-bridge.ts
git commit -m "feat(hud): Swift lazy HUD window and spike protocol handlers"
```

---

### Task 5: Node bridge — send/receive HUD messages — **DONE 2026-07-27** (Task 4 Swift UI still open)

**Files:**
- Modify: `companion/src/tray/swift-tray-bridge.ts`
- Modify: `companion/src/tray/tray-adapter.ts` (interface stubs)
- Modify: `companion/src/server.ts` (onTerminal wire)

- [x] **Step 1: Add methods on `SwiftTrayAdapter`**

```ts
openHud(threadId: string, reason: "spike" | "debug" = "spike"): void {
  this.send(encodeHudOpen({ thread_id: threadId, reason }))
}

/**
 * Resolves on first `hud.ready` after send, or rejects after timeoutMs (default 2000).
 * Implementation: store resolve/reject in a one-shot waiter; clear on ready or timeout.
 */
openHudAsync(threadId: string, reason: "spike" | "debug" = "spike", timeoutMs = 2000): Promise<void> {
  // send encodeHudOpen; race hud.ready vs setTimeout → reject(new Error("hud.ready timeout"))
}

hydrateHud(snapshot: HudHydratePayload): void {
  this.send(encodeHudHydrate(snapshot))
}

showHudConfirm(req: {
  id: string
  toolName: string
  riskLevel: string
  summary: string
  timeoutMs: number
}): Promise<{ id: string; approved: boolean }> {
  // Mirror showConfirmDialog: pending map + timeoutMs+1000 self-timeout
  // send hud.confirm.request
}

cancelHudConfirm(id: string): void {
  this.send({ cmd: "hud.confirm.cancel", id })
}

notifyHudConfirmResolved(id: string, outcome: string): void {
  this.send({ cmd: "hud.confirm.resolved", id, outcome })
}

standbyHud(threadId: string, activeShell: "hud" | "cockpit", message: string): void {
  this.send(encodeShellStandby({ thread_id: threadId, active_shell: activeShell, message }))
}
```

- [x] **Step 2: Handle stdout lines** in existing line parser:

```ts
case "hud.ready": /* set flag; resolve open waiters if any */
case "hud.heartbeat": /* shellRouter.noteHeartbeat */
case "hud.pong": /* shellRouter.notePong */
case "hud.confirm.response": /* resolve pending HUD confirm map */
case "hud.abort": /* forward to actionCallback or dedicated abortCallback */
case "hud.closed": /* mark window closed; do not kill process */
```

- [x] **Step 3: Wire `onTerminal` in `server.ts` (owner of the manager singleton)**

**Wire ownership (locked for spike):**

| Concern | File |
|---------|------|
| `SecurityConfirmationManager` singleton + tray confirm race | `companion/src/server.ts` |
| Spawn Swift tray / menu-bar process | `companion/src/menu-bar-agent.ts` |
| Spike: call `setOnTerminal` | **`server.ts`** where manager is constructed / tray is reachable |
| Spike: env-gated debug open/confirm | **`server.ts`** (has manager); optional tray menu action that **signals server** via existing channel, not a second manager |

Do **not** construct a second manager in `menu-bar-agent.ts`. If tray is only held by menu-bar, use the existing `getTrayInstance()` (or inject tray into server) so `server.ts` can call `cancelHudConfirm` / `notifyHudConfirmResolved`.

```ts
// companion/src/server.ts — after securityConfirmations is constructed
securityConfirmations.setOnTerminal(({ confirmationId, reason }) => {
  const tray = getTrayInstance?.() // or injected tray ref
  tray?.cancelConfirm?.(confirmationId)       // existing tray popover
  tray?.cancelHudConfirm?.(confirmationId)
  tray?.notifyHudConfirmResolved?.(confirmationId, reason)
  // Spike: multi-surface fan-out is HUD + tray only.
  // WS fan-out to non-origin clients is DEFERRED (origin already gets resolved via pending.send).
})
```

- [x] **Step 4: Integrity test still green** — 3/4 integrity pass; symlink case EPERM on Windows (env), not regression

```bash
cd companion && npm test -- --test-name-pattern="integrity|swift-tray"
```

- [x] **Step 5: Commit** — `feat(hud): Node bridge for HUD open/hydrate/confirm/standby`

```bash
git add companion/src/tray/swift-tray-bridge.ts companion/src/tray/tray-adapter.ts companion/src/server.ts
git commit -m "feat(hud): Node bridge for HUD open/hydrate/confirm/standby"
```

---

### Task 6: Debug entry + one real confirm round-trip — **WIRED 2026-07-27** (manual macOS checklist open)

**Files:**
- Create: `companion/src/hud/spike.ts`
- Modify: **`companion/src/server.ts`** (owns manager + onTerminal + confirm race + `hud.spike.*` WS)
- Modify: `companion/src/menu-bar-agent.ts` (dual-process UI driver)
- Modify: `companion/src/tray/companion-client.ts` (`sendAppMessage` / `onAppMessage`)
- Gate: `process.env.CMSPARK_HUD_SPIKE === "1"`

- [x] **Step 1: Env-gated spike open** (server-side helper + dual-process tray driver)

When triggered:

1. `await tray.openHudAsync("spike-thread", "spike", 2000)` — fail log if timeout  
2. `tray.hydrateHud({ thread_id: "spike-thread", shell: "hud", connection: "connected", pending_confirmations: [], task: { task_id: "spike", status: "running", goal: "spike goal" }, dual_track: { conclusions: [], steps: [] } })`  
3. Create a **new** pending confirm via `SecurityConfirmationManager.request` with a **local send** that also calls `tray.showHudConfirm(...)` (HUD-only elevated path for first confirm — do not also open tray popover unless doing the dual-surface race step)  
4. Race: HUD promise vs manager timeout (reuse tray pattern at `server.ts` ~1175–1361)  
5. First win → `respond`  

- [x] **Step 2: Abort path** — tray `onHudAbort` → `hud.spike.abort` log on server (no real CU task)

- [x] **Step 3: Standby path** — after `hud.spike.done`, menu-bar `setActiveShell(…, "cockpit")` → `shell.standby`

- [ ] **Step 4: Manual verification checklist** (operator fills — needs rebuilt Swift binary on macOS)

```
[ ] CMSPARK_HUD_SPIKE=1 companion start — tray appears
[ ] Spike open — window paints < 1.5s warm
[ ] Hydrate shows thread + task line
[ ] Confirm #1 Allow (new confirmation_id) → manager approved; HUD card clears
[ ] Confirm #2 Deny (NEW confirmation_id, not late-respond on #1) → denied; card clears
[ ] Optional late-respond check: after #1 resolved, re-click Allow on stale UI if any → unknown / no double-exec
[ ] Dual-surface race (optional step): show HUD + tray dialog for same id — only one wins; other clears via resolved
[ ] 急停 emits abort; window still open
[ ] Close window (red dot) — process/tray remains; companion still running
[ ] Standby — elevated confirm hidden; status message visible
[ ] Pairing window still works
[ ] Integrity: restart after rebuild with updated SHA256
```

- [x] **Step 5: Commit** — combined with Task 4 source: `feat(hud): Swift lazy HUD + env-gated dual-process spike`

```bash
git add companion/src/server.ts companion/src/menu-bar-agent.ts
git commit -m "feat(hud): env-gated spike entry for open/hydrate/confirm/abort"
```

---

### Task 7: Ship note + dual-review of **implementation** (not screenshots)

**Files:**
- Create: `docs/decisions/v1.3/companion-native-hud-p3a-spike-ship-note-2026-07-28.md`
- Update: `docs/decisions/v1.3/companion-native-hud-n1n10-lock-2026-07-27.md` checklist (mark spike plan + spike dual-review)

- [x] **Step 1: Write ship note** with:

  - What was proven (S1–S7)  
  - Measured open latency  
  - Known gaps (no dual-track, no N3 production selector, etc.)  
  - Go / No-go for **P3a-full** (ConfirmElevated parity + dual-track)  
  - Explicit: screenshot path only if go  

- [x] **Step 2: Dual-review implementation** (Claude + Pi) against N1–N10 + this plan — **2026-07-28 both_ok** (`native-hud-p3a-impl-verdict-20260728-172207.json`)

Prompt focus: race safety, one binary, close≠stop, unknown wire, no scope creep.

- [x] **Step 3: If APPROVE_WITH_NITS**, fix only spike-critical nits; defer dual-track. — nits non-blocking (redundant onTerminal fan-out, abort log-only); deferred.

- [x] **Step 4: Commit docs** — see PR / commit after Task 7

```bash
git add docs/decisions/v1.3/companion-native-hud-p3a-spike-ship-note-2026-07-27.md \
        docs/decisions/v1.3/companion-native-hud-n1n10-lock-2026-07-27.md
git commit -m "docs(p3a): native HUD spike ship note and checklist"
```

---

## Post-spike sequencing (do not execute in this plan)

| Phase | Work | Gate |
|-------|------|------|
| P3a-full | ConfirmElevated parity (nonce/whitelist/preview), TaskDock real events, dual-track **without** high-rate screenshots first | Spike go |
| P3a-frames | Screenshot transport decision (stdin vs UDS vs temp file under `~/.cmspark-agent/`) + redaction sole owner Companion | Dual-review transport ADR snippet |
| P3b | Production `hud.shell` auto/native/extension + tray N7 selector + cold-start N3 | Metrics from P3a-full |

---

## Self-review (author checklist)

| Spec item | Task |
|-----------|------|
| N1 one binary | Task 4–5 |
| N2 standby | Task 2 + 4 + 6 |
| N3 health numbers | Task 2 (full selector deferred) |
| N4 close ≠ stop | Task 4 close handler |
| N5 single-writer + broadcast NEW | Task 3 + 5 |
| N6 conductor | **Out of spike** (no Composer) — listed non-goal |
| N7 tray open | **Out of spike** (debug menu only) |
| N8 crash fallback | **Out of spike** (document only) |
| N9 macOS | Task 4 build script Darwin-only |
| N10 dual-track cap | **Out of spike** |
| Abort | Task 4–6 |
| Hydrate | Task 4–6 |
| Dual-review before screenshot flood | Task 0 + 7 |

Placeholder scan: none intentional; debug env flag is concrete.

---

## Risk notes for implementers

1. **Do not** auto-rebuild Swift on hash mismatch (existing S-P0-2 rule).  
2. **Do not** log pairing secrets or full confirm previews at info.  
3. HUD confirm path should race with tray dialog **only if** both are intentionally shown; for spike, prefer HUD-only when testing elevated path to reduce noise, plus one explicit dual-surface race test.  
4. `show-confirm` (tray popover) remains for L2 production until P3b retirement decision (C3).  
5. Keep `cmspark-tray` filename for packaging unless packaging scripts are updated in the same change.

---

---

## Dual-review amendments (Task 0 — 2026-07-27)

| Field | Value |
|-------|--------|
| Claude | `docs/audit/reviews/native-hud-p3a-spike-plan-claude-20260727-181620.md` → **APPROVE_WITH_NITS** |
| Pi | `docs/audit/reviews/native-hud-p3a-spike-plan-pi-20260727-181620.md` → **APPROVE_WITH_NITS** |
| Verdict | `docs/audit/reviews/native-hud-p3a-spike-plan-verdict-20260727-181620.json` · `both_approve: true` |
| Prompt | `docs/audit/reviews/native-hud-p3a-spike-plan-prompt-2026-07-27.md` |

### Folded nits (no re-review required)

| ID | Source | Resolution in plan |
|----|--------|-------------------|
| C-N1 | Claude | Task 2 standby assertion already targets **prior** shell `cockpit` when switching → `hud` (verified; keep) |
| C-N2 | Claude | Task 1: typed `HudHydratePayload` + `unknown` parse + typeguards (`isHudReady` / heartbeat / pong / abort / closed) |
| C-N3 | Claude | Task 5: **`openHudAsync(threadId, reason?, timeoutMs=2000)`** resolves on first `hud.ready` |
| C-N4 / P2 | Claude + Pi | Wire ownership locked: **`server.ts`** owns manager + `onTerminal` + spike confirm; menu-bar does not own a second manager |
| C-N5 | Claude | Heartbeat **only while HUD window visible**; stop on hide/close |
| P1 | Pi | Task 3: enumerate finalize call sites (`respond`, `respondFrom`, timeout, `rejectAll`, `rejectForWorker`) |
| P3 | Pi | Task 4 build: prefer build-script printed SHA256; absolute `dist/cmspark-tray` path |
| P4 | Pi | Spike fan-out = **HUD + tray only**; WS multi-client fan-out deferred |
| P5 | Pi | Manual checklist: Confirm #2 uses **new** `confirmation_id`; separate optional late-respond unknown check |
| P6 | Pi | Swift hydrate empty `dual_track` arrays = no-op, no crash |

**Task 0 complete.** Implementers may start **Task 1**.

*Plan status: dual-reviewed (APPROVE_WITH_NITS); nits folded. No production default shell change.*
