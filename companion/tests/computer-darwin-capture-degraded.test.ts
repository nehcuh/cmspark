// P2 — capture variance classifier operator-audit contract tests.
//
// Pi v4.1 CONDITIONAL APPROVE constraint C4: when host.swift's cuScreenshot
// flags a frame as stale/blank and returns {ok:false, error_code:"CAPTURE_FAILED",
// capture_degraded:{...}}, the TS adapter MUST
//   (1) emit `logger.info("computer.capture.degraded", {...})` to the operator
//       audit channel with the classifier metrics, AND
//   (2) throw `ComputerError(CAPTURE_FAILED)` whose `.message` stays generic
//       (no metrics leak; LLM/tool surface never sees "degraded, please activate"
//       coaching that page content could teach the model to request), AND
//   (3) attach capture_degraded to ComputerError.detail for ops tooling that
//       introspects the typed error.
//
// Drives the pure `interpretScreenshotFailure(hwnd, parsed, sha256?)` helper
// directly — no binary spawn. mock.method replaces logger.info so we can assert
// the audit payload without depending on pino's sink.

import test, { mock } from "node:test"
import assert from "node:assert/strict"

import { interpretScreenshotFailure } from "../src/computer/darwin-adapters"
import { ComputerError } from "../src/computer/types"
import * as loggerMod from "../src/logger"

function freshPayload(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    ok: false,
    error: "capture variance classifier flagged stale/blank frame",
    error_code: "CAPTURE_FAILED",
    capture_degraded: {
      reason: "luma_stdev",
      stdev: 0.42,
      identity: -1.0,
      sizeBytes: 8421,
      imageWidth: 1058,
      imageHeight: 752,
      threshold: { stdev_lt: 1.0, identity_gte: 0.99, min_bytes: 1024, min_dim: 8 },
      prior_present: false,
      sha256: "abc123",
      ...overrides,
    },
  }
}

test("P2/C4: CAPTURE_FAILED emits computer.capture.degraded audit with full metrics", () => {
  const calls: { event: string; fields: Record<string, unknown> }[] = []
  const restore = mock.method(loggerMod.logger, "info", (event: string, fields?: Record<string, unknown>) => {
    calls.push({ event, fields: fields ?? {} })
  })
  try {
    const hwnd = 47
    const parsed = freshPayload()
    const err = interpretScreenshotFailure(hwnd, parsed)
    assert.equal(calls.length, 1, "exactly one audit event")
    assert.equal(calls[0].event, "computer.capture.degraded")
    assert.equal(calls[0].fields.windowId, 47)
    assert.equal(calls[0].fields.reason, "luma_stdev")
    assert.equal(calls[0].fields.stdev, 0.42)
    assert.equal(calls[0].fields.identity, -1.0)
    assert.equal(calls[0].fields.sizeBytes, 8421)
    assert.equal(calls[0].fields.sha256, "abc123")
    assert.equal(calls[0].fields.prior_present, false)
    assert.deepEqual(calls[0].fields.threshold, {
      stdev_lt: 1.0, identity_gte: 0.99, min_bytes: 1024, min_dim: 8,
    })
    assert.ok(err instanceof ComputerError)
    assert.equal(err.code, "CAPTURE_FAILED")
  } finally {
    restore.mock.restore()
  }
})

test("P2/C4: classifier metrics NEVER leak into LLM-facing error.message", () => {
  const restore = mock.method(loggerMod.logger, "info", () => {})
  try {
    const parsed = freshPayload({ stdev: 0.123, identity: 0.999, sizeBytes: 4096 })
    const err = interpretScreenshotFailure(47, parsed)
    // .message stays generic — no numeric metrics, no "degraded" coaching word
    assert.ok(!err.message.includes("0.123"), "stdev must not leak into .message")
    assert.ok(!err.message.includes("0.999"), "identity must not leak into .message")
    assert.ok(!err.message.includes("4096"), "sizeBytes must not leak into .message")
    assert.ok(!/degraded.*activate/i.test(err.message), "no 'degraded please activate' coaching")
    assert.ok(err.message.includes("screenshot:"), "label preserved")
  } finally {
    restore.mock.restore()
  }
})

test("P2/C4: ComputerError.detail carries capture_degraded for ops tooling", () => {
  const restore = mock.method(loggerMod.logger, "info", () => {})
  try {
    const parsed = freshPayload()
    const err = interpretScreenshotFailure(47, parsed)
    assert.ok(err.detail, "detail must be populated")
    assert.equal((err.detail as any).capture_degraded.reason, "luma_stdev")
    assert.equal((err.detail as any).capture_degraded.threshold.identity_gte, 0.99)
  } finally {
    restore.mock.restore()
  }
})

test("P2/C4: pixel_identity reason (prior exists) audit + typed error", () => {
  const calls: { event: string; fields: Record<string, unknown> }[] = []
  const restore = mock.method(loggerMod.logger, "info", (event: string, fields?: Record<string, unknown>) => {
    calls.push({ event, fields: fields ?? {} })
  })
  try {
    const parsed = freshPayload({
      reason: "pixel_identity",
      stdev: 0.05,
      identity: 0.998,
      prior_present: true,
    })
    const err = interpretScreenshotFailure(82, parsed)
    assert.equal(calls[0].fields.reason, "pixel_identity")
    assert.equal(calls[0].fields.prior_present, true)
    assert.equal(calls[0].fields.identity, 0.998)
    assert.equal(err.code, "CAPTURE_FAILED")
  } finally {
    restore.mock.restore()
  }
})

test("P2/C4: size_guard reason wins (0-byte PNG / 0-dim image)", () => {
  const calls: { event: string; fields: Record<string, unknown> }[] = []
  const restore = mock.method(loggerMod.logger, "info", (event: string, fields?: Record<string, unknown>) => {
    calls.push({ event, fields: fields ?? {} })
  })
  try {
    const parsed = freshPayload({
      reason: "size_guard",
      stdev: 0.0,
      identity: -1.0,
      sizeBytes: 0,
      imageWidth: 0,
      imageHeight: 0,
    })
    const err = interpretScreenshotFailure(99, parsed)
    assert.equal(calls[0].fields.reason, "size_guard")
    assert.equal(calls[0].fields.sizeBytes, 0)
    assert.equal(err.code, "CAPTURE_FAILED")
  } finally {
    restore.mock.restore()
  }
})

test("P2/C4: non-CAPTURE_FAILED errors do NOT emit capture.degraded audit", () => {
  const calls: { event: string; fields: Record<string, unknown> }[] = []
  const restore = mock.method(loggerMod.logger, "info", (event: string, fields?: Record<string, unknown>) => {
    calls.push({ event, fields: fields ?? {} })
  })
  try {
    const parsed = {
      ok: false,
      error: "ScreenCaptureKit permission denied",
      error_code: "PERMISSION_DENIED",
    }
    const err = interpretScreenshotFailure(47, parsed)
    assert.equal(calls.length, 0, "no audit for non-CAPTURE_FAILED")
    assert.equal(err.code, "PERMISSION_DENIED")
  } finally {
    restore.mock.restore()
  }
})

test("P2/C4: CAPTURE_FAILED without capture_degraded block still audits with reason=unknown", () => {
  const calls: { event: string; fields: Record<string, unknown> }[] = []
  const restore = mock.method(loggerMod.logger, "info", (event: string, fields?: Record<string, unknown>) => {
    calls.push({ event, fields: fields ?? {} })
  })
  try {
    // Older / buggy binary returns CAPTURE_FAILED but no metrics — must still
    // audit (defensive) and surface the typed code.
    const parsed = {
      ok: false,
      error: "capture failed",
      error_code: "CAPTURE_FAILED",
    }
    const err = interpretScreenshotFailure(7, parsed, "fallback-sha")
    assert.equal(calls.length, 1)
    assert.equal(calls[0].fields.reason, "unknown")
    assert.equal(calls[0].fields.sha256, "fallback-sha", "localSha256 fallback used")
    assert.equal(err.code, "CAPTURE_FAILED")
    assert.equal(err.detail, undefined, "no detail when metrics absent")
  } finally {
    restore.mock.restore()
  }
})

// Grok blocker 3: real host-shaped payload. host.swift (post-fix) emits a
// generic error string, but a future host regression could re-introduce the
// old shape with metrics in the error. The TS layer MUST override to generic
// regardless of what parsed.error says. This test locks that defense.
test("P2/C4 (Grok blocker 3): metrics in parsed.error are STRIPPED from .message (regression guard)", () => {
  const restore = mock.method(loggerMod.logger, "info", () => {})
  try {
    // Simulate the OLD host output (pre-fix) where metrics leak into error.
    // Also: capture_degraded present — proves metrics ride ONLY in detail/audit.
    const parsed = {
      ok: false,
      error: "capture variance classifier flagged stale/blank frame " +
        "(reason=luma_stdev, stdev=0.123, identity=0.456, sizeBytes=4096); " +
        "window may be occluded, minimized, or showing solid content",
      error_code: "CAPTURE_FAILED",
      capture_degraded: {
        reason: "luma_stdev",
        stdev: 0.123,
        identity: 0.456,
        sizeBytes: 4096,
        imageWidth: 1058,
        imageHeight: 752,
        threshold: { stdev_lt: 1.0, identity_gte: 0.99, min_bytes: 1024, min_dim: 8 },
        prior_present: false,
        sha256: "deadbeef",
      },
    }
    const err = interpretScreenshotFailure(47, parsed)
    // .message must NOT contain any of the leaked values
    assert.ok(!err.message.includes("0.123"), "stdev 0.123 must not leak (was in parsed.error)")
    assert.ok(!err.message.includes("0.456"), "identity 0.456 must not leak")
    assert.ok(!err.message.includes("4096"), "sizeBytes 4096 must not leak")
    assert.ok(!err.message.includes("luma_stdev"), "reason luma_stdev must not leak")
    assert.ok(!err.message.includes("stale/blank"), "host's verbose diagnostic must not leak")
    // .message IS the hardcoded generic
    assert.equal(err.message, "screenshot: stale or solid capture frame")
    // metrics still ride in detail
    assert.equal((err.detail as any).capture_degraded.stdev, 0.123)
  } finally {
    restore.mock.restore()
  }
})
