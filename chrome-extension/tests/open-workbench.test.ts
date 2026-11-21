import test from "node:test"
import assert from "node:assert/strict"
import { openWorkbench } from "../src/sidepanel/navigation/open-workbench"

test("reopening the workbench focuses its existing tab and preserves the live document", async () => {
  const base = "chrome-extension://owned/tabs/workspace.html"
  let updated: { active: boolean; url: string } | undefined
  let focused: number | undefined
  const restore = ["chrome", "window", "navigator"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { pathname: "/sidepanel.html" } } })
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request: (_: string, run: () => Promise<void>) => run() } } })
    Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
      runtime: { getURL: () => base },
      tabs: {
        query: async () => [{ id: 41, windowId: 8, url: base + "?view=activity#recording" }],
        update: async (id: number, update: typeof updated) => { assert.equal(id, 41); updated = update },
        create: () => assert.fail("second workspace opened"),
      },
      windows: { update: async (id: number) => { focused = id } },
    } })
    assert.equal(await openWorkbench("meeting"), true)
    assert.equal(updated?.active, true)
    const url = new URL(updated!.url)
    assert.match(url.hash, /^#meeting\//)
    url.hash = ""
    assert.equal(url.href, base + "?view=activity")
    assert.equal(focused, 8)
  } finally {
    for (const [key, descriptor] of restore) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
