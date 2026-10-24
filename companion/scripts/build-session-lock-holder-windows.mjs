// Build-only test fixture. Imports discovery, never downloads desktop SDKs.
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { desktopWindowsToolchain } from "./build-desktop-windows.mjs"

export const sessionLockHolderBasename = "session-lock-holder.exe"
export function sessionLockHolderCompilePlan({ cl, root, output }) {
  const p = path.win32
  return [cl, ["/nologo", "/std:c11", "/W4", "/WX", "/MT", "/DUNICODE", "/D_UNICODE",
    p.join(root, "tests/fixtures/session-save/lock-holder.c"), "/link", "/MACHINE:X64",
    "kernel32.lib", `/OUT:${p.join(output, sessionLockHolderBasename)}`]]
}
function regular(file) {
  const value = fs.lstatSync(file)
  if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1) throw new Error("SESSION_LOCK_HOLDER_FILE")
  return value
}
export function buildSessionLockHolderWindows({ root, output }) {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("SESSION_LOCK_HOLDER_REQUIRES_WINDOWS_X64")
  if (!path.isAbsolute(root) || !path.isAbsolute(output)) throw new Error("SESSION_LOCK_HOLDER_DIRECTORY")
  const dir = fs.lstatSync(output)
  if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error("SESSION_LOCK_HOLDER_DIRECTORY")
  regular(path.join(root, "tests/fixtures/session-save/lock-holder.c"))
  const { cl, env } = desktopWindowsToolchain()
  const work = fs.mkdtempSync(path.join(output, "lock-holder-build-"))
  try {
    const [binary, args] = sessionLockHolderCompilePlan({ cl, root, output: work })
    // Existing build-tool ceiling, not a test readiness/runtime allowance.
    const r = spawnSync(binary, args, { env, cwd: work, encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024 })
    if (r.error || r.status !== 0) {
      process.stderr.write(`${r.stdout || ""}${r.stderr || ""}`)
      throw new Error("SESSION_LOCK_HOLDER_BUILD_FAILED")
    }
    const compiled = path.join(work, sessionLockHolderBasename)
    if (!regular(compiled).size) throw new Error("SESSION_LOCK_HOLDER_FILE")
    const target = path.join(output, sessionLockHolderBasename)
    // Fresh run-owned path only; never reuse/overwrite a cached executable.
    fs.copyFileSync(compiled, target, fs.constants.COPYFILE_EXCL)
    regular(target)
  } finally { fs.rmSync(work, { recursive: true, force: true }) }
}
let direct = false
try { direct = !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)) } catch { /* import is inert */ }
if (direct) {
  if (process.argv.length !== 3 || !path.isAbsolute(process.argv[2])) throw new Error("SESSION_LOCK_HOLDER_BUILD_ARGS")
  buildSessionLockHolderWindows({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), output: process.argv[2] })
}
