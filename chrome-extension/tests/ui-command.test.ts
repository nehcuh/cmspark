import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { UI_COMMAND_ACTIONS, runUiCommand } from "../src/background/ui-command"

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

test("#433 ui.command: five-action whitelist lockstep with companion", () => {
  assert.deepEqual([...UI_COMMAND_ACTIONS], [
    "focus_panel",
    "open_confirm_center",
    "open_browser",
    "thread.new_in_panel",
    "open_terminal_tab",
  ])
  const companion = src("../companion/src/ui-command.ts")
  for (const action of UI_COMMAND_ACTIONS) {
    assert.match(companion, new RegExp(`"${action}"`))
  }
})

test("#433 ui.command: unknown action rejected; focus_panel calls sidePanel.open impl", async () => {
  const calls: string[] = []
  const impl = {
    focus_panel: async () => {
      calls.push("focus_panel")
    },
    open_confirm_center: async () => {
      calls.push("open_confirm_center")
    },
    open_browser: async () => {
      calls.push("open_browser")
    },
    "thread.new_in_panel": async () => {
      calls.push("thread.new_in_panel")
    },
    open_terminal_tab: async () => {
      calls.push("open_terminal_tab")
    },
  }
  const bad = await runUiCommand("drop_db", impl)
  assert.equal(bad.ok, false)
  assert.deepEqual(calls, [])
  const ok = await runUiCommand("focus_panel", impl)
  assert.equal(ok.ok, true)
  assert.deepEqual(calls, ["focus_panel"])
})

test("#433 SW handleCompanionMessage wires ui.command to sidePanel.open / cockpit / terminal", () => {
  const bg = src("src/background/index.ts")
  const slice = bg.slice(
    bg.indexOf('if (msg.type === "ui.command")'),
    bg.indexOf('if (msg.type === "ui.open_sidepanel")'),
  )
  assert.match(slice, /runUiCommand/)
  assert.match(slice, /sidePanel\.open/)
  assert.match(slice, /openOrFocusCockpit/)
  assert.match(slice, /openOrFocusEmbeddedTerminal/)
  assert.match(slice, /thread\.create/)
  const ws = src("src/sidepanel/hooks/useWebSocket.ts")
  assert.match(ws, /msg\.type === ["']ui\.command["']/)
})
