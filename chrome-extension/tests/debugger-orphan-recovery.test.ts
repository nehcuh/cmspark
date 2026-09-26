// #537: orphaned debugger session recovery + per-tab inflight attach dedup
// (grok P2). Browser APIs are fakes; we assert the attach/detach call pattern.
import test from "node:test"
import assert from "node:assert/strict"
import { BrowserBridge } from "../src/background/browser-bridge"

type DbgCall = { method: string; tabId: number }

function makeChrome(opts: {
  attachBehavior: "ok" | "orphan-once" | "slow"
  log: DbgCall[]
}) {
  let attachCalls = 0
  const chrome: any = {
    tabs: {
      get: async (tabId: number) => ({ id: tabId, url: "http://127.0.0.1:8775/approval.html" }),
    },
    debugger: {
      onDetach: { addListener: (_fn: any) => {} },
      onEvent: { addListener: (_fn: any) => {} },
      attach: async ({ tabId }: any) => {
        attachCalls += 1
        opts.log.push({ method: "attach", tabId })
        if (opts.attachBehavior === "orphan-once" && attachCalls === 1) {
          throw new Error("Debugger is already attached to the tab")
        }
        if (opts.attachBehavior === "slow") {
          await new Promise(r => setTimeout(r, 25))
        }
      },
      detach: async ({ tabId }: any) => {
        opts.log.push({ method: "detach", tabId })
      },
      sendCommand: async ({ tabId }: any, method: string, params?: any) => {
        opts.log.push({ method: `cdp:${method}`, tabId })
        if (method === "Runtime.evaluate") return { result: { type: "boolean", value: true } }
        return {}
      },
    },
  }
  return chrome
}

test("#537: already-attached orphan → detach + re-attach once, tool succeeds", async () => {
  const log: DbgCall[] = []
  const previous = (globalThis as any).chrome
  ;(globalThis as any).chrome = makeChrome({ attachBehavior: "orphan-once", log })
  try {
    const bridge = new BrowserBridge()
    const result = await bridge.execute("evaluate", {
      tabId: 42,
      code: "1+1",
      security_token: "approved-token",
    })
    assert.equal(result.success, true, JSON.stringify(result))
    const attaches = log.filter(c => c.method === "attach")
    const detaches = log.filter(c => c.method === "detach")
    assert.equal(attaches.length, 2, "orphan recovery must attach again after detach")
    assert.equal(detaches.length, 1, "orphaned session detached exactly once")
    assert.ok(
      log.findIndex(c => c.method === "detach") < log.findIndex(c => c.method === "cdp:Runtime.evaluate"),
      "detach must precede the successful Runtime.evaluate",
    )
  } finally {
    if (previous === undefined) delete (globalThis as any).chrome
    else (globalThis as any).chrome = previous
  }
})

test("grok P2: concurrent ensureAttached on the same tab shares ONE attach sequence", async () => {
  const log: DbgCall[] = []
  const previous = (globalThis as any).chrome
  ;(globalThis as any).chrome = makeChrome({ attachBehavior: "slow", log })
  try {
    const bridge = new BrowserBridge()
    const [r1, r2] = await Promise.all([
      bridge.execute("evaluate", { tabId: 7, code: "1", security_token: "t" }),
      bridge.execute("evaluate", { tabId: 7, code: "2", security_token: "t" }),
    ])
    assert.equal(r1.success, true)
    assert.equal(r2.success, true)
    const attaches = log.filter(c => c.method === "attach")
    assert.equal(attaches.length, 1, `expected single shared attach, got ${attaches.length}: ${JSON.stringify(log)}`)
  } finally {
    if (previous === undefined) delete (globalThis as any).chrome
    else (globalThis as any).chrome = previous
  }
})
