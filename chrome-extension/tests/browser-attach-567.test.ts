import test from "node:test"
import assert from "node:assert/strict"
import { BrowserBridge } from "../src/background/browser-bridge"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}
const turn = () => new Promise<void>(r => setTimeout(r, 0))

async function withBridge(run: (bridge: BrowserBridge, fixture: ReturnType<typeof chromeFixture>) => Promise<void>) {
  const previous = (globalThis as any).chrome
  const fixture = chromeFixture()
  ;(globalThis as any).chrome = fixture.api
  try { await run(new BrowserBridge(), fixture) }
  finally {
    fixture.attachGate.resolve(); fixture.enableGate.resolve()
    if (previous === undefined) delete (globalThis as any).chrome
    else (globalThis as any).chrome = previous
  }
}

function chromeFixture() {
  const attachGate = deferred(), enableGate = deferred()
  const attached = new Set<number>()
  const calls = { attach: [] as number[], enable: [] as number[], cdp: [] as string[], fallback: 0, detach: 0, query: 0 }
  let detached!: (source: { tabId: number }, reason: string) => void
  const state = { failAttach: false, holdEnable: false, failEnable: false, active: 7 }
  const tab = (id: number) => ({ id, windowId: 1, url: `https://fixture.example/${id}`, title: "owned synthetic tab", width: 10, height: 10 })
  const api = {
    tabs: {
      get: async (id: number) => tab(id),
      query: async () => { calls.query++; return [tab(state.active)] },
      captureVisibleTab: async () => { calls.fallback++; return "data:image/jpeg;base64,ZmFrZQ==" },
    },
    debugger: {
      onDetach: { addListener(fn: typeof detached) { detached = fn } },
      getTargets: async () => [7, 8].map(tabId => ({ tabId, attached: attached.has(tabId) })),
      attach: async ({ tabId }: { tabId: number }, version: string) => {
        assert.equal(version, "1.3")
        calls.attach.push(tabId)
        await attachGate.promise
        if (state.failAttach || attached.has(tabId)) throw new Error("Another debugger is already attached")
        attached.add(tabId)
      },
      detach: async () => { calls.detach++; throw new Error("unknown debugger owner must never be detached") },
      sendCommand: async ({ tabId }: { tabId: number }, method: string) => {
        calls.cdp.push(`${tabId}:${method}`)
        if (method === "Page.enable") {
          calls.enable.push(tabId)
          if (state.holdEnable) await enableGate.promise
          if (state.failEnable) throw new Error("owned Page.enable failure")
          return {}
        }
        if (method === "Page.captureScreenshot") return { data: "ZmFrZQ==" }
        if (method === "Page.getLayoutMetrics") return { cssVisualViewport: { clientWidth: 10, clientHeight: 10 } }
        if (method === "Runtime.evaluate") return { result: { value: { base64: "ZmFrZQ==", width: 10, height: 10, src: "", alt: "" } } }
        throw new Error(`unexpected controlled CDP method ${method}`)
      },
    },
  }
  return { api, calls, state, attachGate, enableGate, detachExternally(id: number) { attached.delete(id); detached({ tabId: id }, "target_closed") } }
}

test("#567 actual implicit screenshots share one attach, without successful viewport fallback hiding a duplicate", async () => {
  await withBridge(async (bridge, f) => {
    const pair = Promise.all([bridge.execute("screenshot", {}), bridge.execute("screenshot", {})])
    await turn(); f.attachGate.resolve()
    const results = await pair
    assert.equal(results.filter(r => r.success).length, 2)
    assert.deepEqual(f.calls.attach, [7])
    assert.deepEqual(f.calls.enable, [7])
    assert.equal(f.calls.fallback, 0)
    assert.equal((bridge as any).attachInflight.size, 0)
  })
})

test("#567 actual implicit screenshot and analyze_image join the same attach producer", async () => {
  await withBridge(async (bridge, f) => {
    const pair = Promise.all([bridge.execute("screenshot", {}), bridge.execute("analyze_image", { selector: "#synthetic-image" })])
    await turn(); f.attachGate.resolve()
    const results = await pair
    assert.equal(results.filter(r => r.success).length, 2)
    assert.deepEqual(f.calls.attach, [7])
    assert.deepEqual(f.calls.enable, [7])
    assert.equal(f.calls.fallback, 0)
    assert.equal((bridge as any).attachInflight.size, 0)
  })
})

test("#567 shared attach error is not retained and a later caller may retry without detaching an unknown owner", async () => {
  await withBridge(async (bridge, f) => {
    f.state.failAttach = true
    const pair = Promise.allSettled([(bridge as any).ensureAttached(7), (bridge as any).ensureAttached(7)])
    await turn(); f.attachGate.resolve()
    const result = await pair
    assert.equal(result.every(r => r.status === "rejected"), true)
    assert.deepEqual(f.calls.attach, [7])
    assert.equal((result[0] as PromiseRejectedResult).reason, (result[1] as PromiseRejectedResult).reason)
    assert.equal((bridge as any).attachInflight.size, 0)
    assert.equal(bridge.getConfig().attachedTabCount, 0)
    assert.equal(f.calls.detach, 0)
    f.state.failAttach = false
    await (bridge as any).ensureAttached(7)
    assert.deepEqual(f.calls.attach, [7, 7])
    assert.equal(bridge.getConfig().attachedTabCount, 1)
    assert.equal((bridge as any).attachInflight.size, 0)
  })
})

test("#567 different tab attach sequences proceed together and external detach still requires a fresh attach", async () => {
  await withBridge(async (bridge, f) => {
    const pair = Promise.all([(bridge as any).ensureAttached(7), (bridge as any).ensureAttached(8)])
    await turn()
    assert.deepEqual(f.calls.attach, [7, 8], "no global queue may serialize different tabs")
    f.attachGate.resolve(); await pair
    assert.equal((bridge as any).attachInflight.size, 0)
    f.detachExternally(7)
    assert.equal(bridge.getConfig().attachedTabCount, 1)
    await (bridge as any).ensureAttached(7)
    assert.deepEqual(f.calls.attach, [7, 8, 7])
    assert.equal(bridge.getConfig().attachedTabCount, 2)
    assert.equal(f.calls.detach, 0)
  })
})

test("#567 waiters also share unsettled Page.enable, whose existing best-effort failure stays nonfatal", async () => {
  await withBridge(async (bridge, f) => {
    f.state.holdEnable = true; f.state.failEnable = true
    const first = (bridge as any).ensureAttached(7)
    await turn(); f.attachGate.resolve(); await turn()
    assert.deepEqual(f.calls.enable, [7])
    let completed = false
    const second = (bridge as any).ensureAttached(7).then(() => { completed = true })
    await turn()
    assert.equal(completed, false, "attached flag must not let a waiter skip the still-owned sequence")
    f.enableGate.resolve(); await Promise.all([first, second])
    assert.equal(completed, true)
    assert.deepEqual(f.calls.attach, [7])
    assert.equal((bridge as any).attachInflight.size, 0)
    assert.equal(bridge.getConfig().attachedTabCount, 1)
  })
})

test("#567 explicit-tab queue, forbidden implicit target and viewport mismatch controls remain unchanged", async () => {
  await withBridge(async (bridge, f) => {
    f.attachGate.resolve()
    const explicit = await Promise.all([bridge.execute("screenshot", { tabId: 7 }), bridge.execute("screenshot", { tabId: 7 })])
    assert.equal(explicit.every(r => r.success), true)
    assert.deepEqual(f.calls.attach, [7])
    const queryBefore = f.calls.query
    for (const tool of ["screenshot", "analyze_image"]) {
      const denied = await bridge.execute(tool, { selector: "#synthetic", __require_tab_id: true })
      assert.equal(denied.success, false)
      assert.equal(denied.data.error_code, "TAB_ID_REQUIRED")
    }
    assert.equal(f.calls.query, queryBefore)
    assert.deepEqual(f.calls.attach, [7])
    f.state.failAttach = true
    const mismatch = await bridge.execute("screenshot", { tabId: 8 })
    assert.equal(mismatch.success, false)
    assert.match(mismatch.error!, /^SCREENSHOT_FALLBACK_TAB_MISMATCH:/)
    assert.equal(f.calls.fallback, 0)
    assert.equal(f.calls.detach, 0)
  })
})
