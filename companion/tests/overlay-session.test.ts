import test from "node:test"
import assert from "node:assert/strict"
import {
  beginOverlaySession,
  invalidateOverlaySession,
  overlaySessionIsLive,
  hydrateOverlayIfLive,
  claimOverlayIfLive,
  currentOverlaySession,
  shouldReclaimLiveOverlayThread,
  type OverlayLeaseState,
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
      return { ok: true, rev: 1 }
    },
    releaseClaimedLease: async () => {},
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
      return { ok: true, rev: 1 }
    },
    releaseClaimedLease: async () => {},
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
    releaseClaimedLease: async () => {
      assert.fail("failed claim must not self-release")
    },
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
    claimLease: async () => ({ ok: true, rev: 1 }),
    releaseClaimedLease: async () => {
      assert.fail("live session must not self-release")
    },
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
      return { ok: true, rev: 1 }
    },
    releaseClaim: async () => {},
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

// Semantics change: a stale claim while a NEWER overlay session is live used
// to just return "abandoned" — leaking its own fresh lease AND leaving the
// newer session's thread demoted (the claim atomically released it as a
// sibling). Now the stale claim must (a) CAS-release ONLY the lease it just
// took (never releaseAll — that would kill the live session's hold), and
// (b) report the demoted siblings so the caller can re-claim the live thread.
test("stale claim releases only its own lease and reports demoted siblings (never releaseAll)", async () => {
  invalidateOverlaySession()
  const first = beginOverlaySession()
  let releaseAll = 0
  const selfReleased: Array<{ id: string; rev: number }> = []
  let reported: OverlayLeaseState[] | undefined
  let newer = 0
  const result = await hydrateOverlayIfLive({
    id: "old",
    token: first,
    selectMessages: async () => [{ role: "user", content: "x" }],
    applyHydrate: () => {},
    claimLease: async () => {
      // A newer overlay session goes live while this claim is in flight.
      newer = beginOverlaySession()
      return {
        ok: true,
        rev: 3,
        released_siblings: [{ thread_id: "live-thread", holder: "panel", rev: 2 }],
      }
    },
    releaseClaimedLease: async (id, rev) => {
      selfReleased.push({ id, rev })
    },
    releaseAllLeases: async () => {
      releaseAll += 1
    },
    onStaleClaim: (siblings) => {
      reported = siblings
    },
  })
  assert.equal(result, "abandoned")
  // (a) released exactly its own claim, via the claim rev — not releaseAll
  assert.deepEqual(selfReleased, [{ id: "old", rev: 3 }])
  assert.equal(releaseAll, 0)
  // (b) the demoted sibling (live session's thread) is reported for repair
  assert.deepEqual(reported, [{ thread_id: "live-thread", holder: "panel", rev: 2 }])
  assert.equal(overlaySessionIsLive(newer), true)
})

test("stale claim without a rev skips self-release but still reports siblings", async () => {
  invalidateOverlaySession()
  const first = beginOverlaySession()
  let selfReleased = 0
  let reported = 0
  const result = await hydrateOverlayIfLive({
    id: "old",
    token: first,
    selectMessages: async () => [{ role: "user", content: "x" }],
    applyHydrate: () => {},
    claimLease: async () => {
      beginOverlaySession() // newer session goes live mid-claim
      return {
        ok: true,
        released_siblings: [{ thread_id: "live-thread", holder: "panel", rev: 2 }],
      }
    },
    releaseClaimedLease: async () => {
      selfReleased += 1
    },
    releaseAllLeases: async () => {
      assert.fail("newer session live: must not releaseAll")
    },
    onStaleClaim: () => {
      reported += 1
    },
  })
  assert.equal(result, "abandoned")
  assert.equal(selfReleased, 0)
  assert.equal(reported, 1)
})

test("claimOverlayIfLive stale-with-live self-releases and reports; closed path still releaseAll", async () => {
  invalidateOverlaySession()
  const token = beginOverlaySession()
  const selfReleased: number[] = []
  let reported: OverlayLeaseState[] | undefined
  let releaseAll = 0
  const ok = await claimOverlayIfLive({
    token,
    claim: async () => {
      beginOverlaySession() // newer session goes live mid-claim
      return {
        ok: true,
        rev: 5,
        released_siblings: [{ thread_id: "live-thread", holder: "panel", rev: 4 }],
      }
    },
    releaseClaim: async (rev) => {
      selfReleased.push(rev)
    },
    releaseAll: async () => {
      releaseAll += 1
    },
    onStaleClaim: (siblings) => {
      reported = siblings
    },
  })
  assert.equal(ok, false)
  assert.deepEqual(selfReleased, [5])
  assert.equal(releaseAll, 0)
  assert.deepEqual(reported, [{ thread_id: "live-thread", holder: "panel", rev: 4 }])
})

test("shouldReclaimLiveOverlayThread no-ops after beginOverlaySession (lagged thread id)", () => {
  invalidateOverlaySession()
  const liveToken = beginOverlaySession()
  const siblings: OverlayLeaseState[] = [{ thread_id: "A", holder: "panel", rev: 2 }]
  assert.equal(
    shouldReclaimLiveOverlayThread({ liveThreadId: "A", liveSessionToken: liveToken, siblings }),
    true,
    "bound token still live → reclaim the demoted live thread",
  )
  beginOverlaySession()
  assert.equal(
    shouldReclaimLiveOverlayThread({ liveThreadId: "A", liveSessionToken: liveToken, siblings }),
    false,
    "new overlay session must not exclusive-claim lagged A (would demote C)",
  )
})

test("shouldReclaimLiveOverlayThread ignores siblings that are not the bound thread", () => {
  invalidateOverlaySession()
  const token = beginOverlaySession()
  assert.equal(
    shouldReclaimLiveOverlayThread({
      liveThreadId: "C",
      liveSessionToken: token,
      siblings: [{ thread_id: "A", holder: "panel", rev: 1 }],
    }),
    false,
  )
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
      return { ok: true, rev: 1 }
    },
    releaseClaim: async () => {
      assert.fail("closed (no live session): releaseAll covers the self-release")
    },
    releaseAll: async () => {
      released += 1
    },
  })
  assert.equal(ok, false)
  assert.equal(claimed, 1)
  assert.equal(released, 1)
})
