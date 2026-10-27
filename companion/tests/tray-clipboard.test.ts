import test from "node:test"
import assert from "node:assert/strict"

import { copyTextToClipboard } from "../src/tray/clipboard"

interface RecordedCall {
  cmd: string
  args: string[]
  options: { input?: string; stdio?: unknown }
}

function recorder(results: Record<string, { status: number; error?: Error }>) {
  const calls: RecordedCall[] = []
  const spawnSync = ((cmd: string, args: string[], options: RecordedCall["options"]) => {
    calls.push({ cmd, args, options })
    return results[cmd] ?? { status: 1 }
  }) as any
  return { calls, spawnSync }
}

const allTools = { xclip: true, xsel: true, wlCopy: true }

test("X11 copy falls through a failed xclip to xsel and keeps text on stdin", () => {
  const { calls, spawnSync } = recorder({ xclip: { status: 1 }, xsel: { status: 0 } })
  const secret = "pairing-secret-not-in-argv"

  assert.equal(copyTextToClipboard(secret, {
    platform: "linux",
    wayland: false,
    available: allTools,
    spawnSync,
  }), true)
  assert.deepEqual(calls.map((call) => call.cmd), ["xclip", "xsel"])
  for (const call of calls) {
    assert.equal(call.options.input, secret)
    assert.equal(call.cmd.includes(secret), false)
    assert.equal(call.args.includes(secret), false)
  }
})

test("Wayland tries wl-copy first and falls back after a process error", () => {
  const { calls, spawnSync } = recorder({
    "wl-copy": { status: 0, error: new Error("display unavailable") },
    xclip: { status: 0 },
  })

  assert.equal(copyTextToClipboard("secret", {
    platform: "linux",
    wayland: true,
    available: allTools,
    spawnSync,
  }), true)
  assert.deepEqual(calls.map((call) => call.cmd), ["wl-copy", "xclip"])
})

test("copy returns false only after every available backend fails", () => {
  const { calls, spawnSync } = recorder({})

  assert.equal(copyTextToClipboard("secret", {
    platform: "linux",
    wayland: true,
    available: allTools,
    spawnSync,
  }), false)
  assert.deepEqual(calls.map((call) => call.cmd), ["wl-copy", "xclip", "xsel"])
})

test("copy does not spawn when no supported tool is available", () => {
  const { calls, spawnSync } = recorder({})
  assert.equal(copyTextToClipboard("secret", {
    platform: "linux",
    available: {},
    spawnSync,
  }), false)
  assert.equal(calls.length, 0)
})
