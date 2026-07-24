// WP2 (Y7): InjectionRateLimiter window math — pure fake-clock tests.
// Locked contract: the 60s trailing window prunes stamps strictly older
// than now-60000; the session total never prunes; saturation at >= 30 in
// the window refuses NEW tasks (the human gate additionally sees the
// status line via buildComputerL2Preview extraLines).

import test from "node:test"
import assert from "node:assert/strict"

import { InjectionRateLimiter, RATE_LIMIT_MAX_IN_WINDOW, RATE_LIMIT_WINDOW_MS } from "../src/computer/rate-limit"

function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

test("rate limiter: countInWindow prunes stamps older than the window", () => {
  const c = clock()
  const rl = new InjectionRateLimiter(c.now, 60_000, 30)
  rl.record(5)
  assert.equal(rl.countInWindow(), 5)
  c.advance(30_000)
  rl.record(3)
  assert.equal(rl.countInWindow(), 8, "both batches inside the window")
  c.advance(30_001) // first batch is now strictly older than 60s
  assert.equal(rl.countInWindow(), 3, "first batch pruned")
})

test("rate limiter: boundary — a stamp exactly 60s old is OUTSIDE the window", () => {
  const c = clock()
  const rl = new InjectionRateLimiter(c.now, 60_000, 30)
  rl.record(1)
  c.advance(60_000)
  assert.equal(rl.countInWindow(), 0, "<= cutoff is pruned (trailing window)")
})

test("rate limiter: totalApproved never prunes", () => {
  const c = clock()
  const rl = new InjectionRateLimiter(c.now, 60_000, 30)
  rl.record(10)
  c.advance(120_000)
  rl.record(2)
  assert.equal(rl.countInWindow(), 2)
  assert.equal(rl.totalApproved(), 12)
})

test("rate limiter: saturated at >= maxInWindow, drains as the window slides", () => {
  const c = clock()
  const rl = new InjectionRateLimiter(c.now, 60_000, 3)
  rl.record(2)
  assert.equal(rl.saturated(), false)
  rl.record(1)
  assert.equal(rl.saturated(), true)
  c.advance(60_001)
  assert.equal(rl.saturated(), false)
})

test("rate limiter: defaults are the plan values (60s / 30)", () => {
  assert.equal(RATE_LIMIT_WINDOW_MS, 60_000)
  assert.equal(RATE_LIMIT_MAX_IN_WINDOW, 30)
})

test("rate limiter: status line carries both counters", () => {
  const c = clock()
  const rl = new InjectionRateLimiter(c.now)
  rl.record(7)
  assert.equal(rl.statusLine(), "本会话累计已批准注入 7；近 60 秒已注入 7/30")
})
