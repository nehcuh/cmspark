import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileUploadedApplyToPanel, shouldApplyStreamEvent } from "../src/sidepanel/hooks/useWebSocket"

test("shouldApplyStreamEvent: missing thread_id fail-closed (P1)", () => {
  assert.equal(shouldApplyStreamEvent(undefined, "thread-a"), false)
  assert.equal(shouldApplyStreamEvent(null, "thread-a"), false)
  assert.equal(shouldApplyStreamEvent("", "thread-a"), false)
})

test("shouldApplyStreamEvent: matching thread_id applies", () => {
  assert.equal(shouldApplyStreamEvent("thread-a", "thread-a"), true)
})

test("shouldApplyStreamEvent: non-active thread_id is rejected", () => {
  assert.equal(shouldApplyStreamEvent("thread-b", "thread-a"), false)
  assert.equal(shouldApplyStreamEvent("thread-a", "thread-b"), false)
})

test("shouldApplyStreamEvent: activeThread null rejects set thread_id", () => {
  assert.equal(shouldApplyStreamEvent("thread-a", null), false)
  assert.equal(shouldApplyStreamEvent("thread-a", undefined), false)
})

test("shouldApplyStreamEvent: missing thread_id rejected when active is null", () => {
  assert.equal(shouldApplyStreamEvent(undefined, null), false)
})

test("shouldApplyStreamEvent: upload-error style foreign thread is rejected", () => {
  assert.equal(shouldApplyStreamEvent("upload-thread-a", "active-thread-b"), false)
  assert.equal(shouldApplyStreamEvent("upload-thread-a", "upload-thread-a"), true)
})

test("fileUploadedApplyToPanel: only panel chrome is thread-gated (F3)", () => {
  // The chip-clear BUMP has no thread ownership: the listener dispatches it
  // unconditionally BEFORE this gate, so a mid-upload thread switch cannot skip
  // it (pre-F3 the BUMP sat behind the gate and chips leaked across threads).
  // This helper decides only whether panel chrome (status/processing) applies.
  assert.equal(fileUploadedApplyToPanel("thread-a", "thread-b"), false)
  assert.equal(fileUploadedApplyToPanel("thread-a", "thread-a"), true)
  assert.equal(fileUploadedApplyToPanel(undefined, "thread-a"), false)
  assert.equal(fileUploadedApplyToPanel("thread-a", null), false)
})

test("file.upload_error retracts via pendingUploadsRef (not stale state.messages)", () => {
  const src = readFileSync(join(process.cwd(), "src/sidepanel/hooks/useWebSocket.ts"), "utf8")
  assert.match(src, /pendingUploadsRef\.current = state\.pendingUploads/)
  const start = src.indexOf('case "file.upload_error"')
  assert.ok(start >= 0, "file.upload_error case missing")
  const body = src.slice(start, start + 2000)
  assert.match(body, /pendingUploadsRef\.current/)
  assert.match(body, /REMOVE_MESSAGE/)
  assert.equal(body.includes("state.messages"), false)
  assert.match(body, /CLEAR_PENDING_UPLOAD/)
  const restoreIdx = body.indexOf("REQUEST_COMPOSER_RESTORE")
  const gateIdx = body.indexOf("shouldApplyStreamEvent(uploadErrTid")
  assert.ok(restoreIdx >= 0, "REQUEST_COMPOSER_RESTORE missing")
  assert.ok(gateIdx >= 0 && gateIdx < restoreIdx, "composer restore must sit behind the active-thread gate")
})

test("InputArea consumes composerRestore via nextComposerText", () => {
  const src = readFileSync(join(process.cwd(), "src/sidepanel/App.tsx"), "utf8")
  const start = src.indexOf("state.composerRestore")
  assert.ok(start >= 0, "composerRestore effect missing")
  const body = src.slice(start, start + 400)
  assert.match(body, /nextComposerText\(/)
  assert.match(body, /CLEAR_COMPOSER_RESTORE/)
})

test("chat.user paints the bubble before busy chrome", () => {
  const src = readFileSync(join(process.cwd(), "src/sidepanel/hooks/useWebSocket.ts"), "utf8")
  const start = src.indexOf('case "chat.user"')
  assert.ok(start >= 0, "chat.user case missing")
  const body = src.slice(start, src.indexOf("case \"chat.done\"", start))
  const addIdx = body.indexOf("ADD_MESSAGE")
  const procIdx = body.indexOf("SET_PROCESSING")
  assert.ok(addIdx >= 0 && procIdx > addIdx, "ADD_MESSAGE must precede SET_PROCESSING")
})

test("thread.list request echo must not be treated as an empty hydrate", () => {
  // Cockpit open → sendMessage({type:"thread.list"}) lands on the Panel listener.
  // Without this guard, incoming=[] → auto-create a blank thread.
  const src = readFileSync(join(process.cwd(), "src/sidepanel/hooks/useWebSocket.ts"), "utf8")
  const start = src.indexOf('case "thread.list"')
  assert.ok(start >= 0, "thread.list case missing")
  const body = src.slice(start, src.indexOf("case \"quickAction.start\"", start))
  assert.match(body, /Array\.isArray\(msg\.threads\)/)
  const guardIdx = body.indexOf("Array.isArray(msg.threads)")
  const createIdx = body.indexOf("thread.create")
  assert.ok(guardIdx >= 0 && createIdx > guardIdx, "auto-create must sit behind threads-array hydrate guard")
})

test("file.uploaded: chip-clear BUMP is dispatched before the thread gate (F3)", () => {
  // Source-order lock (pre-F3 this ordering was inverted → red): the BUMP sat
  // behind shouldApplyStreamEvent, so foreign-thread uploads never cleared chips.
  const src = readFileSync(
    join(process.cwd(), "src/sidepanel/hooks/useWebSocket.ts"),
    "utf8",
  )
  const start = src.indexOf('case "file.uploaded"')
  assert.ok(start >= 0, "file.uploaded case missing")
  const body = src.slice(start, start + 1200)
  const bumpIdx = body.indexOf('type: "BUMP_COMPOSER_UPLOAD_CLEAR"')
  const gateIdx = body.indexOf("fileUploadedApplyToPanel(")
  assert.ok(bumpIdx >= 0, "BUMP dispatch missing")
  assert.ok(gateIdx >= 0, "panel gate missing")
  assert.ok(bumpIdx < gateIdx, "chip clear must dispatch before the thread gate")
})
