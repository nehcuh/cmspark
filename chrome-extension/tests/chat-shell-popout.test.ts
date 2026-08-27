import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

test("popout button is not only in EmptyState and SW forwards overlay.shell.open", () => {
  const chat = src("src/sidepanel/components/ChatView.tsx")
  const emptyFn = chat.slice(chat.indexOf("function EmptyState"), chat.indexOf("const markdownCSS"))
  assert.doesNotMatch(emptyFn, /弹出对话框/)
  assert.match(chat, /弹出对话框/)
  assert.doesNotMatch(chat, /贴回侧栏/)
  const bg = src("src/background/index.ts")
  assert.match(bg, /overlay\.shell\.open/)
})

test("ChatView click sends overlay.shell.open with thread_id; no sidePanel.open", () => {
  const chat = src("src/sidepanel/components/ChatView.tsx")
  assert.match(chat, /type:\s*["']overlay\.shell\.open["']/)
  assert.match(chat, /thread_id:\s*activeThreadId/)
  assert.match(chat, /disabled=\{!activeThreadId\}/)
  assert.doesNotMatch(chat, /sidePanel\.open/)
})

test("ChatView handlePopout toasts on lastError or ok === false", () => {
  const chat = src("src/sidepanel/components/ChatView.tsx")
  const pop = chat.slice(chat.indexOf("const handlePopout"), chat.indexOf("const handleExport"))
  assert.match(pop, /lastError/)
  assert.match(pop, /ok\s*===\s*false/)
  assert.match(pop, /cmspark:toast/)
  assert.match(pop, /无法弹出对话框/)
})

test("useWebSocket ignores overlay.shell.open echo and toasts OVERLAY_SHELL_ errors", () => {
  const ws = src("src/sidepanel/hooks/useWebSocket.ts")
  assert.match(ws, /msg\.type === ["']overlay\.shell\.open["']/)
  const overlayBlock = ws.slice(
    ws.indexOf('case "overlay.shell.accepted"'),
    ws.indexOf("/knowledge|预览|parseFile|fetch knowledge/"),
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
