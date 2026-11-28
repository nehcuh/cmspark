import { initialState } from "../src/sidepanel/store/agentStore"
import { mountPanel } from "./helpers/mount-sidepanel"
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

test("upload failure retracts only the owner's pending bubble and restores only its active composer", () => {
  for (const switchAway of [false, true]) {
    const pending = { messageId: "upload", composerText: "original draft" }
    const panel = mountPanel({ ...initialState, pendingUploads: { A: pending } })
    panel.select("A")
    panel.addLocal({ id: "upload", thread_id: "A", role: "user", content: "upload", created_at: "" })
    if (switchAway) panel.select("B", false)
    panel.receive({ type: "file.upload_error", thread_id: "A", error: "bad file" })
    assert.equal(panel.state().pendingUploads.A, undefined)
    if (switchAway) {
      assert.equal(panel.state().composerRestore, null)
      assert.equal(panel.state().messages.length, 0)
      panel.select("A")
      assert.equal(panel.state().messages.length, 0)
    } else {
      assert.equal(panel.state().composerRestore?.text, pending.composerText)
      assert.deepEqual(panel.state().messages.map(m => m.content), ["❌ bad file"])
    }
  }
})

test("InputArea consumes composerRestore via nextComposerText", () => {
  const src = readFileSync(join(process.cwd(), "src/sidepanel/App.tsx"), "utf8")
  const start = src.indexOf("state.composerRestore")
  assert.ok(start >= 0, "composerRestore effect missing")
  const body = src.slice(start, start + 400)
  assert.match(body, /nextComposerText\(/)
  assert.match(body, /CLEAR_COMPOSER_RESTORE/)
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
  assert.ok(guardIdx >= 0, "thread.list must ignore a request echo before treating it as a list")
  assert.equal(body.indexOf("thread.create"), -1, "an empty active list must not auto-create")
  assert.equal(body.indexOf("incoming[0]"), -1, "an active list must not select the first row")
  assert.ok(body.indexOf('type: "SET_THREADS"') > guardIdx, "list updates stay behind the array guard")
})

test("apps.list/acp.list request echo must not clear entries or flip enabled", () => {
  // Same request-echo trap as thread.list: a bare {type:"apps.list"} /
  // {type:"acp.list"} request forwarded to the other page's listener carries
  // no array payload — treating it as a hydrate would wipe entries and force
  // acpEnabled=false.
  const src = readFileSync(join(process.cwd(), "src/sidepanel/hooks/useWebSocket.ts"), "utf8")
  const appsStart = src.indexOf('case "apps.list"')
  assert.ok(appsStart >= 0, "apps.list case missing")
  const appsBody = src.slice(appsStart, src.indexOf('case "apps.updated"', appsStart))
  const appsGuardIdx = appsBody.indexOf("Array.isArray(msg.entries)")
  const appsDispatchIdx = appsBody.indexOf("SET_APPS_STATE")
  assert.ok(
    appsGuardIdx >= 0 && appsDispatchIdx > appsGuardIdx,
    "apps.list hydrate must sit behind entries-array guard",
  )
  const acpStart = src.indexOf('case "acp.list"')
  assert.ok(acpStart >= 0, "acp.list case missing")
  const acpBody = src.slice(acpStart, src.indexOf('case "coding.git_status"', acpStart))
  const acpGuardIdx = acpBody.indexOf("Array.isArray(msg.agents)")
  const acpDispatchIdx = acpBody.indexOf("SET_ACP_LIST")
  assert.ok(
    acpGuardIdx >= 0 && acpDispatchIdx > acpGuardIdx,
    "acp.list hydrate must sit behind agents-array guard",
  )
})

test("an upload ack clears composer chips globally but preserves the selected thread's live stream", () => {
  const panel = mountPanel()
  panel.select("A")
  panel.select("B", false)
  panel.receive({ type: "chat.reasoning", thread_id: "B", content: "working" }, false)
  panel.receive({ type: "file.uploaded", thread_id: "A" }, false)
  assert.equal(panel.state().composerUploadClearSeq, 1)
  assert.equal(panel.state().isProcessing, true)
  panel.receive({ type: "file.uploaded", thread_id: "B" })
  assert.equal(panel.state().composerUploadClearSeq, 2)
  assert.equal(panel.state().isProcessing, true)
  assert.equal(panel.state().streamingReasoning, "working")
})
