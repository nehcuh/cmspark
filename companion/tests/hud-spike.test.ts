import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  isHudSpikeEnabled,
  buildSpikeHydrate,
  HUD_SPIKE_THREAD_ID,
  HUD_SPIKE_TASK_ID,
  HUD_SPIKE_ENV,
} from "../src/hud/spike"

describe("hud spike helpers", () => {
  it("isHudSpikeEnabled reads CMSPARK_HUD_SPIKE=1", () => {
    const prev = process.env[HUD_SPIKE_ENV]
    try {
      delete process.env[HUD_SPIKE_ENV]
      assert.equal(isHudSpikeEnabled(), false)
      process.env[HUD_SPIKE_ENV] = "1"
      assert.equal(isHudSpikeEnabled(), true)
      process.env[HUD_SPIKE_ENV] = "0"
      assert.equal(isHudSpikeEnabled(), false)
    } finally {
      if (prev === undefined) delete process.env[HUD_SPIKE_ENV]
      else process.env[HUD_SPIKE_ENV] = prev
    }
  })

  it("buildSpikeHydrate has empty dual_track and running task", () => {
    const h = buildSpikeHydrate("connected")
    assert.equal(h.thread_id, HUD_SPIKE_THREAD_ID)
    assert.equal(h.shell, "hud")
    assert.equal(h.connection, "connected")
    assert.equal(h.pending_confirmations.length, 0)
    assert.equal(h.task?.task_id, HUD_SPIKE_TASK_ID)
    assert.equal(h.task?.status, "running")
    assert.deepEqual(h.dual_track, { conclusions: [], steps: [] })
  })
})
