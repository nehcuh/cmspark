import test from "node:test"
import assert from "node:assert/strict"
import {
  beginOverlaySession,
  invalidateOverlaySession,
  overlaySessionIsLive,
  hydrateOverlayIfLive,
  claimOverlayIfLive,
  currentOverlaySession,
} from "../src/summoner/overlay-session"

test("close during thread.select does not claim overlay lease", async () => {
  invalidateOverlaySession()
  const token = beginOverlaySession()
  let claimed = false
  const result = await hydrateOverlayIfLive({
    id: "t2",
    token,
    selectMessages: async () => {
      invalidateOverlaySession()
      return [{ role: "user", content: "hi" }]
    },
    applyHydrate: () => {
      assert.fail("must not hydrate a closed overlay")
    },
    claimLease: async () => {
      claimed = true
    },
    releaseAllLeases: async () => {},
  })
  assert.equal(result, "abandoned")
  assert.equal(claimed, false)
  assert.equal(overlaySessionIsLive(token), false)
})

test("close during claim releases the overlay lease it just took", async () => {
  invalidateOverlaySession()
  const token = beginOverlaySession()
  let claimed = 0
  let released = 0
  const result = await hydrateOverlayIfLive({
    id: "t2",
    token,
    selectMessages: async () => [{ role: "user", content: "hi" }],
    applyHydrate: () => {},
    claimLease: async () => {
      claimed += 1
      invalidateOverlaySession()
    },
    releaseAllLeases: async () => {
      released += 1
    },
  })
  assert.equal(result, "abandoned")
  assert.equal(claimed, 1)
  assert.equal(released, 1)
})

test("hydrateOverlayIfLive abandons when claimLease returns false", async () => {
  invalidateOverlaySession()
  const token = beginOverlaySession()
  const result = await hydrateOverlayIfLive({
    id: "t1",
    token,
    selectMessages: async () => [{ role: "user", content: "x" }],
    applyHydrate: () => {},
    claimLease: async () => false,
    releaseAllLeases: async () => {
      assert.fail("failed claim must not releaseAll")
    },
  })
  assert.equal(result, "abandoned")
})

test("live hydrate claims once", async () => {
  invalidateOverlaySession()
  const token = beginOverlaySession()
  const hydrates: string[] = []
  const result = await hydrateOverlayIfLive({
    id: "t1",
    token,
    selectMessages: async () => [{ role: "user", content: "keep" }],
    applyHydrate: (id) => {
      hydrates.push(id)
    },
    claimLease: async () => {},
    releaseAllLeases: async () => {
      assert.fail("live session must not release")
    },
  })
  assert.equal(result, "claimed")
  assert.deepEqual(hydrates, ["t1"])
  assert.equal(overlaySessionIsLive(token), true)
})

test("second beginOverlaySession invalidates the first in-flight hydrate", async () => {
  invalidateOverlaySession()
  const first = beginOverlaySession()
  const second = beginOverlaySession()
  assert.equal(overlaySessionIsLive(first), false)
  assert.equal(overlaySessionIsLive(second), true)
})

test("submit-style claimOverlayIfLive no-ops after close", async () => {
  invalidateOverlaySession()
  const token = currentOverlaySession()
  invalidateOverlaySession()
  let claimed = false
  const ok = await claimOverlayIfLive({
    token,
    claim: async () => {
      claimed = true
    },
    releaseAll: async () => {},
  })
  assert.equal(ok, false)
  assert.equal(claimed, false)
})

test("after close, currentOverlaySession token is not live", () => {
  beginOverlaySession()
  invalidateOverlaySession()
  assert.equal(overlaySessionIsLive(currentOverlaySession()), false)
})

test("stale hydrate does not releaseAll while a newer overlay session is live", async () => {
  invalidateOverlaySession()
  const first = beginOverlaySession()
  let released = 0
  const newer = beginOverlaySession()
  const result = await hydrateOverlayIfLive({
    id: "old",
    token: first,
    selectMessages: async () => [{ role: "user", content: "x" }],
    applyHydrate: () => {
      assert.fail("stale token must not hydrate")
    },
    claimLease: async () => {},
    releaseAllLeases: async () => {
      released += 1
    },
  })
  assert.equal(result, "abandoned")
  assert.equal(released, 0)
  assert.equal(overlaySessionIsLive(newer), true)
})

test("claimOverlayIfLive close-during-claim releases", async () => {
  invalidateOverlaySession()
  const token = beginOverlaySession()
  let claimed = 0
  let released = 0
  const ok = await claimOverlayIfLive({
    token,
    claim: async () => {
      claimed += 1
      invalidateOverlaySession()
    },
    releaseAll: async () => {
      released += 1
    },
  })
  assert.equal(ok, false)
  assert.equal(claimed, 1)
  assert.equal(released, 1)
})
