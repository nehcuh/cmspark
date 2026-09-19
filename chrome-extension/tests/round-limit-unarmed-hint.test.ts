/**
 * #505 — unarmed 100-round cap is a visible, non-tombstone hint.
 *
 * Companion (other agent) stamps chat.done.terminal = "round_limit" without
 * finish_reason. UI stores it per-thread and renders only when this thread
 * has no loop-status view (armed threads already have the status row).
 */
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

test("#505 useWebSocket: chat.done.terminal → SET_RUN_TERMINAL, not ADD_MESSAGE", () => {
  const ws = read("src/sidepanel/hooks/useWebSocket.ts")
  const doneIdx = ws.indexOf('case "chat.done"')
  assert.ok(doneIdx > 0, "chat.done handler missing")
  const nextCase = ws.indexOf("case \"", doneIdx + 10)
  const body = ws.slice(doneIdx, nextCase > doneIdx ? nextCase : doneIdx + 4000)
  assert.match(body, /msg\.terminal === ["']round_limit["']/)
  assert.match(body, /SET_RUN_TERMINAL/)
  // The commit-row `if` (content/finish_reason/...) must not mention terminal.
  const commitIdx = body.indexOf("content ||")
  assert.ok(commitIdx > 0, "chat.done commit-row condition missing")
  const commitSlice = body.slice(commitIdx, commitIdx + 400)
  assert.match(commitSlice, /finishReason !== undefined/)
  assert.doesNotMatch(commitSlice, /terminal/)
})

test("#505 ChatView render gate matches loopView (frame ?? backfill)", () => {
  const chat = read("src/sidepanel/components/ChatView.tsx")
  assert.match(
    chat,
    /loopStatusByThreadId\[activeThreadId\]\s*\?\?\s*backfillLoopView\(activeThread\)/,
  )
  assert.match(chat, /shouldShowRoundLimitHint\(loopView,\s*runTerminal\)/)
  assert.match(chat, /<RoundLimitHint\s*\/>/)
  // mutually exclusive with LoopStatusRow: ternary, not two independent ifs
  assert.match(chat, /loopView && activeThreadId \?[\s\S]{0,400}showRoundLimitHint \?/)
})
