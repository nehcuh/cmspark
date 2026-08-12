import test from "node:test"
import assert from "node:assert/strict"
import {
  isSnapshotFresh,
  isThreadGraphTabUrl,
  slimThreadGraphRow,
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

test("slimThreadGraphRow drops unknown keys / message bodies", () => {
  const slim = slimThreadGraphRow({
    id: "t1",
    alias: "hello",
    workspace_root: "/secret",
    first_user_preview: "should not leak",
    messages: [{ role: "user", content: "nope" }],
    digest: {
      tldr: "ok",
      tags: ["a", 1, "b"],
      bullets: ["x"],
      secret_field: "drop",
      stale: true,
    },
    agent_role: "normal",
  })
  assert.ok(slim)
  assert.equal(slim!.id, "t1")
  assert.equal(slim!.alias, "hello")
  assert.equal((slim as any).workspace_root, undefined)
  assert.equal((slim as any).first_user_preview, undefined)
  assert.equal((slim as any).messages, undefined)
  assert.deepEqual(slim!.digest?.tags, ["a", "b"])
  assert.equal((slim!.digest as any).secret_field, undefined)
  assert.equal(slim!.digest?.stale, true)
  assert.equal(slimThreadGraphRow({}), null)
  assert.equal(slimThreadGraphRow(null), null)
})
