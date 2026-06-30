import { test } from "node:test"
import * as assert from "node:assert/strict"

import { handleMessage } from "../src/message-router"

// Lightweight router-level tests for the P3 summary scope's deterministic (LLM-free) paths.
// The export/summary handlers only touch threadManager, so a minimal fake services suffices.
// We exercise the wiring (scope allowlist, thread lookup, summary-branch entry, the too-short
// guard) without a real LLM: summarizeThread returns null before calling llmExtract when the
// thread has < MIN_TURNS user/assistant turns.

function fakeServices(thread: any, messages: any[]): any {
  return {
    threadManager: {
      get: () => thread,
      getMessages: () => messages,
    },
  }
}

test("router summary: thread not found → error", async () => {
  const r = await handleMessage(
    { type: "thread.export_obsidian", thread_id: "nope", scope: "summary" },
    fakeServices(undefined, []),
  )
  assert.equal(r.type, "error")
  assert.match(r.error, /thread not found/)
})

test("router summary: invalid scope → error", async () => {
  const r = await handleMessage(
    { type: "thread.export_obsidian", thread_id: "t1", scope: "bogus" },
    fakeServices({ id: "t1", alias: "A", created_at: "x", updated_at: "x" }, []),
  )
  assert.equal(r.type, "error")
  assert.match(r.error, /invalid scope/)
})

test("router summary: summary needs no anchor (unlike single/qa_pair)", async () => {
  // A summary with no anchor_message_id must NOT be rejected for missing anchor — it should
  // proceed to the summary branch (here returning the too-short error since the thread is tiny).
  const r = await handleMessage(
    { type: "thread.export_obsidian", thread_id: "t1", scope: "summary" },
    fakeServices(
      { id: "t1", alias: "A", created_at: "x", updated_at: "x" },
      [
        { id: "u1", role: "user", content: "hi" },
        { id: "a1", role: "assistant", content: "hey" },
      ],
    ),
  )
  assert.equal(r.type, "error")
  // Reached the summary branch (not the anchor guard): error is the too-short / no-summary one.
  assert.doesNotMatch(r.error, /anchor_message_id/, "summary scope must not require an anchor")
})

test("router summary: too-short thread → error, no LLM call (deterministic)", async () => {
  // < MIN_TURNS user/assistant turns → buildSummaryTranscript returns null → summarizeThread
  // returns null WITHOUT calling the LLM → handler reports the too-short error.
  const r = await handleMessage(
    { type: "thread.export_obsidian", thread_id: "t1", scope: "summary" },
    fakeServices(
      { id: "t1", alias: "A", created_at: "x", updated_at: "x" },
      [
        { id: "u1", role: "user", content: "q" },
        { id: "a1", role: "assistant", content: "a" },
        { id: "u2", role: "user", content: "q2" },
      ],
    ),
  )
  assert.equal(r.type, "error")
  assert.match(r.error, /太短|未返回|摘要/)
})
