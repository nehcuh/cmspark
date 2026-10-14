import test from "node:test"
import assert from "node:assert/strict"
import { BrowserBridge } from "../src/background/browser-bridge"

// Controlled native boundary, not a recorded business payload: field paths
// match the actual Page.getFrameTree read used in the dedicated Chrome probe.
async function scenario(run: (bridge: BrowserBridge, f: any) => Promise<void>) {
  const previous = (globalThis as any).chrome
  let release!: () => void
  const enableGate = new Promise<void>(r => { release = r })
  const f: any = { owner: "self", targets: [{ tabId: 7, attached: true }], proof: { frameTree: { frame: { id: "native-fixture-frame" } } },
    holdEnable: false, url: "https://owned-fixture.test/", calls: { attach: 0, proof: 0, enable: 0, detach: 0 }, release }
  const api = {
    tabs: { get: async () => ({ id: 7, url: f.url }) },
    debugger: {
      onDetach: { addListener(fn: any) { f.onDetach = fn } },
      getTargets: async () => { if (f.targetError) throw new Error("PRIVATE_TARGET_ERROR"); return f.targets },
      attach: async () => { f.calls.attach++; if (f.owner !== "none") throw new Error("Another debugger is already attached to the tab with id: 7."); f.owner = "self" },
      detach: async () => { f.calls.detach++; throw new Error("DETACH_FORBIDDEN") },
      sendCommand: async (_: any, method: string) => {
        if (method === "Page.getFrameTree") { f.calls.proof++; if (f.owner !== "self") throw new Error("PRIVATE_NOT_OWNED_ERROR"); return f.proof }
        if (method === "Page.enable") { f.calls.enable++; if (f.holdEnable) await enableGate; return {} }
        if (method === "Runtime.evaluate") return { result: { value: true } }
        throw new Error("UNEXPECTED_FIXTURE_COMMAND")
      },
    },
  }
  ;(globalThis as any).chrome = api
  try { await run(new BrowserBridge(), f) }
  finally { release(); if (previous === undefined) delete (globalThis as any).chrome; else (globalThis as any).chrome = previous }
}
async function refusal(p: Promise<unknown>): Promise<Error> {
  try { await p } catch (error) { return error as Error }
  throw new Error("Expected refusal")
}
const turn = () => new Promise<void>(r => setTimeout(r, 0))

test("#567 own native attachment is positively reused once after Bridge memory loss without attach or detach", async () => {
  await scenario(async (bridge, f) => {
    await Promise.all([(bridge as any).ensureAttached(7), (bridge as any).ensureAttached(7)])
    assert.deepEqual(f.calls, { attach: 0, proof: 1, enable: 1, detach: 0 })
    assert.equal(bridge.getConfig().attachedTabCount, 1); assert.equal((bridge as any).attachInflight.size, 0)
    const result = await bridge.execute("wait_for", { tabId: 7, selector: "#native-ready", timeout: 100 })
    assert.equal(result.success, true); assert.equal(f.calls.attach, 0)
  })
})

test("#567 known attached foreign owner fails closed before any attach and shares its fixed refusal", async () => {
  await scenario(async (bridge, f) => {
    f.owner = "other"
    const errors = await Promise.all([refusal((bridge as any).ensureAttached(7)), refusal((bridge as any).ensureAttached(7))])
    assert.equal(errors[0], errors[1]); assert.match(errors[0].message, /^DEBUGGER_OWNER_UNVERIFIED:/)
    assert.equal(errors[0].message.includes("PRIVATE"), false)
    assert.deepEqual(f.calls, { attach: 0, proof: 1, enable: 0, detach: 0 })
    assert.equal(bridge.getConfig().attachedTabCount, 0); assert.equal((bridge as any).attachInflight.size, 0)
  })
})

test("#567 missing, ambiguous or unavailable native target evidence never attempts attach or proves ownership", async () => {
  await scenario(async (bridge, f) => {
    for (const targets of [[], [{ tabId: 8, attached: false }], [{ tabId: 7 }],
      [{ tabId: 7, attached: false }, { tabId: 7, attached: true }]]) {
      f.targets = targets
      const error = await refusal((bridge as any).ensureAttached(7)); assert.match(error.message, /^DEBUGGER_TARGET_UNAVAILABLE:/)
    }
    f.targetError = true
    const error = await refusal((bridge as any).ensureAttached(7)); assert.match(error.message, /^DEBUGGER_TARGET_UNAVAILABLE:/)
    assert.equal(error.message.includes("PRIVATE"), false)
    assert.deepEqual(f.calls, { attach: 0, proof: 0, enable: 0, detach: 0 })
  })
})

test("#567 empty or malformed frame proof does not turn attached metadata into own authority", async () => {
  await scenario(async (bridge, f) => {
    for (const proof of [undefined, {}, { frameTree: { frame: { id: "" } } }, { frameTree: { frame: { id: 7 } } }]) {
      f.proof = proof
      const error = await refusal((bridge as any).ensureAttached(7)); assert.match(error.message, /^DEBUGGER_OWNER_UNVERIFIED:/)
      assert.equal(bridge.getConfig().attachedTabCount, 0)
    }
    assert.deepEqual(f.calls, { attach: 0, proof: 4, enable: 0, detach: 0 })
  })
})

test("#567 owned recovery retains full Page.enable sharing and external detach permits only a fresh normal attach", async () => {
  await scenario(async (bridge, f) => {
    f.holdEnable = true
    const first = (bridge as any).ensureAttached(7); await turn(); assert.equal(f.calls.enable, 1)
    let done = false; const late = (bridge as any).ensureAttached(7).then(() => { done = true })
    await turn(); assert.equal(done, false)
    f.release(); await Promise.all([first, late]); assert.equal(f.calls.proof, 1)
    f.onDetach({ tabId: 7 }); assert.equal(bridge.getConfig().attachedTabCount, 0)
    f.owner = "none"; f.targets = [{ tabId: 7, attached: false }]
    await (bridge as any).ensureAttached(7)
    assert.deepEqual(f.calls, { attach: 1, proof: 1, enable: 2, detach: 0 })
  })
})

test("#567 forbidden URL remains refused before native owner or attach work", async () => {
  await scenario(async (bridge, f) => {
    f.url = "chrome-extension://foreign/private"
    await refusal((bridge as any).ensureAttached(7))
    assert.deepEqual(f.calls, { attach: 0, proof: 0, enable: 0, detach: 0 })
  })
})
