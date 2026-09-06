// Load @lydell/node-pty. SEA/main-script bare require only sees builtins
// (spike: ERR_UNKNOWN_BUILTIN_MODULE). Fall back to createRequire(execPath)
// so the staged sidecar node_modules next to the exe resolves.

import { createRequire } from "node:module"

export type PtySpawnOpts = {
  name: string
  cols: number
  rows: number
  cwd: string
  env: Record<string, string>
}

export type PtyHandle = {
  pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  pause(): void
  resume(): void
  kill(): void
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void
}

export type PtySpawnFn = (file: string, args: string[], opts: PtySpawnOpts) => PtyHandle

type NativePty = { spawn: PtySpawnFn }

let cached: NativePty | null = null

export function loadNodePty(): NativePty {
  if (cached) return cached
  try {
    cached = require("@lydell/node-pty") as NativePty
    return cached
  } catch {
    const seaRequire = createRequire(process.execPath)
    cached = seaRequire("@lydell/node-pty") as NativePty
    return cached
  }
}

/** Tests only. */
export function __testResetPtyNativeCache(): void {
  cached = null
}
