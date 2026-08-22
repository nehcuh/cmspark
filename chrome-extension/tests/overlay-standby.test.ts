import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  agentReducer,
  initialState,
  overlayStandbyFromError,
  type AgentState,
} from "../src/sidepanel/store/agentStore"
import { newTempUserMessageId } from "../src/utils/temp-message-id"

test("overlayStandbyFromError: error_code OVERLAY_STANDBY with overlay holder", () => {
  const got = overlayStandbyFromError({
    error: "OVERLAY_STANDBY: composer is on the other surface",
    data: { error_code: "OVERLAY_STANDBY", holder: "overlay" },
  })
  assert.deepEqual(got, { standby: true, label: "正在召唤器输入" })
})

test("overlayStandbyFromError: holder panel names the Side Panel", () => {
  const got = overlayStandbyFromError({
    data: { error_code: "OVERLAY_STANDBY", holder: "panel" },
  })
  assert.deepEqual(got, { standby: true, label: "正在侧栏输入" })
})

test("overlayStandbyFromError: error string prefix without data still standbys (overlay default)", () => {
  const got = overlayStandbyFromError({
    error: "OVERLAY_STANDBY: composer is on the other surface",
  })
  assert.deepEqual(got, { standby: true, label: "正在召唤器输入" })
})

test("overlayStandbyFromError: other chat.error is not standby", () => {
  const got = overlayStandbyFromError({
    error: "thread_paused",
    data: { error_code: "thread_paused" },
  })
  assert.deepEqual(got, { standby: false, label: "" })
})

test("overlayStandbyFromError: null/empty payload is not standby", () => {
  assert.deepEqual(overlayStandbyFromError(null), { standby: false, label: "" })
  assert.deepEqual(overlayStandbyFromError(undefined), { standby: false, label: "" })
  assert.deepEqual(overlayStandbyFromError({}), { standby: false, label: "" })
})

function withStandby(label = "正在召唤器输入"): AgentState {
  return { ...initialState, overlayStandby: { label }, activeThreadId: "thread-a" }
}

test("SET_OVERLAY_STANDBY disables composer with holder label", () => {
  const next = agentReducer(initialState, {
    type: "SET_OVERLAY_STANDBY",
    label: "正在召唤器输入",
  })
  assert.deepEqual(next.overlayStandby, { label: "正在召唤器输入" })
})

test("CLEAR_OVERLAY_STANDBY re-enables composer", () => {
  const next = agentReducer(withStandby(), { type: "CLEAR_OVERLAY_STANDBY" })
  assert.equal(next.overlayStandby, null)
})

test("SET_ACTIVE_THREAD different id clears overlay standby", () => {
  const next = agentReducer(withStandby(), { type: "SET_ACTIVE_THREAD", threadId: "thread-b" })
  assert.equal(next.activeThreadId, "thread-b")
  assert.equal(next.overlayStandby, null)
})

test("SET_ACTIVE_THREAD same id keeps overlay standby", () => {
  const base = withStandby()
  const next = agentReducer(base, { type: "SET_ACTIVE_THREAD", threadId: "thread-a" })
  assert.equal(next, base)
  assert.deepEqual(next.overlayStandby, { label: "正在召唤器输入" })
})

test("panel-origin ADD_MESSAGE (temp user id) clears overlay standby", () => {
  const tid = "thread-a"
  const next = agentReducer(withStandby(), {
    type: "ADD_MESSAGE",
    message: {
      id: newTempUserMessageId(tid),
      thread_id: tid,
      role: "user",
      content: "from panel",
      created_at: "2026-08-22T00:00:00.000Z",
    },
  })
  assert.equal(next.overlayStandby, null)
  assert.equal(next.messages.length, 1)
})

test("assistant ADD_MESSAGE does not clear overlay standby", () => {
  const next = agentReducer(withStandby(), {
    type: "ADD_MESSAGE",
    message: {
      id: "thread-a_err_1",
      thread_id: "thread-a",
      role: "assistant",
      content: "⚠️ other error",
      created_at: "2026-08-22T00:00:00.000Z",
    },
  })
  assert.deepEqual(next.overlayStandby, { label: "正在召唤器输入" })
})

test("panel persist echo (client_message_id temp id) clears overlay standby", () => {
  const tid = "thread-a"
  const next = agentReducer(withStandby(), {
    type: "ADD_MESSAGE",
    message: {
      id: `${tid}_1720000000000_echo`,
      thread_id: tid,
      role: "user",
      content: "from panel",
      created_at: "2026-08-22T00:00:00.000Z",
      client_message_id: newTempUserMessageId(tid),
    },
  })
  assert.equal(next.overlayStandby, null)
})

test("overlay-origin user ADD_MESSAGE (persisted id) keeps overlay standby", () => {
  const next = agentReducer(withStandby(), {
    type: "ADD_MESSAGE",
    message: {
      id: "thread-a_1720000000000_abcd",
      thread_id: "thread-a",
      role: "user",
      content: "from overlay",
      created_at: "2026-08-22T00:00:00.000Z",
    },
  })
  assert.deepEqual(next.overlayStandby, { label: "正在召唤器输入" })
  assert.equal(next.messages.length, 1)
})

test("APPLY_COMPOSER_LEASE holder panel clears standby", () => {
  const next = agentReducer(withStandby(), {
    type: "APPLY_COMPOSER_LEASE",
    holder: "panel",
    threadId: "thread-a",
  })
  assert.equal(next.overlayStandby, null)
})

test("APPLY_COMPOSER_LEASE holder overlay sets 正在召唤器输入", () => {
  const next = agentReducer(initialState, {
    type: "APPLY_COMPOSER_LEASE",
    holder: "overlay",
    threadId: "thread-a",
  })
  assert.deepEqual(next.overlayStandby, { label: "正在召唤器输入" })
})

test("chat.error OVERLAY_STANDBY sets standby and skips error bubble", () => {
  const src = readFileSync(join(process.cwd(), "src/sidepanel/hooks/useWebSocket.ts"), "utf8")
  const start = src.indexOf('case "chat.error"')
  assert.ok(start >= 0, "chat.error case missing")
  const nextCase = src.indexOf('case "composer.lease"', start)
  const body = src.slice(start, nextCase > start ? nextCase : start + 2500)
  assert.match(body, /overlayStandbyFromError/)
  assert.match(body, /SET_OVERLAY_STANDBY/)
  assert.match(body, /CLEAR_OVERLAY_STANDBY/)
  const setIdx = body.indexOf('type: "SET_OVERLAY_STANDBY"')
  const addIdx = body.indexOf('type: "ADD_MESSAGE"')
  assert.ok(setIdx >= 0, "SET_OVERLAY_STANDBY dispatch missing")
  assert.ok(addIdx > setIdx, "standby dispatch must precede the generic error bubble")
  assert.match(body, /parsed\.standby/)
  const standbyBreak = body.indexOf("if (parsed.standby)")
  assert.ok(standbyBreak >= 0 && standbyBreak < addIdx, "standby path must break before ADD_MESSAGE")
})

test("composer.lease inbound applies holder to overlay standby", () => {
  const src = readFileSync(join(process.cwd(), "src/sidepanel/hooks/useWebSocket.ts"), "utf8")
  assert.match(src, /case "composer\.lease"/)
  const start = src.indexOf('case "composer.lease"')
  const body = src.slice(start, start + 800)
  assert.match(body, /APPLY_COMPOSER_LEASE/)
})

test("InputArea disables composer and shows overlay standby label", () => {
  const src = readFileSync(join(process.cwd(), "src/sidepanel/App.tsx"), "utf8")
  const start = src.indexOf("function InputArea")
  assert.ok(start >= 0, "InputArea missing")
  const body = src.slice(start)
  assert.match(body, /overlayStandby/)
  assert.match(body, /overlayStandby\.label/)
  const ta = body.indexOf("<textarea")
  assert.ok(ta >= 0, "textarea missing")
  const taBlock = body.slice(ta, ta + 900)
  assert.match(taBlock, /overlayStandby/)
})
