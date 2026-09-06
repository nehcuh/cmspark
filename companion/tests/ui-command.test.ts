/**
 * #433 P2 ui.command whitelist + summoner downgrade (spec §3b).
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { UI_COMMAND_ACTIONS, isUiCommandAction } from "../src/ui-command"
import { handleUiCommand } from "../src/message-router/handlers/ui-command"
import { assertSummonerAllowed, applySummonerPayloadPolicy } from "../src/ws/summoner-acl"
import { validateWsMessage } from "../src/ws/validate"
import { handleMessage } from "../src/message-router"
import { ThreadManager } from "../src/threads/thread-manager"
import { SkillEngine } from "../src/skills/skill-engine"
import { decodeSummonerInbound, encodeSummonerUiCommand } from "../src/summoner/protocol"

test("#433 ui.command: whitelist is five hardcoded actions", () => {
  assert.deepEqual([...UI_COMMAND_ACTIONS], [
    "focus_panel",
    "open_confirm_center",
    "open_browser",
    "thread.new_in_panel",
    "open_terminal_tab",
  ])
  assert.equal(isUiCommandAction("focus_panel"), true)
  assert.equal(isUiCommandAction("rm -rf"), false)
  assert.equal(isUiCommandAction(""), false)
})

test("#433 ui.command: dual-end hardcoded lockstep with extension copy", () => {
  const companionRoot = path.resolve(__dirname, "..", "..")
  const ext = fs.readFileSync(
    path.join(companionRoot, "..", "chrome-extension", "src", "background", "ui-command.ts"),
    "utf8",
  )
  for (const action of UI_COMMAND_ACTIONS) {
    assert.match(ext, new RegExp(`"${action}"`))
  }
  assert.match(ext, /runUiCommand/)
})

test("#433 ui.command: unknown action rejected; known action broadcasts to panel", () => {
  const frames: unknown[] = []
  const bad = handleUiCommand({ action: "format_disk" }, { broadcast: (d) => frames.push(d) })
  assert.equal(bad.error_code, "UI_COMMAND_UNKNOWN")
  assert.equal(frames.length, 0)

  const ok = handleUiCommand({ action: "focus_panel" }, { broadcast: (d) => frames.push(d) })
  assert.equal(ok.type, "ui.command.ok")
  assert.equal((ok as { action: string }).action, "focus_panel")
  assert.deepEqual(frames, [{ type: "ui.command", action: "focus_panel" }])
})

test("#433 ui.command: validate + summoner ACL + payload whitelist", () => {
  assert.equal(validateWsMessage({ type: "ui.command" }).valid, false)
  assert.equal(validateWsMessage({ type: "ui.command", action: "focus_panel" }).valid, true)
  assert.equal(assertSummonerAllowed("summoner", "ui.command").ok, true)
  assert.equal(applySummonerPayloadPolicy("summoner", { type: "ui.command", action: "nuke" }).ok, false)
  const msg: Record<string, unknown> = { type: "ui.command", action: "focus_panel", extra: 1 }
  assert.equal(applySummonerPayloadPolicy("summoner", msg).ok, true)
  assert.equal(msg.extra, undefined)
})

test("#433 ui.command: overlay stdin round-trip", () => {
  const decoded = decodeSummonerInbound({ type: "summoner.ui_command", action: "open_terminal_tab" })
  assert.deepEqual(decoded, encodeSummonerUiCommand({ action: "open_terminal_tab" }))
  assert.equal(decodeSummonerInbound({ type: "summoner.ui_command" }), null)
})

test("#433 overlay verbs emit ui_command not attach_chrome for panel/confirm/terminal", () => {
  const overlay = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "src", "tray", "SummonerOverlay.swift"),
    "utf8",
  )
  assert.match(overlay, /summoner\.ui_command/)
  assert.match(overlay, /focus_panel/)
  assert.match(overlay, /open_confirm_center/)
  assert.match(overlay, /open_terminal_tab/)
  const activate = overlay.slice(
    overlay.indexOf("private func activatePaletteRow"),
    overlay.indexOf("private func refreshLog"),
  )
  assert.doesNotMatch(activate, /open_panel".*attach_chrome/s)
  assert.match(activate, /emitUiCommand\("focus_panel"\)/)
  assert.match(activate, /emitUiCommand\("open_confirm_center"\)/)
  assert.match(activate, /emitUiCommand\("open_terminal_tab"\)/)
})

test("#433 ui.command through handleMessage broadcasts", async () => {
  const frames: unknown[] = []
  const r = await handleMessage(
    { type: "ui.command", action: "open_confirm_center" },
    {
      threadManager: new ThreadManager(),
      skillEngine: new SkillEngine(),
      historyStore: { record: () => 0 } as never,
    },
    {
      sendToExtension: () => {},
      executeTool: async () => ({ success: true }),
      broadcast: (d: unknown) => frames.push(d),
    } as never,
  )
  assert.equal(r.type, "ui.command.ok")
  assert.deepEqual(frames, [{ type: "ui.command", action: "open_confirm_center" }])

  const unknown = await handleMessage(
    { type: "ui.command", action: "not-a-verb" },
    {
      threadManager: new ThreadManager(),
      skillEngine: new SkillEngine(),
      historyStore: { record: () => 0 } as never,
    },
    { sendToExtension: () => {}, executeTool: async () => ({ success: true }), broadcast: () => {} } as never,
  )
  assert.equal(unknown.error_code, "UI_COMMAND_UNKNOWN")
})
