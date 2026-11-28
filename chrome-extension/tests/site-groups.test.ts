import assert from "node:assert/strict"
import test from "node:test"
import { groupBySite, watchCurrentTabHostname } from "../src/sidepanel/hooks/useSiteGroups"

test("site views preserve global and item order and prioritize DNS matches", () => {
  const items = [
    { name: "one" }, { site: "aaaa.test", name: "unrelated" },
    { site: "*.EXAMPLE.org.", name: "wildcard" }, { name: "two" },
    { site: "example.org", name: "exact" }, { site: "*.EXAMPLE.org.", name: "second" },
  ]
  const names = (host: string) => groupBySite(items, host).map(([, group]) => group.map(row => row.name))
  assert.deepEqual(names("EXAMPLE.ORG."), [["one", "two"], ["wildcard", "second"], ["exact"], ["unrelated"]])
  assert.deepEqual(names("sub.example.org"), [["one", "two"], ["wildcard", "second"], ["unrelated"], ["exact"]])
  const wildcards = [{ site: "*.aa.test" }, { site: "*.ZZ.test." }]
  const sites = (hostname: string) => groupBySite(wildcards, hostname).map(([site]) => site)
  assert.deepEqual(sites("sub.zz.test"), ["*.ZZ.test.", "*.aa.test"])
  assert.deepEqual(sites("zz.test"), ["*.ZZ.test.", "*.aa.test"])
  assert.deepEqual(sites("notzz.test"), ["*.aa.test", "*.ZZ.test."])
  assert.deepEqual(groupBySite([], ""), [])
})

test("site view follows its window, ignores obsolete queries and releases listeners", () => {
  const pending: Array<(tabs: Array<{ url?: string }>) => void> = []
  function event<T extends (...args: any[]) => void>() {
    const listeners = new Set<T>()
    return {
      addListener: (fn: T) => listeners.add(fn),
      removeListener: (fn: T) => listeners.delete(fn),
      fire: (...args: Parameters<T>) => { for (const fn of listeners) fn(...args) },
      listeners,
    }
  }
  const onActivated = event<() => void>()
  const onUpdated = event<(id: number, info: { url?: string }, tab: { active: boolean }) => void>()
  const runtime: { lastError?: { message: string } } = {}
  const oldChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome")
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
    runtime, tabs: { onActivated, onUpdated, query(scope: unknown, cb: typeof pending[number]) {
      assert.deepEqual(scope, { active: true, currentWindow: true })
      pending.push(cb)
    } },
  } })
  try {
    const seen: string[] = []
    const stop = watchCurrentTabHostname(host => seen.push(host))
    onActivated.fire()
    pending[1]!([{ url: "https://current.test/page" }])
    pending[0]!([{ url: "https://old.test/" }])
    onUpdated.fire(2, { url: "https://background.test/" }, { active: false })
    assert.equal(pending.length, 2)
    onUpdated.fire(1, { url: "https://new.test" }, { active: true })
    pending[2]!([{ url: "https://new.test" }])
    onActivated.fire()
    pending[3]!([{}])
    onActivated.fire()
    runtime.lastError = { message: "window closed" }
    pending[4]!([])
    delete runtime.lastError
    onActivated.fire()
    stop()
    pending[5]!([{ url: "https://closed.test/" }])
    assert.deepEqual(seen, ["current.test", "new.test", "", ""])
    assert.equal(onActivated.listeners.size + onUpdated.listeners.size, 0)
  } finally {
    if (oldChrome) Object.defineProperty(globalThis, "chrome", oldChrome)
    else Reflect.deleteProperty(globalThis, "chrome")
  }
})
