import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

test("popout button is not only in EmptyState and SW forwards overlay.shell.open", () => {
  // #321 PR-2: affordance moved ChatView bar → StatusRail; EmptyState stays clean.
  const chat = src("src/sidepanel/components/ChatView.tsx")
  const emptyFn = chat.slice(chat.indexOf("function EmptyState"), chat.indexOf("const markdownCSS"))
  assert.doesNotMatch(emptyFn, /弹出对话框/)
  assert.doesNotMatch(chat, /贴回侧栏/)
  const rail = src("src/sidepanel/components/StatusRail.tsx")
  assert.match(rail, /弹出对话框/)
  const bg = src("src/background/index.ts")
  assert.match(bg, /overlay\.shell\.open/)
})

test("App handlePopout sends overlay.shell.open with thread_id; no sidePanel.open", () => {
  const app = src("src/sidepanel/App.tsx")
  assert.match(app, /type:\s*\{\s*["']overlay\.shell\.open["']|type:\s*["']overlay\.shell\.open["']/)
  assert.match(app, /thread_id:\s*threadId/)
  const rail = src("src/sidepanel/components/StatusRail.tsx")
  assert.match(rail, /disabled=\{!canPopout\}/)
  assert.doesNotMatch(app, /sidePanel\.open/)
  assert.doesNotMatch(rail, /sidePanel\.open/)
})

test("App handlePopout toasts on lastError or ok === false", () => {
  const app = src("src/sidepanel/App.tsx")
  const start = app.indexOf("const handlePopout")
  const pop = app.slice(start, start + 900)
  assert.match(pop, /lastError/)
  assert.match(pop, /ok\s*===\s*false/)
  assert.match(pop, /无法弹出对话框/)
})

test("useWebSocket ignores overlay.shell.open echo and toasts OVERLAY_SHELL_ errors", () => {
  const ws = src("src/sidepanel/hooks/useWebSocket.ts")
  assert.match(ws, /msg\.type === ["']overlay\.shell\.open["']/)
  const overlayBlock = ws.slice(
    ws.indexOf('case "overlay.shell.accepted"'),
    ws.indexOf("knowledgePreviewErrorText(msg)"),
  )
  assert.match(overlayBlock, /OVERLAY_SHELL_/)
  assert.match(overlayBlock, /cmspark:toast/)
  assert.match(overlayBlock, /无法弹出对话框/)
  assert.doesNotMatch(overlayBlock, /SET_PROCESSING_STATUS/)
  const app = src("src/sidepanel/App.tsx")
  assert.match(app, /cmspark:toast/)
  assert.match(app, /showToast/)
})

test("background bulk-forwards overlay.shell.open; handleCompanionMessage does not special-case it", () => {
  const bg = src("src/background/index.ts")
  const bulk = bg.slice(bg.indexOf('case "voice.stt.start"'), bg.indexOf('case "thread_graph.prepare"'))
  assert.match(bulk, /case "overlay\.shell\.open":/)
  const handle = bg.slice(bg.indexOf("async function handleCompanionMessage"), bg.indexOf("function setupMessageHandlers"))
  assert.doesNotMatch(handle, /overlay\.shell\.open/)
})
