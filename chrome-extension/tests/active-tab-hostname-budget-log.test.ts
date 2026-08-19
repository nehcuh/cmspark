// L8: a hung tabs.query must not silently lose the site-knowledge hostname —
// the budget drop emits one debug log via the local log fan-out channel.
import test from "node:test"
import assert from "node:assert/strict"
import { withHostnameBudget } from "../src/background/active-tab-hostname"

function stubChromeSendMessage(sent: unknown[]) {
  ;(globalThis as any).chrome = {
    runtime: {
      sendMessage: (payload: unknown) => {
        sent.push(payload)
        return Promise.resolve()
      },
    },
  }
}

function restoreChrome() {
  delete (globalThis as any).chrome
}

test("withHostnameBudget budget drop logs a debug via local fan-out", async () => {
  const sent: unknown[] = []
  stubChromeSendMessage(sent)
  try {
    const h = await withHostnameBudget(
      () => new Promise<string>(() => { /* never settle */ }),
      10,
    )
    assert.equal(h, undefined)
    assert.equal(sent.length, 1)
    const payload = sent[0] as any
    assert.equal(payload.type, "log.event")
    assert.equal(payload.source, "extension")
    assert.equal(payload.level, "debug")
    assert.equal(payload.event, "extension.hostname_budget_exceeded")
    assert.equal(payload.data.budget_ms, 10)
  } finally {
    restoreChrome()
  }
})

test("withHostnameBudget fast path resolves without logging", async () => {
  const sent: unknown[] = []
  stubChromeSendMessage(sent)
  try {
    const h = await withHostnameBudget(async () => "intranet.example", 80)
    assert.equal(h, "intranet.example")
    assert.equal(sent.length, 0)
  } finally {
    restoreChrome()
  }
})

test("withHostnameBudget missing chrome env still resolves (no throw)", async () => {
  restoreChrome()
  const h = await withHostnameBudget(
    () => new Promise<string>(() => { /* never settle */ }),
    10,
  )
  assert.equal(h, undefined)
})
