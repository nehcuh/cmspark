/**
 * #505 — unarmed 100-round cap is a visible, non-tombstone hint.
 *
 * Companion (other agent) stamps chat.done.terminal = "round_limit" without
 * finish_reason. UI stores it per-thread and renders only when this thread
 * has no loop-status view (armed threads already have the status row).
 */
import { mountPanel } from "./helpers/mount-sidepanel"
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  ROUND_LIMIT_UNARMED_COPY,
  shouldShowRoundLimitHint,
  backfillLoopView,
} from "../src/sidepanel/components/LoopStatusRow"
import type { LoopStatusView, Thread } from "../src/sidepanel/types"

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

const LOOP_VIEW: LoopStatusView = {
  phase: "advancing",
  label: "推进中 1/2",
  detail: "",
  done: 1,
  total: 2,
  tier: "",
  status: "active",
}

test("#505 shouldShowRoundLimitHint: unarmed + round_limit only", () => {
  assert.equal(shouldShowRoundLimitHint(null, "round_limit"), true)
  assert.equal(shouldShowRoundLimitHint(undefined, "round_limit"), true)
  assert.equal(shouldShowRoundLimitHint(LOOP_VIEW, "round_limit"), false)
  assert.equal(shouldShowRoundLimitHint(null, null), false)
  assert.equal(shouldShowRoundLimitHint(null, "aborted"), false)
  assert.equal(shouldShowRoundLimitHint(LOOP_VIEW, null), false)
  assert.equal(shouldShowRoundLimitHint(null, "round_limit", true), false, "loop suggest hides the unarmed hint")
  assert.equal(shouldShowRoundLimitHint(null, "round_limit", false), true)
})

test("#505 backfillLoopView of an armed thread is a loop view (no double hint)", () => {
  const armed = {
    loop_state: { status: "active" },
  } as unknown as Thread
  const view = backfillLoopView(armed)
  assert.ok(view)
  assert.equal(shouldShowRoundLimitHint(view, "round_limit"), false)
})

test("#505 copy is the honest unarmed cap line, not a tombstone", () => {
  assert.match(ROUND_LIMIT_UNARMED_COPY, /这一段跑满了 100 步工具调用/)
  assert.match(ROUND_LIMIT_UNARMED_COPY, /回复“继续”/)
  assert.doesNotMatch(ROUND_LIMIT_UNARMED_COPY, /达到最大工具调用轮次/)
})

test("#505 an empty round-limit completion sets only the owning thread's hint", () => {
  const panel = mountPanel()
  panel.select("A")
  panel.receive({ type: "chat.done", thread_id: "A", terminal: "round_limit" })
  assert.equal(panel.state().runTerminalByThreadId.A, "round_limit")
  assert.equal(panel.state().messages.length, 0)
  panel.receive({ type: "chat.done", thread_id: "B", terminal: "round_limit" })
  assert.equal(panel.state().runTerminalByThreadId.B, "round_limit")
  assert.equal(panel.state().messages.length, 0)
})

test("#505 ChatView render gate matches loopView (frame ?? backfill)", () => {
  const chat = read("src/sidepanel/components/ChatView.tsx")
  assert.match(
    chat,
    /loopStatusByThreadId\[activeThreadId\]\s*\?\?\s*backfillLoopView\(activeThread\)/,
  )
  assert.match(chat, /shouldShowRoundLimitHint\(loopView,\s*runTerminal,\s*loopSuggestVisible\)/)
  assert.match(chat, /<RoundLimitHint\s*\/>/)
  // mutually exclusive with LoopStatusRow: ternary, not two independent ifs
  assert.match(chat, /loopView && activeThreadId \?[\s\S]{0,400}showRoundLimitHint \?/)
})
