import test from "node:test"
import assert from "node:assert/strict"
import { projectCopy } from "../src/sidepanel/navigation/project-copy"
import { RESIDENT_MIN_WIDTH, navigationMode } from "../src/sidepanel/navigation/navigation-mode"
import { commitStartupNavigation, decideActiveThreadList } from "../src/sidepanel/navigation/startup-destination"

test("a stale startup callback does not clear or select", () => {
  const decision = commitStartupNavigation({ commitGeneration: 1, currentGeneration: 2, rememberedThreadId: "older", threads: [{ id: "newer", trashed_at: null }], activeThreadId: "newer", connection: "connected", listArrived: true })
  assert.deepEqual(decision, { ignored: true, reason: "stale-generation" })
})

test("project home clears the active thread and does not select", () => {
  const missing = commitStartupNavigation({ commitGeneration: 1, currentGeneration: 1, rememberedThreadId: null, threads: [{ id: "newer", trashed_at: null }], activeThreadId: null, connection: "connected", listArrived: true })
  assert.equal(missing.ignored, false)
  if (!missing.ignored) {
    assert.equal(missing.layer, "projects")
    assert.equal(missing.activeThreadId, null)
    assert.equal(missing.selectThread, false)
    assert.equal(missing.homeCopy, projectCopy.restoreNone)
  }
  const invalid = commitStartupNavigation({ commitGeneration: 1, currentGeneration: 1, rememberedThreadId: "gone", threads: [], activeThreadId: "newer", connection: "connected", listArrived: true })
  if (!invalid.ignored) {
    assert.equal(invalid.homeCopy, projectCopy.restoreInvalid)
    assert.equal(invalid.activeThreadId, null)
    assert.equal(invalid.selectThread, false)
  }
})

test("disconnect and connecting keep a remembered session", () => {
  for (const connection of ["disconnected", "connecting"] as const) {
    const decision = commitStartupNavigation({ commitGeneration: 1, currentGeneration: 1, rememberedThreadId: "older", threads: [], activeThreadId: null, connection, listArrived: false })
    assert.equal(decision.ignored, false)
    if (!decision.ignored) {
      assert.equal(decision.layer, "session")
      assert.equal(decision.homeCopy, null)
      assert.equal(decision.selectThread, false)
      assert.equal(decision.remembered, "older")
    }
  }
})

test("a connected cold start keeps the remembered id until the list arrives", () => {
  const decision = commitStartupNavigation({ commitGeneration: 1, currentGeneration: 1, rememberedThreadId: "older", threads: [], activeThreadId: null, connection: "connected", listArrived: false })
  assert.equal(decision.ignored, false)
  if (!decision.ignored) {
    assert.equal(decision.layer, "session")
    assert.equal(decision.activeThreadId, "older")
    assert.equal(decision.remembered, "older")
    assert.equal(decision.selectThread, false)
    assert.equal(decision.homeCopy, null)
  }
})

test("an empty active list does not create or select the first row", () => {
  const incoming = [{ id: "newer", trashed_at: null }]
  const empty = decideActiveThreadList({ activeThreadId: null, rememberedThreadId: null, incoming: [], listScope: "active" })
  assert.equal(empty.createBlank, false)
  assert.equal(empty.selectIncomingFirst, false)
  assert.equal(empty.activeThreadId, null)
  assert.equal(empty.selectThread, false)
  assert.equal(empty.homeCopy, projectCopy.restoreNone)
  const populated = decideActiveThreadList({ activeThreadId: null, rememberedThreadId: null, incoming, listScope: "active" })
  assert.equal(populated.createBlank, false)
  assert.equal(populated.selectIncomingFirst, false)
  assert.equal(populated.selectThread, false)
  assert.equal(populated.activeThreadId, null)
  assert.notStrictEqual(populated.activeThreadId, incoming[0].id)
})

test("resident navigation starts at 960 on every surface", () => {
  assert.equal(RESIDENT_MIN_WIDTH, 960)
  for (const surface of ["sidepanel", "popout", "workspace"] as const) {
    for (const innerWidth of [320, 400, 759]) assert.equal(navigationMode({ surface, innerWidth }), "layered")
    for (const innerWidth of [960, 1200]) assert.equal(navigationMode({ surface, innerWidth }), "resident")
  }
})
