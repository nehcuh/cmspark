import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

test("background bulk-forwards ui.open_sidepanel; handleCompanionMessage opens side panel and replies the real result", () => {
  const bg = src("src/background/index.ts")
  const companionHandlerSlice = bg.slice(
    bg.indexOf("async function handleCompanionMessage"),
    bg.indexOf("function setupMessageHandlers"),
  )
  assert.match(companionHandlerSlice, /ui\.open_sidepanel/)
  assert.match(companionHandlerSlice, /sidePanel\.open\(\s*\{\s*windowId/)
  assert.match(companionHandlerSlice, /windowTypes:\s*\[["']normal["']\]/)
  // W3 (F2): true result round-trip — SW replies ui.open_sidepanel.result
  // {id, ok, error?}; sidePanel.open failures are reported, never swallowed.
  assert.match(companionHandlerSlice, /type:\s*"ui\.open_sidepanel\.result"/)
  assert.match(companionHandlerSlice, /id:\s*msg\.id/)
  assert.match(companionHandlerSlice, /reply\(true\)/)
  assert.match(companionHandlerSlice, /reply\(false/)
  assert.doesNotMatch(companionHandlerSlice, /overlay HTML already has the fail toast/)
  const bulkForwardSlice = bg.slice(
    bg.indexOf('case "voice.stt.start"'),
    bg.indexOf('case "thread_graph.prepare"'),
  )
  assert.match(bulkForwardSlice, /case "ui.open_sidepanel"/)
  assert.doesNotMatch(companionHandlerSlice, /请点工具栏 C/)
})

test("useWebSocket ignores ui.open_sidepanel echo like overlay.shell.open", () => {
  const ws = src("src/sidepanel/hooks/useWebSocket.ts")
  assert.match(ws, /msg\.type === ["']overlay\.shell\.open["']/)
  assert.match(ws, /msg\.type === ["']ui\.open_sidepanel["']/)
})
