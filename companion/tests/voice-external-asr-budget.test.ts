import assert from "node:assert/strict"
import test from "node:test"
import {
  externalStopDecision,
  externalUiWaitMs,
  factoryExternalBudget,
  validateExternalBudget,
} from "../src/voice/external-asr-budget"

test("deepseek factory is 120s and 8 MiB, and higher values fail closed", () => {
  const factory = factoryExternalBudget("deepseek", "deepseek-docs")
  assert.deepEqual(factory, { maxDurationMs: 120000, maxBytes: 8388608, requestTimeoutMs: 180000 })
  assert.equal(validateExternalBudget({ style: "deepseek", limitNote: "deepseek-docs", maxDurationMs: 120001, maxBytes: 8388608, requestTimeoutMs: 180000 }).ok, false)
  assert.equal(validateExternalBudget({ style: "deepseek", limitNote: "deepseek-docs", maxDurationMs: 120000, maxBytes: 8388609, requestTimeoutMs: 180000 }).ok, false)
})

test("openai official file cap has no duration, and 25MB is decimal", () => {
  const factory = factoryExternalBudget("openai", "openai-file-cap")
  assert.equal(factory.maxDurationMs, null)
  assert.equal(factory.maxBytes, 25000000)
  assert.equal(validateExternalBudget({ style: "openai", limitNote: "openai-file-cap", ...factory, maxBytes: 25000001 }).ok, false)
})

test("unprobed default is not a probed provider cap and cannot exceed the memory guard", () => {
  const factory = factoryExternalBudget("openai", "unprobed-local-default")
  assert.equal(factory.maxBytes, 25000000)
  assert.equal(factory.maxDurationMs, null)
  assert.equal(validateExternalBudget({ style: "openai", limitNote: "unprobed-local-default", maxDurationMs: null, maxBytes: 33554432, requestTimeoutMs: 180000 }).ok, true)
  assert.equal(validateExternalBudget({ style: "openai", limitNote: "unprobed-local-default", maxDurationMs: null, maxBytes: 33554433, requestTimeoutMs: 180000 }).ok, false)
})

test("already over maxBytes is trimmed to the aligned cap", () => {
  const stop = externalStopDecision({
    committedWavBytes: 25000001,
    candidatePcmBytes: 100,
    maxDurationMs: null,
    maxBytes: 25000000,
  })
  assert.equal(stop.reason, "bytes")
  assert.equal(stop.keepBytes, 25000000)
  assert.ok(stop.keepBytes <= 25000000)
})

test("one chunk that crosses duration and size keeps the tighter aligned prefix", () => {
  const stop = externalStopDecision({
    committedWavBytes: 44,
    candidatePcmBytes: 100000,
    maxDurationMs: 1000,
    maxBytes: 32100,
  })
  assert.equal(stop.reason, "both")
  assert.equal(stop.keepBytes, 32044)
  assert.ok(stop.keepBytes <= 32100)
  assert.equal((stop.keepBytes - 44) % 2, 0)
})

test("odd size cap keeps an even PCM payload", () => {
  const stop = externalStopDecision({
    committedWavBytes: 44,
    candidatePcmBytes: 5,
    maxDurationMs: null,
    maxBytes: 47,
  })
  assert.equal(stop.reason, "bytes")
  assert.equal(stop.keepBytes, 46)
})

test("120s wav is inside the DeepSeek caps and is not the old 2500000 session limit", () => {
  const wav = 44 + 120 * 32000
  assert.equal(wav, 3840044)
  assert.ok(wav > 2500000)
  const held = externalStopDecision({
    committedWavBytes: wav,
    candidatePcmBytes: 0,
    maxDurationMs: 120000,
    maxBytes: 8388608,
  })
  assert.equal(held.reason, "none")
  assert.equal(held.keepBytes, 3840044)
  const next = externalStopDecision({
    committedWavBytes: wav,
    candidatePcmBytes: 2,
    maxDurationMs: 120000,
    maxBytes: 8388608,
  })
  assert.equal(next.reason, "duration")
  assert.equal(next.keepBytes, 3840044)
})

test("25MB and 32MiB boundaries do not grow past the cap", () => {
  for (const maxBytes of [25000000, 33554432]) {
    const stop = externalStopDecision({
      committedWavBytes: maxBytes,
      candidatePcmBytes: 2,
      maxDurationMs: null,
      maxBytes,
    })
    assert.equal(stop.reason, "bytes")
    assert.ok(stop.keepBytes <= maxBytes)
    assert.equal((stop.keepBytes - 44) % 2, 0)
  }
})

test("ui wait is the request timeout plus 10s", () => {
  assert.equal(externalUiWaitMs(180000), 190000)
  assert.equal(validateExternalBudget({ style: "deepseek", limitNote: "deepseek-docs", maxDurationMs: 120000, maxBytes: 8388608, requestTimeoutMs: 29999 }).ok, false)
  assert.equal(validateExternalBudget({ style: "openai", limitNote: "unprobed-local-default", maxDurationMs: null, maxBytes: 25000000, requestTimeoutMs: 600001 }).ok, false)
})
