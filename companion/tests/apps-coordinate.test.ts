// A10 opt-in surfaces — apps.set_coordinate_allowed + computer.set_enabled.
// Both switches flip ON only through the (faked) biometric gate; flipping OFF
// is always free (fail-closed direction). Config is real (pinned to a
// throwaway DATA_DIR by the setup import) so persistence round-trips are
// exercised; the gate is faked.

import "./_config-router-setup" // MUST be first — pins DATA_DIR before config import.

import test, { before } from "node:test"
import * as assert from "node:assert/strict"
import os from "node:os"

import { handleAppsMessage, type AppsHandlerDeps } from "../src/apps/handlers"
import { EvidenceOpenRateLimiter, handleComputerMessage } from "../src/computer/handlers"
import { armDesktopMaximum, desktopMaximumPermit, reviewDesktopMaximum, revokeDesktopMaximum } from "../src/computer/desktop-maximum"
import type { AppEntry } from "../src/apps/types"
import * as path from "path"

let getConfig: typeof import("../src/config").getConfig
let replaceAppsEntries: typeof import("../src/config").replaceAppsEntries
let setComputerCoordinateEnabled: typeof import("../src/config").setComputerCoordinateEnabled
let initDataDir: typeof import("../src/config").initDataDir

const EXE = "C:\\Program Files\\TestApp\\app.exe"
const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
const POWERSHELL_EXE = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"

before(async () => {
  const cfg = await import("../src/config")
  getConfig = cfg.getConfig
  replaceAppsEntries = cfg.replaceAppsEntries
  setComputerCoordinateEnabled = cfg.setComputerCoordinateEnabled
  initDataDir = cfg.initDataDir
  await initDataDir()
})

function reset() {
  replaceAppsEntries({})
  setComputerCoordinateEnabled(false)
}

function seedEntry(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    token: "win.app.test",
    kind: "gui",
    display_name: "Test App",
    source: "user",
    policy: "manual",
    enabled: true,
    added_at: "2026-07-18T10:00:00.000Z",
    exe: { path: EXE, signer: "CN=Test", user_writable_dir: false },
    ...overrides,
  } as AppEntry
}

function deps(overrides: Partial<AppsHandlerDeps> = {}): AppsHandlerDeps {
  return {
    realpath: (p) => p,
    exists: () => true,
    signerProbe: async () => "CN=Test",
    platform: "win32",
    ...overrides,
  }
}

function fakeGate(behavior: "approve" | "deny" | "cancel", captured?: { calls: number }) {
  return async (_req: { action: string; reason: string }) => {
    if (captured) captured.calls += 1
    if (behavior === "approve") return { approved: true as const, method: "windows-hello" as const, nonce: "n1" }
    if (behavior === "cancel") return { approved: false as const, reason: "cancelled" as const }
    return { approved: false as const, reason: "denied" as const }
  }
}

const approveChannel = async () => ({ confirmationId: "c", approved: true, reason: "approved" as const })

test("Apps list and updates describe each native coordinate path without persisting the hint", async t => {
  for (const platform of ["darwin", "win32"] as const) {
    const platformMock = t.mock.method(os, "platform", () => platform)
    try {
      reset()
      const native = platform === "win32"
      const entry = (slug: string, exe: string | undefined, bundleId?: string) => seedEntry({
        token: `${native ? "win" : "mac"}.app.${slug}`, exe: exe ? { path: exe, user_writable_dir: false } : undefined, bundleId,
        ...(!exe && native ? { aumid: "Owned.App_abcde!App" } : {}),
      })
      const apps = [
        entry("editor", native ? EXE : undefined, native ? undefined : "com.example.Editor"),
        entry("browser", native ? CHROME_EXE : undefined, native ? undefined : "com.apple.Safari"),
        entry("protected", native ? POWERSHELL_EXE : undefined, native ? undefined : "com.apple.Terminal"),
        entry("unbound", native ? undefined : "/Applications/Owned.app"),
      ]
      replaceAppsEntries(Object.fromEntries(apps.map(app => [app.token, app])))
      const originals = apps.map(app => app.token)
      const list = await handleAppsMessage({ type: "apps.list" }, {}, deps({ platform, exists: () => false }))
      const updated = await handleAppsMessage({ type: "apps.set_enabled", token: originals[0], enabled: true })
      for (const result of [list, updated]) {
        assert.deepEqual(originals.map(token => result.coordinate_modes[token]),
          ["per_app", "browser_task", "protected", "missing_identity"])
        assert.ok(result.entries.every((app: AppEntry) => !("coordinate_mode" in app)))
      }
      assert.ok(Object.values(getConfig().apps!.entries).every(app => !("coordinate_mode" in app)))
    } finally { platformMock.mock.restore() }
  }
})

// --- apps.set_coordinate_allowed -----------------------------------------------

test("apps.set_coordinate_allowed: invalid token -> INVALID_TOKEN", async () => {
  reset()
  const r: any = await handleAppsMessage({ type: "apps.set_coordinate_allowed", token: "nope", allowed: true }, {}, deps())
  assert.equal(r.type, "error")
  assert.equal(r.code, "INVALID_TOKEN")
})

test("apps.set_coordinate_allowed: non-boolean allowed -> INVALID_ENABLED", async () => {
  reset()
  const r: any = await handleAppsMessage(
    { type: "apps.set_coordinate_allowed", token: "win.app.test", allowed: "yes" },
    {},
    deps(),
  )
  assert.equal(r.code, "INVALID_ENABLED")
})

test("apps.set_coordinate_allowed: unknown token -> NOT_FOUND", async () => {
  reset()
  const r: any = await handleAppsMessage(
    { type: "apps.set_coordinate_allowed", token: "win.app.test", allowed: true },
    {},
    deps(),
  )
  assert.equal(r.code, "NOT_FOUND")
})

test("apps.set_coordinate_allowed: mac Chrome + dummy.exe still STRUCTURAL (Trust nits REJECT)", async t => {
  t.mock.method(os, "platform", () => "darwin")
  reset()
  replaceAppsEntries({
    "mac.app.google_chrome": seedEntry({
      token: "mac.app.google_chrome",
      bundleId: "com.google.Chrome",
      exe: { path: "dummy.exe", user_writable_dir: false },
      display_name: "Google Chrome",
    }),
  })
  const gateCalls = { calls: 0 }
  const r: any = await handleAppsMessage(
    { type: "apps.set_coordinate_allowed", token: "mac.app.google_chrome", allowed: true },
    { requestConfirmation: approveChannel },
    deps({ platform: "darwin", gate: fakeGate("approve", gateCalls) }),
  )
  assert.equal(r.code, "COORDINATE_STRUCTURAL_DENY")
  assert.equal(gateCalls.calls, 0)
  assert.equal(getConfig().apps?.entries["mac.app.google_chrome"]?.coordinateAllowed, undefined)
})

test("apps.set_coordinate_allowed: mac Chrome bundleId-only -> COORDINATE_STRUCTURAL_DENY (Trust REJECT fold)", async t => {
  t.mock.method(os, "platform", () => "darwin")
  reset()
  replaceAppsEntries({
    "mac.app.google_chrome": seedEntry({
      token: "mac.app.google_chrome",
      bundleId: "com.google.Chrome",
      exe: undefined,
      display_name: "Google Chrome",
    }),
  })
  const gateCalls = { calls: 0 }
  const r: any = await handleAppsMessage(
    { type: "apps.set_coordinate_allowed", token: "mac.app.google_chrome", allowed: true },
    { requestConfirmation: approveChannel },
    deps({ platform: "darwin", gate: fakeGate("approve", gateCalls) }),
  )
  assert.equal(r.code, "COORDINATE_STRUCTURAL_DENY")
  assert.equal(gateCalls.calls, 0)
  assert.equal(getConfig().apps?.entries["mac.app.google_chrome"]?.coordinateAllowed, undefined)
})

test("apps.set_coordinate_allowed: chrome exe -> COORDINATE_STRUCTURAL_DENY, gate never runs (A10.3)", async () => {
  reset()
  replaceAppsEntries({ "win.app.test": seedEntry({ exe: { path: CHROME_EXE, user_writable_dir: false } }) })
  const gateCalls = { calls: 0 }
  const r: any = await handleAppsMessage(
    { type: "apps.set_coordinate_allowed", token: "win.app.test", allowed: true },
    { requestConfirmation: approveChannel },
    deps({ gate: fakeGate("approve", gateCalls) }),
  )
  assert.equal(r.code, "COORDINATE_STRUCTURAL_DENY")
  assert.equal(gateCalls.calls, 0, "structural deny short-circuits BEFORE the biometric gate")
  assert.equal(getConfig().apps?.entries["win.app.test"]?.coordinateAllowed, undefined, "bit stays unset")
})

test("apps.set_coordinate_allowed: powershell exe (LOLBIN) -> COORDINATE_STRUCTURAL_DENY", async () => {
  reset()
  replaceAppsEntries({ "win.app.test": seedEntry({ exe: { path: POWERSHELL_EXE, user_writable_dir: false } }) })
  const r: any = await handleAppsMessage(
    { type: "apps.set_coordinate_allowed", token: "win.app.test", allowed: true },
    { requestConfirmation: approveChannel },
    deps({ gate: fakeGate("approve") }),
  )
  assert.equal(r.code, "COORDINATE_STRUCTURAL_DENY")
})

test("apps.set_coordinate_allowed: no confirmation channel -> NO_CONFIRMATION_CHANNEL", async () => {
  reset()
  replaceAppsEntries({ "win.app.test": seedEntry() })
  const r: any = await handleAppsMessage(
    { type: "apps.set_coordinate_allowed", token: "win.app.test", allowed: true },
    {},
    deps({ gate: fakeGate("approve") }),
  )
  assert.equal(r.code, "NO_CONFIRMATION_CHANNEL")
})

test("apps.set_coordinate_allowed: gate deny -> BIOMETRIC_DENIED, bit unchanged", async () => {
  reset()
  replaceAppsEntries({ "win.app.test": seedEntry() })
  const r: any = await handleAppsMessage(
    { type: "apps.set_coordinate_allowed", token: "win.app.test", allowed: true },
    { requestConfirmation: approveChannel },
    deps({ gate: fakeGate("deny") }),
  )
  assert.equal(r.code, "BIOMETRIC_DENIED")
  assert.equal(getConfig().apps?.entries["win.app.test"]?.coordinateAllowed, undefined)
})

test("apps.set_coordinate_allowed: gate approve -> bit persisted + broadcast", async () => {
  reset()
  replaceAppsEntries({ "win.app.test": seedEntry() })
  const broadcasts: any[] = []
  const r: any = await handleAppsMessage(
    { type: "apps.set_coordinate_allowed", token: "win.app.test", allowed: true },
    { requestConfirmation: approveChannel, broadcast: (d: any) => broadcasts.push(d) },
    deps({ gate: fakeGate("approve") }),
  )
  assert.equal(r.type, "apps.updated")
  assert.equal(r.coordinateAllowed, true)
  assert.equal(getConfig().apps?.entries["win.app.test"]?.coordinateAllowed, true, "persisted to config")
  assert.equal(broadcasts.length, 1)
  assert.equal(broadcasts[0].type, "apps.updated")
})

test("apps.set_coordinate_allowed: clearing is FREE (no channel, no gate) — fail-closed direction", async () => {
  reset()
  replaceAppsEntries({ "win.app.test": seedEntry({ coordinateAllowed: true }) })
  const gateCalls = { calls: 0 }
  const r: any = await handleAppsMessage(
    { type: "apps.set_coordinate_allowed", token: "win.app.test", allowed: false },
    {}, // deliberately NO confirmation channel
    deps({ gate: fakeGate("deny", gateCalls) }),
  )
  assert.equal(r.coordinateAllowed, false)
  assert.equal(gateCalls.calls, 0, "clearing must not consult the gate")
  assert.equal(getConfig().apps?.entries["win.app.test"]?.coordinateAllowed, false)
})

test("apps.set_coordinate_allowed: clearing on a vault binary is still free (weird-state escape hatch)", async () => {
  reset()
  replaceAppsEntries({
    "win.app.test": seedEntry({ exe: { path: CHROME_EXE, user_writable_dir: false }, coordinateAllowed: true }),
  })
  const r: any = await handleAppsMessage(
    { type: "apps.set_coordinate_allowed", token: "win.app.test", allowed: false },
    {},
    deps(),
  )
  assert.equal(r.coordinateAllowed, false)
  assert.equal(getConfig().apps?.entries["win.app.test"]?.coordinateAllowed, false)
})

// --- computer.set_enabled --------------------------------------------------------

test("settings revocation signals active native input and cannot revive the old permit", async t => {
  reset()
  const first = seedEntry({ coordinateAllowed: true })
  const second = seedEntry({ token: "win.app.other", coordinateAllowed: true })
  const entries = { [first.token]: first, [second.token]: second }
  replaceAppsEntries(entries)
  setComputerCoordinateEnabled(true)
  const peer = {}
  let ended = 0
  const offer = reviewDesktopMaximum(peer)
  assert.equal(offer.apps.length, 2)
  armDesktopMaximum(peer, { review_id: offer.review_id, confirmation_phrase: "我了解风险", images: false }, getConfig(), () => ended++)
  t.after(() => revokeDesktopMaximum(peer))
  const permit = desktopMaximumPermit(peer, first.token, () => true)!
  const other = desktopMaximumPermit(peer, second.token, () => true)!
  const stop = t.mock.fn()
  permit.signal.addEventListener("abort", stop, { once: true })
  assert.equal((await handleAppsMessage({ type: "apps.set_coordinate_allowed", token: first.token, allowed: false }, {}, deps())).type, "apps.updated")
  assert.equal(stop.mock.callCount(), 1)
  assert.equal(permit.current(), false)
  assert.equal(other.current(), true)
  replaceAppsEntries(entries)
  assert.equal(desktopMaximumPermit(peer, first.token, () => true), undefined)
  assert.equal(ended, 0)
  const settings = await handleComputerMessage({ type: "computer.set_enabled", enabled: false }, {})
  assert.equal(settings.type, "computer.state")
  assert.equal(other.signal.aborted, true)
  assert.equal(ended, 1)
})

test("an already enabled coordinate switch requires no second biometric", async () => {
  reset()
  setComputerCoordinateEnabled(true)
  const calls = { calls: 0 }
  const result = await handleComputerMessage({ type: "computer.set_enabled", enabled: true },
    { requestConfirmation: approveChannel }, { gate: fakeGate("deny", calls) })
  assert.equal(result.coordinateEnabled, true)
  assert.equal(calls.calls, 0)
})

test("overlapping enables open one prompt and a disable wins over its late approval", async () => {
  reset()
  const request = { type: "computer.set_enabled", enabled: true }
  const ctx = { requestConfirmation: approveChannel }
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const first = handleComputerMessage(request, ctx, { gate: async req => {
    await waiting
    return fakeGate("approve")(req)
  } })
  try {
    const calls = { calls: 0 }
    const second = await handleComputerMessage(request, ctx, { gate: fakeGate("approve", calls) })
    assert.equal(second.code, "COMPUTER_ENABLE_PENDING")
    assert.equal(calls.calls, 0)
  } finally {
    await handleComputerMessage({ type: "computer.set_enabled", enabled: false }, {})
    release()
  }
  assert.equal((await first).code, "COMPUTER_ENABLE_STALE")
  assert.equal(getConfig().computer?.coordinateEnabled, false)
  assert.equal((await handleComputerMessage(request, ctx, { gate: fakeGate("approve") })).coordinateEnabled, true)
})

test("disconnected owner cannot commit a pending global coordinate grant", async () => {
  reset()
  let current = true
  const result = await handleComputerMessage({ type: "computer.set_enabled", enabled: true },
    { requestConfirmation: approveChannel, ownerCurrent: () => current },
    { gate: async req => { current = false; return fakeGate("approve")(req) } })
  assert.equal(result.code, "COMPUTER_ENABLE_STALE")
  assert.equal(getConfig().computer?.coordinateEnabled, false)
})

test("computer.set_enabled: non-boolean -> INVALID_ENABLED", async () => {
  reset()
  const r: any = await handleComputerMessage({ type: "computer.set_enabled", enabled: "on" }, {})
  assert.equal(r.type, "error")
  assert.equal(r.code, "INVALID_ENABLED")
})

test("computer.set_enabled(false) is free — no channel, no gate, persists OFF", async () => {
  reset()
  setComputerCoordinateEnabled(true) // start ON so the transition is real
  const broadcasts: any[] = []
  const r: any = await handleComputerMessage(
    { type: "computer.set_enabled", enabled: false },
    { broadcast: (d: any) => broadcasts.push(d) },
    { gate: fakeGate("deny") }, // would deny if consulted — must NOT be consulted
  )
  assert.equal(r.type, "computer.state")
  assert.equal(r.coordinateEnabled, false)
  assert.equal(getConfig().computer?.coordinateEnabled, false)
  assert.equal(broadcasts.length, 1)
})

test("computer.set_enabled(true): no confirmation channel -> NO_CONFIRMATION_CHANNEL", async () => {
  reset()
  const r: any = await handleComputerMessage({ type: "computer.set_enabled", enabled: true }, {}, { gate: fakeGate("approve") })
  assert.equal(r.code, "NO_CONFIRMATION_CHANNEL")
  assert.equal(getConfig().computer?.coordinateEnabled, false, "stays OFF")
})

test("computer.set_enabled(true): gate deny -> BIOMETRIC_DENIED, stays OFF", async () => {
  reset()
  const r: any = await handleComputerMessage(
    { type: "computer.set_enabled", enabled: true },
    { requestConfirmation: approveChannel },
    { gate: fakeGate("deny") },
  )
  assert.equal(r.code, "BIOMETRIC_DENIED")
  assert.equal(getConfig().computer?.coordinateEnabled, false)
})

test("computer.set_enabled(true): gate cancel -> BIOMETRIC_DENIED(cancelled), stays OFF", async () => {
  reset()
  const r: any = await handleComputerMessage(
    { type: "computer.set_enabled", enabled: true },
    { requestConfirmation: approveChannel },
    { gate: fakeGate("cancel") },
  )
  assert.equal(r.code, "BIOMETRIC_DENIED")
  assert.equal(r.reason, "cancelled")
  assert.equal(getConfig().computer?.coordinateEnabled, false)
})

test("computer.set_enabled(true): gate approve -> persists ON + broadcast; get_state reflects it", async () => {
  reset()
  const broadcasts: any[] = []
  const r: any = await handleComputerMessage(
    { type: "computer.set_enabled", enabled: true },
    { requestConfirmation: approveChannel, broadcast: (d: any) => broadcasts.push(d) },
    { gate: fakeGate("approve") },
  )
  assert.equal(r.type, "computer.state")
  assert.equal(r.coordinateEnabled, true)
  assert.equal(getConfig().computer?.coordinateEnabled, true)
  assert.equal(broadcasts.length, 1)
  const state: any = await handleComputerMessage({ type: "computer.get_state" }, {})
  assert.equal(state.coordinateEnabled, true)
})

test("computer.set_enabled: unknown message -> error", async () => {
  reset()
  const r: any = await handleComputerMessage({ type: "computer.bogus" }, {})
  assert.equal(r.type, "error")
})

// --- computer.evidence.open (WP4) --------------------------------------------
// 校验四件套:严格字符集 → 基目录内解析 → Y5 reparse 复查 → 存在性检查;
// P6 频率上限按每 panelId 滑动窗口计数。openDir 只收解析后的完整路径
// (独立 argv 传给 explorer,taskId 绝不拼进命令行模板)。

const EVIDENCE_BASE = "C:\\evidence-test"

function evidenceSurface(overrides: Record<string, unknown> = {}) {
  return {
    baseDir: EVIDENCE_BASE,
    exists: () => true,
    openDir: () => {},
    limiter: new EvidenceOpenRateLimiter(),
    reparseFs: { lstatSync: () => ({ isSymbolicLink: () => false }) },
    ...overrides,
  }
}

test("computer.evidence.open: 非法/穿越 task_id → INVALID_TASK_ID(在任何 fs 触碰之前)", async () => {
  const openCalls: string[] = []
  const deps = {
    evidenceOpen: evidenceSurface({ openDir: (d: string) => openCalls.push(d) }),
  }
  for (const bad of ["../x", "a/b", "a\\b", "a b", "..", "", "a.b", "a;b"]) {
    const r: any = await handleComputerMessage({ type: "computer.evidence.open", task_id: bad }, {}, deps as any)
    assert.equal(r.type, "error", `task_id ${JSON.stringify(bad)}`)
    assert.equal(r.code, "INVALID_TASK_ID")
  }
  // task_id 缺失(非 string)同样拒绝
  const r: any = await handleComputerMessage({ type: "computer.evidence.open" }, {}, deps as any)
  assert.equal(r.code, "INVALID_TASK_ID")
  assert.equal(openCalls.length, 0, "openDir 从未被调")
})

test("computer.evidence.open: 目录不存在 → not_found", async () => {
  const r: any = await handleComputerMessage(
    { type: "computer.evidence.open", task_id: "task_1" },
    {},
    { evidenceOpen: evidenceSurface({ exists: () => false }) } as any,
  )
  assert.deepEqual(r, { type: "computer.evidence.open.result", ok: false, error: "not_found" })
})

test("computer.evidence.open: 任务目录是 reparse point → EVIDENCE_ERROR(Y5 复查)", async () => {
  const openCalls: string[] = []
  const dir = path.join(EVIDENCE_BASE, "task_1")
  const r: any = await handleComputerMessage(
    { type: "computer.evidence.open", task_id: "task_1" },
    {},
    {
      evidenceOpen: evidenceSurface({
        reparseFs: { lstatSync: (p: string) => ({ isSymbolicLink: () => p === dir }) },
        openDir: (d: string) => openCalls.push(d),
      }),
    } as any,
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "EVIDENCE_ERROR")
  assert.equal(openCalls.length, 0, "reparse 拒绝发生在 openDir 之前")
})

test("computer.evidence.open: 成功 → openDir 收到 base+taskId 解析路径,result ok", async () => {
  const openCalls: string[] = []
  const r: any = await handleComputerMessage(
    { type: "computer.evidence.open", task_id: "Task-1_a" },
    { panelId: "p1" },
    { evidenceOpen: evidenceSurface({ openDir: (d: string) => openCalls.push(d) }) } as any,
  )
  assert.deepEqual(r, { type: "computer.evidence.open.result", ok: true })
  assert.deepEqual(openCalls, [path.join(EVIDENCE_BASE, "Task-1_a")])
})

test("computer.evidence.open P6: 同 panelId 第 6 次/分钟 → rate_limited,openDir 停在前 5 次", async () => {
  const openCalls: string[] = []
  const deps = {
    evidenceOpen: evidenceSurface({ openDir: (d: string) => openCalls.push(d) }),
  }
  for (let i = 0; i < 5; i++) {
    const r: any = await handleComputerMessage(
      { type: "computer.evidence.open", task_id: "task_1" },
      { panelId: "pA" },
      deps as any,
    )
    assert.equal(r.ok, true, `第 ${i + 1} 次放行`)
  }
  const r6: any = await handleComputerMessage(
    { type: "computer.evidence.open", task_id: "task_1" },
    { panelId: "pA" },
    deps as any,
  )
  assert.deepEqual(r6, { type: "computer.evidence.open.result", ok: false, error: "rate_limited" })
  assert.equal(openCalls.length, 5, "超限调用不触达 openDir")
})

test("computer.evidence.open P6: 不同 panelId 独立计数桶", async () => {
  const deps = { evidenceOpen: evidenceSurface() }
  for (let i = 0; i < 5; i++) {
    await handleComputerMessage({ type: "computer.evidence.open", task_id: "task_1" }, { panelId: "pA" }, deps as any)
  }
  const rB: any = await handleComputerMessage(
    { type: "computer.evidence.open", task_id: "task_1" },
    { panelId: "pB" },
    deps as any,
  )
  assert.equal(rB.ok, true, "pB 桶未被 pA 消耗")
  // 无 panelId 退化为进程级单桶,与命名桶互不影响
  const rD: any = await handleComputerMessage({ type: "computer.evidence.open", task_id: "task_1" }, {}, deps as any)
  assert.equal(rD.ok, true)
})

test("computer.evidence.open P6: 滑动窗口——60 秒后旧命中过期,恢复放行", async () => {
  let nowMs = 1_000_000
  const deps = {
    evidenceOpen: evidenceSurface({ now: () => nowMs }),
  }
  for (let i = 0; i < 5; i++) {
    await handleComputerMessage({ type: "computer.evidence.open", task_id: "task_1" }, { panelId: "pA" }, deps as any)
  }
  const blocked: any = await handleComputerMessage(
    { type: "computer.evidence.open", task_id: "task_1" },
    { panelId: "pA" },
    deps as any,
  )
  assert.equal(blocked.error, "rate_limited")
  nowMs += 61_000 // 过窗
  const after: any = await handleComputerMessage(
    { type: "computer.evidence.open", task_id: "task_1" },
    { panelId: "pA" },
    deps as any,
  )
  assert.equal(after.ok, true, "窗口滑过后恢复放行")
})

test("computer.evidence.open Y2: 死 panelId 的桶在 access 时被过期清扫(不永久驻留)", async () => {
  const limiter = new EvidenceOpenRateLimiter()
  let nowMs = 1_000_000
  const deps = { evidenceOpen: evidenceSurface({ limiter, now: () => nowMs }) }
  const open = (panelId: string) =>
    handleComputerMessage({ type: "computer.evidence.open", task_id: "task_1" }, { panelId }, deps as any)

  await open("dead-1")
  await open("dead-2")
  assert.equal(limiter.bucketCount(), 2)
  nowMs += 61_000 // 两桶全部出窗(>60s 无新命中)
  await open("live") // access 触发全表清扫
  assert.equal(limiter.bucketCount(), 1, "dead-1/dead-2 桶被清扫,只剩 live")
})

test("computer.evidence.open Y2: 活跃桶的窗口内命中在清扫中保留(不误伤计数)", async () => {
  const limiter = new EvidenceOpenRateLimiter()
  let nowMs = 1_000_000
  const deps = { evidenceOpen: evidenceSurface({ limiter, now: () => nowMs }) }
  // pA 在 t0 打满 5 次;t+30s pB access(清扫不应删 pA 的窗口内命中)
  for (let i = 0; i < 5; i++) {
    await handleComputerMessage({ type: "computer.evidence.open", task_id: "task_1" }, { panelId: "pA" }, deps as any)
  }
  nowMs += 30_000
  await handleComputerMessage({ type: "computer.evidence.open", task_id: "task_1" }, { panelId: "pB" }, deps as any)
  // pA 第 6 次仍在窗口内 → 仍被限(清扫没把它的计数误删)
  const r6: any = await handleComputerMessage(
    { type: "computer.evidence.open", task_id: "task_1" },
    { panelId: "pA" },
    deps as any,
  )
  assert.equal(r6.error, "rate_limited")
})
