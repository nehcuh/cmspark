import test from "node:test"
import assert from "node:assert/strict"
import {
  isSnapshotFresh,
  isThreadGraphTabUrl,
  THREAD_GRAPH_PATH,
  type ThreadGraphSnapshot,
} from "../src/background/thread-graph"

test("THREAD_GRAPH_PATH is plasmo tab html", () => {
  assert.equal(THREAD_GRAPH_PATH, "tabs/thread-graph.html")
})

test("isThreadGraphTabUrl matches graph tab", () => {
  const base = "chrome-extension://abc/tabs/thread-graph.html"
  assert.equal(isThreadGraphTabUrl(base, base), true)
  assert.equal(isThreadGraphTabUrl(base + "?focus=x", base), true)
  assert.equal(isThreadGraphTabUrl("chrome-extension://abc/tabs/cockpit.html", base), false)
})

test("isSnapshotFresh: TTL 5 minutes", () => {
  const snap: ThreadGraphSnapshot = { ts: Date.now() - 60_000, threads: [] }
  assert.equal(isSnapshotFresh(snap), true)
  const stale: ThreadGraphSnapshot = { ts: Date.now() - 6 * 60_000, threads: [] }
  assert.equal(isSnapshotFresh(stale), false)
  assert.equal(isSnapshotFresh(null), false)
})
