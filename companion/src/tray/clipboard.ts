import * as child_process from "child_process"

import {
  resolveClipboardCommands,
  type ClipboardAvailability,
} from "./pairing"

export interface ClipboardCopyOptions {
  platform?: string
  wayland?: boolean
  available?: ClipboardAvailability
  spawnSync?: typeof child_process.spawnSync
}

function commandAvailable(cmd: string): boolean {
  try {
    const result = child_process.spawnSync("which", [cmd], { stdio: "ignore", timeout: 1500 })
    return result.status === 0
  } catch {
    return false
  }
}

export function copyTextToClipboard(text: string, options: ClipboardCopyOptions = {}): boolean {
  const platform = options.platform ?? process.platform
  const available = options.available ?? (platform === "linux"
    ? {
        xclip: commandAvailable("xclip"),
        xsel: commandAvailable("xsel"),
        wlCopy: commandAvailable("wl-copy"),
      }
    : {})
  const run = options.spawnSync ?? child_process.spawnSync
  const commands = resolveClipboardCommands(platform, available, {
    wayland: options.wayland ?? Boolean(process.env.WAYLAND_DISPLAY),
  })

  for (const resolved of commands) {
    try {
      const child = run(resolved.cmd, resolved.args, {
        input: text,
        stdio: ["pipe", "ignore", "ignore"],
        timeout: 3000,
        windowsHide: true,
      })
      if (!child.error && child.status === 0) return true
    } catch {
      // Try the next clipboard backend.
    }
  }
  return false
}
