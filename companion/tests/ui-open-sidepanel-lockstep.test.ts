/**
 * W3 (F2) ui.open_sidepanel result round-trip lockstep — the new
 * ui.open_sidepanel.result message type must exist on both ends with the
 * same wire shape. Do not import the chrome-extension module.
 *
 * Pins:
 * - companion: validator (ws/validate.ts) + router case (message-router.ts)
 *   + broadcast {type, id} + result handler (handlers/ui-open-sidepanel.ts)
 * - extension: SW sends ui.open_sidepanel.result {id, ok, error?} and never
 *   swallows sidePanel.open errors in an empty catch
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(__dirname, "..", "..")

function srcFile(...parts: string[]): string {
  const candidates = [
    path.join(ROOT, "src", ...parts),
    path.join(__dirname, "..", "src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

const extFile = (...parts: string[]) =>
  path.join(ROOT, "..", "chrome-extension", "src", ...parts)

test("ui.open_sidepanel.result exists on both ends (type + id + ok shape)", () => {
  const validate = fs.readFileSync(srcFile("ws", "validate.ts"), "utf8")
  const router = fs.readFileSync(srcFile("message-router.ts"), "utf8")
  const handler = fs.readFileSync(srcFile("message-router", "handlers", "ui-open-sidepanel.ts"), "utf8")
  const bg = fs.readFileSync(extFile("background", "index.ts"), "utf8")

  // companion side
  assert.match(validate, /"ui\.open_sidepanel\.result":\s*\(m\)\s*=>/)
  assert.match(router, /case "ui\.open_sidepanel\.result":/)
  assert.match(handler, /type:\s*"ui\.open_sidepanel",\s*id/)
  assert.match(handler, /handleUiOpenSidepanelResult/)

  // extension side
  assert.match(bg, /type:\s*"ui\.open_sidepanel\.result"/)
  const blockStart = bg.indexOf('msg.type === "ui.open_sidepanel"')
  assert.ok(blockStart >= 0, "SW ui.open_sidepanel block missing")
  const block = bg.slice(blockStart, bg.indexOf("llm.oneshot_result", blockStart))
  assert.match(block, /id:\s*msg\.id/)
  assert.match(block, /ok,\s*\n\s*\.\.\.\(error/)
  assert.match(block, /reply\(false/)
  assert.doesNotMatch(block, /overlay HTML already has the fail toast/)
})

test("tray echo guard and summoner surfaces unchanged by the id-addressed broadcast", () => {
  const mba = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  assert.match(mba, /msg\.type !== ["']ui\.open_sidepanel["']/)
  const handler = fs.readFileSync(srcFile("message-router", "handlers", "ui-open-sidepanel.ts"), "utf8")
  assert.match(handler, /SUMMONER_ACL/)
  assert.match(handler, /UI_OPEN_SIDEPANEL_ORIGIN/)
})
